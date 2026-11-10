/**
 * The color theme is a per-device choice, so it lives in localStorage rather than in the
 * replicated settings. An inline script in app.html applies it before first paint; keep the
 * storage key and colors there in step with these.
 */
export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

const KEY = 'heimdall-theme';
const BAR = { light: '#f3f2ee', dark: '#0c0c0d' } as const;

export function storedTheme(): Theme {
	try {
		const t = localStorage.getItem(KEY);
		return t === 'light' || t === 'dark' ? t : 'system';
	} catch {
		return 'system';
	}
}

export function applyTheme(theme: Theme): void {
	try {
		if (theme === 'system') localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, theme);
	} catch {
		// Storage can be off in a private window; the choice still holds for this visit.
	}
	const root = document.documentElement;
	if (theme === 'system') delete root.dataset.theme;
	else root.dataset.theme = theme;
	for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
		const own = meta.media.includes('dark') ? BAR.dark : BAR.light;
		meta.content = theme === 'system' ? own : BAR[theme];
	}
}
