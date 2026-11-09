import { expect, hasBackend, test } from "./fixtures";
import { createJoinedRoom, newUserPage } from "./helpers";

test.skip(!hasBackend || !process.env.NEXT_PUBLIC_LIVEKIT_URL, "Supabase + LiveKit env required");

test("phone layout: rooms list and tab bar, the room is the chat, calls start from a sheet, leaving returns to the chat", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const hana = await newUserPage(browser, "Hana", { phone: true });
  const gabe = await newUserPage(browser, "Gabe");
  await hana.setViewportSize({ width: 390, height: 844 });
  // Count camera starts on Hana's phone.
  await hana.addInitScript(() => {
    const w = window as unknown as { __cams: number };
    w.__cams = 0;
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c?: MediaStreamConstraints) => {
      if (c?.video) w.__cams++;
      return orig(c);
    };
  });
  const { roomUrl } = await createJoinedRoom(hana, gabe, "Phone room");

  // Home: big title, the room as a list row, the tab bar.
  await hana.goto("/home");
  await expect(hana.getByRole("heading", { name: "Rooms", level: 1 })).toBeVisible();
  const tabs = hana.getByRole("navigation", { name: "Main" });
  await expect(tabs.getByRole("link", { name: "Rooms" })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "Settings" }).click();
  await expect(hana).toHaveURL(/\/settings$/);
  await expect(hana.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await tabs.getByRole("link", { name: "Rooms" }).click();
  await hana.getByTestId("room-card").filter({ hasText: "Phone room" }).click();
  await expect(hana).toHaveURL(roomUrl);

  // The room screen is the chat, with its own top bar; no camera is on.
  await expect(hana.getByTestId("chat-panel")).toHaveAttribute("data-room-screen", "");
  await expect(hana.getByTestId("room-info-button")).toContainText("Gabe");
  await expect(hana.getByRole("button", { name: "Join call" })).toHaveCount(0);
  await gabe.goto(roomUrl);
  const launcher = gabe.getByTestId("chat-launcher");
  if (await launcher.isVisible()) await launcher.click();
  await gabe.getByTestId("composer").fill("hi from the laptop");
  await gabe.getByTestId("composer").press("Enter");
  await expect(hana.getByText("hi from the laptop")).toBeVisible({ timeout: 10_000 });
  expect(await hana.evaluate(() => (window as unknown as { __cams: number }).__cams)).toBe(0);

  // Touch gestures on a message, with real touch input: swipe right to reply, press and hold for actions.
  const cdp = await hana.context().newCDPSession(hana);
  let b = (await hana.getByText("hi from the laptop").boundingBox())!;
  const at = (x: number) => [{ x, y: b.y + b.height / 2 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(b.x + 10) });
  for (let dx = 10; dx <= 130; dx += 15) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(b.x + 10 + dx) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(hana.getByTestId("reply-bar")).toContainText("Replying to Gabe");
  await hana.getByRole("button", { name: "Cancel reply" }).click();
  await expect(hana.getByTestId("reply-bar")).toHaveCount(0);

  const toolbar = hana.getByTestId("chat-message").filter({ hasText: "hi from the laptop" }).getByRole("toolbar");
  await expect(toolbar).toHaveCSS("opacity", "0");
  // Closing the reply bar moved the (bottom-anchored) messages: measure again.
  b = (await hana.getByText("hi from the laptop").boundingBox())!;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(b.x + 10) });
  const msg = hana.getByTestId("chat-message").filter({ hasText: "hi from the laptop" });
  await expect(msg).toHaveAttribute("data-held", "", { timeout: 2000 });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(toolbar).toHaveCSS("opacity", "1");
  await expect(toolbar.getByRole("button", { name: "Reply" })).toBeVisible();

  // Room info sheet.
  await hana.getByTestId("room-info-button").click();
  await expect(hana.getByTestId("room-info-sheet")).toContainText("locked to you two");
  await hana.getByRole("button", { name: "Close phone room" }).click();
  await expect(hana.getByTestId("room-info-sheet")).toHaveCount(0);

  // Call sheet: the camera starts only now; join; full-screen call.
  await hana.getByTestId("phone-call-button").click();
  await expect(hana.getByTestId("call-sheet")).toBeVisible();
  await expect.poll(() => hana.evaluate(() => (window as unknown as { __cams: number }).__cams)).toBeGreaterThan(0);
  await hana.getByTestId("call-sheet").getByRole("button", { name: "Join call" }).click();
  await expect(hana.getByTestId("meeting-room")).toBeVisible({ timeout: 20_000 });
  await expect(hana.getByTestId("call-sheet")).toHaveCount(0);
  // (His floating chat sits over the desktop Join button; tuck it away first.)
  await gabe.getByRole("button", { name: "Minimize chat" }).click();
  await gabe.getByRole("button", { name: "Join call" }).click();
  await expect(hana.getByTestId("tile-remote")).toBeVisible({ timeout: 20_000 });
  // Gabe fills the screen; Hana floats.
  await expect(hana.getByTestId("call-stage")).toHaveAttribute("data-main", "them");
  const box = await hana.getByTestId("tile-remote").boundingBox();
  expect(box?.width).toBe(390);

  // Gabe's top bar on his side says she's in a call... and Hana leaves: back to the chat, not an "ended" page.
  await hana.getByRole("button", { name: "Leave call" }).click();
  await expect(hana.getByTestId("meeting-room")).toHaveCount(0);
  await expect(hana.getByTestId("call-ended")).toHaveCount(0);
  await expect(hana.getByTestId("chat-panel")).toHaveAttribute("data-room-screen", "");
  await expect(hana.getByText("hi from the laptop")).toBeVisible();
});
