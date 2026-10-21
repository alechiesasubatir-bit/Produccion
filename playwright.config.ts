import { defineConfig, devices } from '@playwright/test'

// E2E de la tablet. Supabase se simula por completo en e2e/mocks.ts: nunca toca la base real.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:5180/Produccion/',
    viewport: { width: 1180, height: 820 },
  },
  webServer: {
    command: 'npm run dev -- --port 5180 --strictPort',
    url: 'http://localhost:5180/Produccion/',
    reuseExistingServer: !process.env.CI,
  },
})
