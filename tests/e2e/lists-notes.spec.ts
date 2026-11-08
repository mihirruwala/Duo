import type { Page } from "@playwright/test";
import { expect, hasBackend, test } from "./fixtures";
import { createJoinedRoom, newUserPage } from "./helpers";

test.skip(!hasBackend, "Supabase env required");

async function openDock(p: Page, tab?: "Lists") {
  const launcher = p.getByTestId("chat-launcher");
  if (await launcher.isVisible()) await launcher.click();
  await expect(p.getByTestId("chat-panel")).toBeVisible();
  if (tab) await p.getByRole("tab", { name: tab }).click();
}

test("shared lists: create, add, tick off and edit together, live", async ({ browser }) => {
  test.setTimeout(120_000);
  const hana = await newUserPage(browser, "Hana");
  const gabe = await newUserPage(browser, "Gabe");
  const { roomUrl } = await createJoinedRoom(hana, gabe, "Lists test");
  await hana.goto(roomUrl);
  await openDock(hana, "Lists");
  await openDock(gabe, "Lists");

  // One tap on a template creates the list and opens it.
  await hana.getByRole("button", { name: "🎬 Movies to watch" }).click();
  await expect(hana.getByTestId("list-title")).toHaveText("Movies to watch");
  await expect(gabe.getByTestId("list-card")).toHaveText(/Movies to watch/, { timeout: 10_000 });

  await hana.getByTestId("list-add-input").fill("Dune: Part Two");
  await hana.keyboard.press("Enter");
  await hana.getByTestId("list-add-input").fill("Trailer https://youtu.be/aqz-KE-bpKQ");
  await hana.keyboard.press("Enter");
  await expect(gabe.getByTestId("list-card")).toHaveText(/2 to go · 0 done/, { timeout: 10_000 });

  // Gabe opens it and ticks one off; Hana sees who did it.
  await gabe.getByTestId("list-card").click();
  await expect(gabe.getByTestId("list-item")).toHaveCount(2);
  await expect(gabe.getByText("Added by Hana").first()).toBeVisible();
  await gabe.getByRole("checkbox", { name: /Mark “Dune: Part Two” as done/ }).click();
  const done = hana.getByTestId("list-item").filter({ hasText: "Dune: Part Two" });
  await expect(done).toHaveAttribute("data-done", "", { timeout: 10_000 });
  await expect(done).toContainText("Done by Gabe");

  // Edits sync too, and survive a reload.
  const trailer = hana.getByTestId("list-item").filter({ hasText: "Trailer" });
  await trailer.hover();
  await hana.getByRole("button", { name: /Edit “Trailer/ }).click();
  await hana.getByLabel("Edit item").fill("Big Buck Bunny https://youtu.be/aqz-KE-bpKQ");
  await hana.keyboard.press("Enter");
  await expect(gabe.getByTestId("list-item").filter({ hasText: "Big Buck Bunny" })).toBeVisible({ timeout: 10_000 });
  await gabe.reload();
  await openDock(gabe, "Lists");
  await expect(gabe.getByTestId("list-card")).toHaveText(/1 to go · 1 done/);

  // Deleting asks first, then removes it for both.
  await hana.getByRole("button", { name: "List options" }).click();
  await hana.getByRole("menuitem", { name: "Delete list" }).click();
  await hana.getByRole("alert").getByRole("button", { name: "Delete" }).click();
  await expect(hana.getByTestId("lists-index")).toBeVisible();
  await expect(gabe.getByTestId("list-card")).toHaveCount(0, { timeout: 10_000 });
});

test("voice and video notes: record, send, and the other person plays them", async ({ browser }) => {
  test.setTimeout(120_000);
  const hana = await newUserPage(browser, "Hana");
  const gabe = await newUserPage(browser, "Gabe");
  const { roomUrl } = await createJoinedRoom(hana, gabe, "Notes test");
  await hana.goto(roomUrl);
  await openDock(hana);
  await openDock(gabe);

  // Voice: Chrome's fake microphone plays a beep, so the recording has real sound.
  await hana.getByTestId("record-voice").click();
  await expect(hana.getByTestId("recording-bar")).toBeVisible();
  await expect(hana.getByTestId("recording-time")).toHaveText("0:02", { timeout: 10_000 });
  await hana.getByTestId("recording-send").click();

  const voice = gabe.getByTestId("voice-note");
  await expect(voice).toBeVisible({ timeout: 20_000 });
  await expect(voice.getByTestId("voice-duration")).toHaveText(/0:0[2-3]/);
  // Recorded as MP4 (AAC), which also plays on iPhones.
  await expect(voice.locator("audio")).toHaveAttribute("src", /voice-note-\d+\.m4a/);
  await voice.getByRole("button", { name: "Play voice message" }).click();
  await expect(voice).toHaveAttribute("data-playing", "", { timeout: 10_000 });
  await expect
    .poll(() => voice.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime), { timeout: 10_000 })
    .toBeGreaterThan(0.5);

  // A discarded recording sends nothing.
  await hana.getByTestId("record-voice").click();
  await expect(hana.getByTestId("recording-bar")).toBeVisible();
  await hana.getByRole("button", { name: "Discard recording" }).click();
  await expect(hana.getByTestId("recording-bar")).toHaveCount(0);

  // Live camera/mic tracks on the page before recording (the pre-call preview has its own).
  const liveTracks = () =>
    hana.evaluate(
      () =>
        Array.from(document.querySelectorAll("video"))
          .map((v) => v.srcObject)
          .filter((s): s is MediaStream => s instanceof MediaStream)
          .flatMap((s) => s.getTracks())
          .filter((t) => t.readyState === "live").length,
    );
  const before = await liveTracks();

  // Video: from the attach menu, with a live preview while recording.
  await hana.getByRole("button", { name: "Attach" }).click();
  await hana.getByTestId("record-video").click();
  await expect(hana.getByTestId("recording-bar").locator("video")).toBeVisible({ timeout: 10_000 });
  await expect(hana.getByTestId("recording-time")).toHaveText("0:02", { timeout: 10_000 });
  await hana.getByTestId("recording-send").click();

  const video = gabe.getByTestId("video-note");
  await expect(video).toBeVisible({ timeout: 20_000 });
  await video.click();
  await expect
    .poll(() => video.locator("video").evaluate((v: HTMLVideoElement) => v.videoWidth > 0 && v.currentTime > 0.3), {
      timeout: 15_000,
    })
    .toBe(true);

  // The recorder's camera and mic are released once it ends.
  await expect.poll(liveTracks).toBe(before);

  // Reply previews describe notes.
  await expect(gabe.getByTestId("chat-message").filter({ has: gabe.getByTestId("voice-note") })).toHaveCount(1);
});
