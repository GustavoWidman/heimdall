import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const routes = fileURLToPath(new URL('../../routes', import.meta.url));

function files(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory()
			? files(join(dir, e.name))
			: /\.(svelte|ts|js)$/.test(e.name)
				? [join(dir, e.name)]
				: []
	);
}

const IMPORT =
	/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;

function importsOf(source: string): string[] {
	return [...source.matchAll(IMPORT)].map((m) => m[1] ?? m[2] ?? m[3]);
}

const reachesReplica = (spec: string) => /(^|\/)replica(\/|$)/.test(spec);

describe('routes', () => {
	it('never import the replication layer, only $lib/app', () => {
		const found = files(routes).flatMap((file) =>
			importsOf(readFileSync(file, 'utf8'))
				.filter(reachesReplica)
				.map((spec) => `${file}: ${spec}`)
		);
		expect(found).toEqual([]);
	});

	it('catches every import form the check relies on', () => {
		const source = [
			`import { Replica } from '$lib/replica/replica.svelte';`,
			`import type { Op } from "#lib/replica/op";`,
			`export { Sync } from '../lib/replica/sync';`,
			`const m = await import('$lib/replica/store');`,
			`import '$lib/replica/op';`,
			`import { app } from '$lib/app/app.svelte';`
		].join('\n');
		expect(importsOf(source).filter(reachesReplica)).toHaveLength(5);
	});
});
