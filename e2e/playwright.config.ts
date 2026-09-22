import { HEALTH_PATH } from '@pantograph/shared';
import { defineConfig } from '@playwright/test';
import { FAKE_BACKEND_ORIGIN } from './fakeBackendConfig.ts';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: FAKE_BACKEND_ORIGIN,
    browserName: 'chromium',
  },
  webServer: {
    command: 'node fakeBackend.ts',
    url: `${FAKE_BACKEND_ORIGIN}${HEALTH_PATH}`,
    reuseExistingServer: false,
  },
});
