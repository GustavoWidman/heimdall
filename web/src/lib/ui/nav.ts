/**
 * Every destination in the app. The tab bar, the desktop bar, the more page, and the
 * keyboard shortcuts all read this list, so a new screen is one entry here plus its route.
 */
export type Destination = {
	readonly path:
		| '/'
		| '/history'
		| '/week'
		| '/month'
		| '/year'
		| '/insights'
		| '/tasks'
		| '/checkin'
		| '/settings';
	readonly label: string;
	/** Pressed alone, outside a text field, it navigates here. */
	readonly key: string;
	/** An svg path in a 24 by 24 box, stroked. */
	readonly icon: string;
	/** On the mobile tab bar; the rest live under more. */
	readonly tab?: boolean;
};

export const DESTINATIONS: readonly Destination[] = [
	{
		path: '/',
		label: 'today',
		key: 't',
		tab: true,
		icon: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M12 7.5V12l3 2'
	},
	{
		path: '/history',
		label: 'history',
		key: 'h',
		tab: true,
		icon: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v3.5H8M12 8.5V12l2.5 1.5'
	},
	{ path: '/week', label: 'week', key: 'w', icon: 'M4 6.5h16M4 12h16M4 17.5h16M8 4v16' },
	{ path: '/month', label: 'month', key: 'm', icon: 'M4 5h16v15H4zM4 10h16M9 5v15M14 5v15' },
	{
		path: '/year',
		label: 'year',
		key: 'y',
		icon: 'M4 4h4v4H4zM10 4h4v4h-4zM16 4h4v4h-4zM4 10h4v4H4zM10 10h4v4h-4zM16 10h4v4h-4zM4 16h4v4H4zM10 16h4v4h-4z'
	},
	{
		path: '/insights',
		label: 'insights',
		key: 'i',
		tab: true,
		icon: 'M4 19.5h16M7 16v-4M12 16V6.5M17 16V10'
	},
	{
		path: '/tasks',
		label: 'tasks',
		key: 'l',
		icon: 'M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01'
	},
	{
		path: '/checkin',
		label: 'check-in',
		key: 'e',
		icon: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z'
	},
	{
		path: '/settings',
		label: 'settings',
		key: ',',
		icon: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8'
	}
];

export const MORE_ICON =
	'M4.6 12a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0M10.7 12a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0M16.8 12a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0';
