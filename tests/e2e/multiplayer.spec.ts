import { expect, test } from "@playwright/test";

test("two peers create, join, and start a host-authoritative game", async ({ context }) => {
  const errors: string[] = [];
  const host = await context.newPage();
  await host.route("**/assets/enemy.splat", (route) => route.abort());
  await host.route("**/assets/clutter/*.splat", (route) => route.abort());
  host.on("pageerror", (error) => errors.push(`host: ${error.message}`));
  await host.goto("/");
  await expect(host).toHaveTitle("BEKRUM");
  await expect(host.getByRole("heading", { name: "BEKRUM" })).toBeVisible();
  await host.getByLabel("CALLSIGN").fill("Host");
  await host.getByRole("button", { name: "CREATE ROOM" }).click();
  await expect(host.getByText("ROOM CODE")).toBeVisible();
  const code = (await host.locator(".room-code").textContent())?.trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);

  const peer = await context.newPage();
  await peer.route("**/assets/enemy.splat", (route) => route.abort());
  await peer.route("**/assets/clutter/*.splat", (route) => route.abort());
  peer.on("pageerror", (error) => errors.push(`peer: ${error.message}`));
  await peer.goto("/");
  await peer.getByLabel("CALLSIGN").fill("Peer");
  await peer.getByLabel("Room code").fill(code!);
  await peer.getByRole("button", { name: "JOIN ROOM" }).click();

  await expect(host.getByText("Peer")).toBeVisible({ timeout: 10_000 });
  await expect(peer.getByText("Host", { exact: true })).toBeVisible({ timeout: 10_000 });
  await host.getByLabel("MAP SIZE").selectOption("medium");
  await host.getByRole("button", { name: "START DESCENT" }).click();

  await expect(host.locator("canvas")).toBeVisible();
  await expect(peer.locator("canvas")).toBeVisible({ timeout: 10_000 });
  await expect(host.getByText("REGROUP. WEAKEN IT. HOLD E TO STOMP.")).toBeVisible();
  await expect
    .poll(() => host.locator("canvas").getAttribute("data-clutter-visual"))
    .toBe("fallback");
  expect(errors).toEqual([]);
});

test("development host can start a solo enemy chase session", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?debug=1");
  await page.getByLabel("CALLSIGN").fill("Solo Tester");
  await page.getByRole("button", { name: "CREATE ROOM" }).click();
  const soloStart = page.getByRole("button", { name: "START SOLO DEBUG" });
  await expect(soloStart).toBeVisible();
  await soloStart.click();

  await expect(page.getByLabel("First person game view")).toBeVisible();
  await expect(page.getByLabel("Solo debug map")).toBeVisible();
  await expect(page.getByText("REGROUP. WEAKEN IT. HOLD E TO STOMP.")).toBeVisible();
  await expect(page.getByText("PLAYER CAMERA")).toBeVisible();
  await page.keyboard.press("KeyV");
  await expect(page.getByLabel("Enemy third person view")).toBeVisible();
  await expect(page.getByText("ENTITY CAMERA")).toBeVisible();
  await expect
    .poll(
      () => page.getByLabel("Enemy third person view").getAttribute("data-enemy-visual"),
      { timeout: 20_000 },
    )
    .toBe("splat");
  await page.keyboard.press("KeyV");
  await expect(page.getByLabel("First person game view")).toBeVisible();
  const positionText = async () =>
    (await page.locator(".debug-overlay").textContent())?.match(/you ([^\n]+)/)?.[1];
  const before = await positionText();
  await page.getByRole("button", { name: "CLICK TO ENTER" }).click();
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(700);
  await page.keyboard.up("KeyW");
  await expect.poll(positionText).not.toBe(before);
  await page.waitForTimeout(500);
  await expect(page.getByText("DEFEAT")).not.toBeVisible();
  expect(errors).toEqual([]);
});
