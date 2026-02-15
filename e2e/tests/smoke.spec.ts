import { test, expect } from "@playwright/test";

test("lab route loads", async ({ page }) => {
  await page.goto("/lab");
  await expect(page.getByRole("heading", { name: "The Lab (v2)" })).toBeVisible();
});

test("league intel route loads", async ({ page }) => {
  await page.goto("/league-intel");
  await expect(page.getByRole("heading", { name: "League Intel (v2)" })).toBeVisible();
});
