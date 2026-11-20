import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { seedUIState, isolateSyncedUISettings } from "./ui-state-fixture.js";
import { openChatSettings, closeChatSettings, drawerToggle } from "./chat-settings-tools.js";

const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version as string;

test("fork features remain available in the upstream shell", async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const created = await request.post("/api/chats", {
    data: { name: "Fork integration", mode: "roleplay", characterIds: [] },
  });
  expect(created.ok()).toBeTruthy();
  const chat = (await created.json()) as { id: string };
  expect(
    (
      await request.patch(`/api/chats/${chat.id}/metadata`, {
        data: { reagent: { enabled: true } },
      })
    ).ok(),
  ).toBeTruthy();
  await isolateSyncedUISettings(page);
  await seedUIState(page, {
    hasCompletedOnboarding: true,
    sidebarOpen: false,
    rightPanelOpen: false,
    chatHelpSeenModes: ["conversation", "roleplay", "game"],
  });
  await page.addInitScript(
    ({ id, version }) => {
      localStorage.setItem("marinara-active-chat-id", id);
      localStorage.setItem("marinara:whats-new:seen-version", version);
    },
    { id: chat.id, version },
  );
  await page.goto("/");
  await expect(page.locator('[data-chat-mode="roleplay"]')).toBeVisible();
  const settings = await openChatSettings(page);
  const reagent = settings.locator('[data-chat-settings-section="reagent"]');
  await reagent.scrollIntoViewIfNeeded();
  const toggle = drawerToggle(reagent);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(reagent.getByRole("button", { name: "Edit memory.md", exact: true })).toBeVisible();
  await closeChatSettings(page);

  const worldButton = page.locator('[data-tour="panel-world"]');
  if (await worldButton.isVisible()) await worldButton.click();
  else {
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Living World", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "World settings", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("living-world.png") });

  const noodle = page.locator('[data-tour="noodle-tab"]');
  const loaded = page.waitForResponse((response) => response.url().includes("/api/noodle") && response.ok());
  await noodle.click();
  await loaded;
  await expect(noodle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-chat-mode="roleplay"]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("noodle.png") });
  expect(errors).toEqual([]);
});
