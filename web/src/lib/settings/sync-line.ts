import type { SyncStatus } from '#lib/app/app.svelte.ts';

const MINUTE = 60_000;

function ago(ms: number): string {
	const m = Math.floor(ms / MINUTE);
	if (m < 1) return 'just now';
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

/** One plain sentence for where sync stands. Nothing here is an error to fix. */
export function syncLine(status: SyncStatus, now: number): string {
	switch (status.kind) {
		case 'idle':
			return status.lastOk === null
				? 'not synced yet from this device.'
				: `synced ${ago(now - status.lastOk)}.`;
		case 'syncing':
			return 'syncing…';
		case 'offline':
			return 'the server is out of reach. changes wait here and go out when it is back.';
		case 'needs-login':
			return 'not signed in. everything stays on this device.';
	}
}
