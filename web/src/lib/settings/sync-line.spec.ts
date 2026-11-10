import { describe, expect, it } from 'vitest';
import { syncLine } from './sync-line';

const now = 10_000_000_000;

describe('the sync line', () => {
	it('says how long ago the last sync landed', () => {
		expect(syncLine({ kind: 'idle', lastOk: now - 20_000 }, now)).toBe('synced just now.');
		expect(syncLine({ kind: 'idle', lastOk: now - 5 * 60_000 }, now)).toBe('synced 5m ago.');
		expect(syncLine({ kind: 'idle', lastOk: now - 3 * 3_600_000 }, now)).toBe('synced 3h ago.');
		expect(syncLine({ kind: 'idle', lastOk: now - 72 * 3_600_000 }, now)).toBe('synced 3d ago.');
	});

	it('describes every other state without alarm', () => {
		expect(syncLine({ kind: 'idle', lastOk: null }, now)).toBe('not synced yet from this device.');
		expect(syncLine({ kind: 'syncing' }, now)).toBe('syncing…');
		expect(syncLine({ kind: 'offline', retryAt: now }, now)).toMatch(/changes wait here/);
		expect(syncLine({ kind: 'needs-login' }, now)).toMatch(/stays on this device/);
	});
});
