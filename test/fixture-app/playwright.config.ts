import { defineConfig } from '@playwright/test'

// CANVAS_URL is the address install.sh prints. Each canvas picks its port from
// its folder path, so the workflow reads it from the installer's output.
const url = process.env.CANVAS_URL
if (!url) throw new Error('Set CANVAS_URL to the URL install.sh printed')

export default defineConfig({
  testMatch: 'smoke.spec.ts',
  // A press on something that never shows fails in ten seconds, not at the test's own limit:
  // a test then still has time to put the registry back, and the tests after it start clean.
  use: { baseURL: url, actionTimeout: 10_000 },
  // The dev server, as users run it. `vite build` covers only index.html.
  webServer: {
    command: 'npx vite --config design-canvas/smoke/vite.config.mts',
    url,
  },
})
