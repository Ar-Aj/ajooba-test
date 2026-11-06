import { defineConfig } from "@playwright/test";

export default defineConfig({
  name: "Ajooba Footwear - end-to-end",
  description:
    "Browser-level end-to-end tests. Boots a throwaway MongoDB, the real API and the real storefront, seeds synthetic fixtures, and drives them through Chromium.",
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
});
