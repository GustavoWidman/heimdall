import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests against the product as it ships: the production build served by the
 * release server, one fresh server per test. `nix develop -c e2e` builds both and runs this.
 */
export default defineConfig({
	testDir: 'tests',
	testMatch: '**/*.e2e.ts',
	globalSetup: './tests/support/global-setup.ts',
	fullyParallel: true,
	workers: process.env.CI ? 2 : undefined,
	retries: 0,
	timeout: 60_000,
	expect: { timeout: 7_000 },
	reporter: [['list']],
	use: {
		timezoneId: 'America/Sao_Paulo',
		locale: 'en-US',
		trace: 'retain-on-failure'
	},
	projects: [
		{
			name: 'phone',
			use: {
				browserName: 'webkit',
				viewport: { width: 390, height: 844 },
				deviceScaleFactor: 3,
				isMobile: true,
				hasTouch: true
			}
		},
		{
			name: 'desktop',
			use: {
				browserName: 'chromium',
				viewport: { width: 1440, height: 900 },
				deviceScaleFactor: 1,
				hasTouch: false
			}
		}
	]
});
