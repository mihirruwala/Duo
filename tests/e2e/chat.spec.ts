import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";
import { expect, hasBackend, test } from "./fixtures";
import { createJoinedRoom, emailOf, newUserPage, PASSWORD } from "./helpers";

test.skip(!hasBackend, "Supabase env not configured");

const hasGiphy = Boolean(process.env.GIPHY_API_KEY);

async function openChat(page: Page) {
  // The dock remembers being open across reloads; only click the launcher when it is closed.
  const panel = page.getByTestId("chat-panel");
  const launcher = page.getByTestId("chat-launcher");
  await expect(panel.or(launcher)).toBeVisible();
  if (await launcher.isVisible()) await launcher.click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  await expect(page.getByTestId("composer")).toBeVisible();
}

const msg = (page: Page, text: string) => page.getByTestId("chat-message").filter({ hasText: text });

async function hoverAction(page: Page, text: string, action: string) {
  // first(): later messages can match too, because a reply quote repeats the original text.
  const m = msg(page, text).first();
  await m.hover();
  await m.getByRole("button", { name: action, exact: true }).click();
}

/** M3 gate: every chat acceptance behaviour between two real sessions. */
test("chat: realtime, replies, reactions, edits, receipts, media, Moments, persistence", async ({ browser }) => {
  test.setTimeout(180_000);
  const host = await newUserPage(browser, "Hana");
  const guest = await newUserPage(browser, "Gabe");
  const { roomUrl } = await createJoinedRoom(host, guest, "Chat test");
  await host.goto(roomUrl);
  await openChat(host);
  await openChat(guest);
  await expect(host.getByTestId("presence")).toHaveAttribute("data-online", "", { timeout: 15_000 });

  // Typing indicator.
  await host.getByTestId("composer").pressSequentially("hel", { delay: 50 });
  await expect(guest.getByTestId("typing-indicator")).toContainText("Hana is typing");

  // Instant delivery (measured), optimistic on the sender side.
  await host.getByTestId("composer").fill("hello gabe 👋");
  const sentAt = Date.now();
  await host.getByTestId("composer").press("Enter");
  await expect(msg(host, "hello gabe")).toBeVisible();
  await expect(msg(guest, "hello gabe")).toBeVisible({ timeout: 5_000 });
  const latency = Date.now() - sentAt;
  console.log(`message delivery latency: ${latency} ms`);
  expect(latency).toBeLessThan(3_000);
  await expect(guest.getByTestId("typing-indicator")).toHaveCount(0);

  // Read receipt: Gabe has the chat open → Hana sees "Read".
  await guest.bringToFront();
  await expect(host.getByTestId("receipt")).toHaveText(/Read/, { timeout: 15_000 });

  // Reply with a quoted preview; clicking it jumps to the original.
  await hoverAction(guest, "hello gabe", "Reply");
  await expect(guest.getByTestId("reply-bar")).toContainText("Replying to Hana");
  await guest.getByTestId("composer").fill("hi hana!");
  await guest.getByTestId("composer").press("Enter");
  const reply = msg(host, "hi hana!");
  await expect(reply.getByTestId("reply-quote")).toContainText("hello gabe");
  await reply.getByTestId("reply-quote").click();
  await expect(msg(host, "hello gabe").first()).toHaveClass(/bg-coral/);

  // Reactions sync both ways with counts.
  const hostMsg = msg(guest, "hello gabe").first();
  await hostMsg.hover();
  await hostMsg.getByRole("button", { name: "React", exact: true }).click();
  await guest.getByRole("button", { name: "React ❤️" }).click();
  await expect(msg(host, "hello gabe").first().getByTestId("reaction-chip")).toContainText("1");
  await msg(host, "hello gabe").first().getByTestId("reaction-chip").click();
  await expect(msg(guest, "hello gabe").first().getByTestId("reaction-chip")).toContainText("2");

  // Edit → "edited" marker on both sides.
  await hoverAction(host, "hello gabe", "Edit");
  await host.getByLabel("Edit message").fill("hello gabe (edited)");
  await host.getByLabel("Edit message").press("Enter");
  await expect(msg(guest, "hello gabe (edited)").getByTestId("edited")).toBeVisible();

  // Delete → tombstone on both sides.
  await host.getByTestId("composer").fill("oops wrong chat");
  await host.getByTestId("composer").press("Enter");
  await expect(msg(guest, "oops wrong chat")).toBeVisible();
  await hoverAction(host, "oops wrong chat", "Delete");
  await host.getByRole("button", { name: "Delete?" }).click();
  await expect(guest.getByText("This message was deleted")).toBeVisible();
  await expect(msg(guest, "oops wrong chat")).toHaveCount(0);

  // Sticker.
  await host.getByRole("button", { name: "Stickers" }).click();
  await host.getByRole("button", { name: "Send sticker: Sleepy moon" }).click();
  await expect(guest.getByRole("img", { name: "Sleepy moon" })).toBeVisible();

  // Image: upload with progress → inline on the other side → full-screen viewer.
  const png = await host.screenshot({ clip: { x: 0, y: 0, width: 320, height: 200 } });
  await host.getByTestId("file-input").setInputFiles({ name: "sunset.png", mimeType: "image/png", buffer: png });
  const guestImage = guest.getByTestId("chat-image").last();
  await expect(guestImage).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => guestImage.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await guestImage.click();
  await expect(guest.getByTestId("viewer-image")).toBeVisible();
  await guest.keyboard.press("+");
  await expect(guest.getByTestId("image-viewer")).toContainText("150%");
  await guest.keyboard.press("Escape");
  await expect(guest.getByTestId("image-viewer")).toHaveCount(0);

  // File: private storage + signed download link.
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  await guest.getByTestId("file-input").setInputFiles({ name: "../../plans/trip.pdf", mimeType: "application/pdf", buffer: pdf });
  const fileCard = host.getByTestId("chat-file").filter({ hasText: "trip.pdf" });
  await expect(fileCard).toBeVisible({ timeout: 20_000 });
  await expect(fileCard).not.toContainText("plans"); // path stripped
  const downloadPromise = host.waitForEvent("download");
  await fileCard.getByRole("button", { name: /Download/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("trip.pdf");

  // Rejected type (client-side check; server + bucket re-check too).
  await guest
    .getByTestId("file-input")
    .setInputFiles({ name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  await expect(guest.getByText(/isn't a supported type/)).toBeVisible();

  // GIF search + send (only when a GIPHY key is configured).
  if (hasGiphy) {
    await host.getByRole("button", { name: "GIFs" }).click();
    await host.getByTestId("gif-search").fill("cat");
    await host.getByTestId("gif-results").getByRole("button").first().click();
    await expect(guest.getByRole("button", { name: /Open GIF/ }).last()).toBeVisible({ timeout: 10_000 });
  }

  // Moments: Gabe saves the photo → Hana sees it in the shared collection.
  const lastImg = guest
    .getByTestId("chat-message")
    .filter({ has: guest.getByTestId("chat-image") })
    .last();
  await lastImg.hover();
  await lastImg.getByRole("button", { name: "Save to Moments" }).click();
  await host.getByRole("tab", { name: "Moments" }).click();
  await expect(host.getByTestId("moments-grid").getByRole("button", { name: /Open/ })).toHaveCount(1, { timeout: 10_000 });

  // Media gallery lists photos and files.
  await host.getByRole("tab", { name: "Media" }).click();
  await expect(host.getByTestId("media-gallery")).toContainText("trip.pdf");
  await expect(host.getByTestId("media-gallery").getByRole("button", { name: /Open/ }).first()).toBeVisible();
  await host.getByRole("tab", { name: "Chat" }).click();

  // Unread badge when collapsed.
  await guest.getByTestId("chat-minimize").click();
  await host.getByTestId("composer").fill("are you there?");
  await host.getByTestId("composer").press("Enter");
  await expect(guest.getByTestId("unread-badge")).toHaveText("1");

  // Persistence: a fresh load (new session in a new context) shows the full history.
  await guest.reload();
  await openChat(guest);
  await expect(msg(guest, "hello gabe (edited)").getByTestId("edited")).toBeVisible();
  await expect(msg(guest, "hi hana!").getByTestId("reply-quote")).toContainText("hello gabe");
  await expect(msg(guest, "hello gabe (edited)").getByTestId("reaction-chip")).toContainText("2");
  await expect(guest.getByText("This message was deleted")).toBeVisible();
  await expect(guest.getByRole("img", { name: "Sleepy moon" })).toBeVisible();
  await expect(guest.getByTestId("chat-image").first()).toBeVisible();
});

test("outsiders can't read a room's messages, files or Moments", async ({ browser }) => {
  test.setTimeout(90_000);
  const host = await newUserPage(browser, "Hana");
  const guest = await newUserPage(browser, "Gabe");
  const { roomUrl } = await createJoinedRoom(host, guest, "Secret chat");
  await host.goto(roomUrl);
  await openChat(host);
  await host.getByTestId("composer").fill("top secret");
  await host.getByTestId("composer").press("Enter");
  const png = await host.screenshot({ clip: { x: 0, y: 0, width: 50, height: 50 } });
  await host.getByTestId("file-input").setInputFiles({ name: "secret.png", mimeType: "image/png", buffer: png });
  await expect(
    host.locator('[data-testid="chat-message"][data-status="sent"]').filter({ has: host.getByTestId("chat-image") }),
  ).toBeVisible({ timeout: 20_000 });

  const outsiderPage = await newUserPage(browser, "Otto");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const member = createClient(url, key, { auth: { persistSession: false } });
  expect((await member.auth.signInWithPassword({ email: emailOf(host), password: PASSWORD })).error).toBeNull();
  const outsider = createClient(url, key, { auth: { persistSession: false } });
  expect((await outsider.auth.signInWithPassword({ email: emailOf(outsiderPage), password: PASSWORD })).error).toBeNull();

  const { data: rooms } = await member.from("rooms").select("id").eq("slug", new URL(roomUrl).pathname.split("/").pop()!);
  const roomId = rooms![0]!.id as string;
  const { data: att } = await member.from("attachments").select("storage_path").eq("room_id", roomId);
  expect(att!.length).toBe(1);

  // Messages, attachments, Moments: invisible.
  for (const table of ["messages", "attachments", "moments", "message_reactions", "message_receipts"]) {
    const { data, error } = await outsider.from(table).select("*").eq("room_id", roomId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  }
  // Files: can't sign a download link, can't list the folder, can't download directly.
  const signed = await outsider.storage.from("attachments").createSignedUrl(att![0]!.storage_path, 60);
  expect(signed.data).toBeNull();
  const listed = await outsider.storage.from("attachments").list(roomId);
  expect(listed.data ?? []).toEqual([]);
  const direct = await outsider.storage.from("attachments").download(att![0]!.storage_path);
  expect(direct.data).toBeNull();
  // Can't post into the room.
  const post = await outsider.from("messages").insert({ room_id: roomId, client_id: crypto.randomUUID(), body: "hi" });
  expect(post.error).not.toBeNull();
  // Can't join the room's realtime channel.
  await outsider.realtime.setAuth();
  const status = await new Promise<string>((resolve) => {
    outsider.channel(`room:${roomId}`, { config: { private: true } }).subscribe((s) => resolve(s));
  });
  expect(status).not.toBe("SUBSCRIBED");
  // The member, by contrast, can sign the same file.
  const ok = await member.storage.from("attachments").createSignedUrl(att![0]!.storage_path, 60);
  expect(ok.data?.signedUrl).toBeTruthy();
});

test("rapid messages right after opening chat all arrive, in the order they were sent", async ({ browser }) => {
  test.setTimeout(90_000);
  const host = await newUserPage(browser, "Hana");
  const guest = await newUserPage(browser, "Gabe");
  const { roomUrl } = await createJoinedRoom(host, guest, "Order test");
  await host.goto(roomUrl);
  await openChat(guest);
  // Open and immediately fire, racing the initial history load.
  await host.getByTestId("chat-launcher").click();
  const texts = ["one", "two", "three", "four", "five", "six"];
  for (const t of texts) {
    await host.getByTestId("composer").fill(t);
    await host.getByTestId("composer").press("Enter");
  }
  const bodies = (page: Page) =>
    page
      .getByTestId("chat-message")
      .locator("p")
      .allInnerTexts()
      .then((xs) => xs.filter((x) => texts.includes(x)));
  await expect.poll(() => bodies(guest), { timeout: 15_000 }).toEqual(texts);
  await expect.poll(() => bodies(host), { timeout: 15_000 }).toEqual(texts);
  await expect(host.locator('[data-testid="chat-message"][data-status="sent"]')).toHaveCount(texts.length);
  // And after a reload, the persisted order is the same.
  await host.reload();
  await openChat(host);
  await expect.poll(() => bodies(host), { timeout: 15_000 }).toEqual(texts);
});
