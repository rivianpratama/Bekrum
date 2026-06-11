import { expect, test } from "@playwright/test";

test("two peers create, join, and start a host-authoritative game", async ({ context }) => {
  const errors: string[] = [];
  const host = await context.newPage();
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
  peer.on("pageerror", (error) => errors.push(`peer: ${error.message}`));
  await peer.goto("/");
  await peer.getByLabel("CALLSIGN").fill("Peer");
  await peer.getByLabel("Room code").fill(code!);
  await peer.getByRole("button", { name: "JOIN ROOM" }).click();

  await expect(host.getByText("Peer")).toBeVisible({ timeout: 10_000 });
  await expect(peer.getByText("Host", { exact: true })).toBeVisible({ timeout: 10_000 });
  await host.getByRole("button", { name: "START DESCENT" }).click();

  await expect(host.locator("canvas")).toBeVisible();
  await expect(peer.locator("canvas")).toBeVisible({ timeout: 10_000 });
  await expect(host.getByText("REGROUP. WEAKEN IT. HOLD E TO STOMP.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("development host can start a solo enemy chase session", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("CALLSIGN").fill("Solo Tester");
  await page.getByRole("button", { name: "CREATE ROOM" }).click();
  const soloStart = page.getByRole("button", { name: "START SOLO DEBUG" });
  await expect(soloStart).toBeVisible();
  await soloStart.click();

  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByLabel("Solo debug map")).toBeVisible();
  await expect(page.getByText("REGROUP. WEAKEN IT. HOLD E TO STOMP.")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByText("DEFEAT")).not.toBeVisible();
});
