import { expect, hasBackend, test } from "./fixtures";
import { createJoinedRoom, newUserPage } from "./helpers";

test.skip(!hasBackend || !process.env.NEXT_PUBLIC_LIVEKIT_URL, "Supabase + LiveKit env required");

/** Records system notifications instead of showing them, and pretends DUO isn't the focused window. */
const NOTIFICATION_SPY = () => {
  const w = window as unknown as { __notes: { title: string; body?: string }[] };
  w.__notes = [];
  class FakeNotification {
    static permission = "granted";
    static requestPermission = async () => "granted";
    onclick: (() => void) | null = null;
    constructor(title: string, opts?: { body?: string }) {
      w.__notes.push({ title, body: opts?.body });
    }
    close() {}
  }
  Object.defineProperty(window, "Notification", { value: FakeNotification, configurable: true });
  document.hasFocus = () => false;
};

test("knock & presence: Home shows where your person is, knocks and calls alert you, one click to join", async ({ browser }) => {
  test.setTimeout(150_000);
  const hana = await newUserPage(browser, "Hana");
  const gabe = await newUserPage(browser, "Gabe");
  const { roomUrl } = await createJoinedRoom(hana, gabe, "Presence test");
  await hana.context().addInitScript(NOTIFICATION_SPY);
  await hana.goto("/home");
  const card = hana.getByTestId("room-card").filter({ hasText: "Presence test" });
  // Gabe is on the room page already (createJoinedRoom left him there).
  await expect(card.getByTestId("room-presence")).toHaveAttribute("data-state", "room", { timeout: 20_000 });
  await expect(card).toContainText("Gabe is in the room");

  // Gabe sees Hana is around (on Home) and knocks.
  await gabe.reload();
  await expect(gabe.getByTestId("presence-banner")).toHaveAttribute("data-tone", "online", { timeout: 20_000 });
  await gabe.getByTestId("knock").click();
  await expect(hana.getByText("Gabe is knocking 👋")).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(() => hana.evaluate(() => (window as unknown as { __notes: { title: string }[] }).__notes.map((n) => n.title)))
    .toContain("Gabe is knocking");
  // Knocks are rate limited on the sender.
  await expect(gabe.getByTestId("knock")).toBeDisabled();

  // Gabe starts the call → Hana's card flips to "in the call" with a Join button, and she's notified.
  await gabe.getByRole("button", { name: "Join call" }).click();
  await expect(gabe.getByTestId("meeting-room")).toBeVisible({ timeout: 20_000 });
  await expect(card.getByTestId("room-presence")).toHaveAttribute("data-state", "call", { timeout: 20_000 });
  await expect
    .poll(() => hana.evaluate(() => (window as unknown as { __notes: { title: string }[] }).__notes.map((n) => n.title)))
    .toContain("Gabe started a call");

  // One click from Home into the room, then "Join now" from the presence banner.
  await card.getByRole("link", { name: "Join" }).click();
  await expect(hana).toHaveURL(roomUrl);
  await expect(hana.getByTestId("presence-banner")).toHaveAttribute("data-tone", "call", { timeout: 20_000 });
  await expect(hana.getByTestId("presence-banner")).toContainText("Gabe is in the call");
  await hana.getByTestId("join-partner").click();
  await expect(hana.getByTestId("meeting-room")).toBeVisible({ timeout: 20_000 });
  await expect(gabe.getByTestId("tile-remote")).toContainText("Hana", { timeout: 20_000 });
});
