/**
 * Fails when a route ships more JS or CSS than its budget in perf-budget.json allows.
 * Reads the Vite manifest and SvelteKit's route table from the last `vite build`, and for
 * each route sums the gzip size of everything a cold visit loads before the route renders:
 * the client entries, the root layout, any nested layouts, the page, and their static
 * imports and stylesheets. Lazy imports are left out, since they are not on that path.
 *
 *   bun scripts/budget.ts
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const WEB = resolve(import.meta.dir, '..');
const OUT = join(WEB, '.svelte-kit/output/client');
const GENERATED = '.svelte-kit/generated/build/client-optimized';

type Chunk = { file: string; imports?: string[]; css?: string[]; isEntry?: boolean };
type Limits = { js: number; css: number };
type Budget = { default: Limits; routes: Record<string, Partial<Limits>> };

const manifest: Record<string, Chunk> = JSON.parse(
	readFileSync(join(OUT, '.vite/manifest.json'), 'utf8')
);
const budget: Budget = JSON.parse(readFileSync(join(WEB, 'perf-budget.json'), 'utf8'));

/** `"/route": [leaf, [layouts]?, ...]`, as SvelteKit writes it into the generated app.js. */
function routeTable(): Record<string, number[]> {
	const app = readFileSync(join(WEB, GENERATED, 'app.js'), 'utf8');
	const body = /export const dictionary = (\{[\s\S]*?\n\t\});/.exec(app)?.[1];
	if (!body) throw new Error(`no route dictionary in ${GENERATED}/app.js`);
	const table = JSON.parse(body.replace(/~/g, '').replace(/,(\s*[}\]])/g, '$1')) as Record<
		string,
		[number, number[]?]
	>;
	return Object.fromEntries(
		Object.entries(table).map(([route, [leaf, layouts = []]]) => [route, [...layouts, leaf]])
	);
}

const gz = new Map<string, number>();
function gzipBytes(file: string): number {
	let n = gz.get(file);
	if (n === undefined) {
		n = gzipSync(readFileSync(join(OUT, file)), { level: 9 }).length;
		gz.set(file, n);
	}
	return n;
}

function closure(keys: string[]) {
	const js = new Set<string>();
	const css = new Set<string>();
	const visit = (key: string) => {
		const chunk = manifest[key];
		if (!chunk) throw new Error(`${key} is not in the Vite manifest`);
		if (js.has(chunk.file)) return;
		js.add(chunk.file);
		for (const c of chunk.css ?? []) css.add(c);
		for (const i of chunk.imports ?? []) visit(i);
	};
	keys.forEach(visit);
	return { js, css };
}

const entries = Object.keys(manifest).filter(
	(k) => manifest[k].isEntry && !k.startsWith(`${GENERATED}/nodes/`)
);
const node = (n: number) => `${GENERATED}/nodes/${n}.js`;
const sum = (files: Set<string>) => [...files].reduce((a, f) => a + gzipBytes(f), 0);
const kib = (n: number) => (n / 1024).toFixed(1).padStart(6);

let over = 0;
console.log('route                    js gzip KiB (budget)   css gzip KiB (budget)');
for (const [route, nodes] of Object.entries(routeTable()).sort()) {
	const { js, css } = closure([...entries, node(0), ...nodes.map(node)]);
	const limits = { ...budget.default, ...budget.routes[route] };
	const size = { js: sum(js) / 1024, css: sum(css) / 1024 };
	const bad = (['js', 'css'] as const).filter((k) => size[k] > limits[k]);
	over += bad.length;
	console.log(
		`${route.padEnd(22)} ${kib(size.js * 1024)} (${String(limits.js).padStart(4)})${bad.includes('js') ? ' OVER' : '     '}   ${kib(size.css * 1024)} (${String(limits.css).padStart(4)})${bad.includes('css') ? ' OVER' : ''}`
	);
}
if (over) {
	console.error(
		`\n${over} budget(s) exceeded. Shrink the route, or raise its line in perf-budget.json.`
	);
	process.exit(1);
}
