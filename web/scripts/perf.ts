/**
 * Measures heimdall as production serves it: the release server with `--web-dir`, a temp
 * data dir, a known password, and plain-http cookies. Chromium runs with 4x CPU throttling
 * as the phone proxy; WebKit runs unthrottled. Both use a 390x844 touch viewport.
 *
 *   bun scripts/perf.ts [--runs 5] [--taps 60] [--out results.json]
 *     [--only bytes,cold,warm,idle,tap,heavy,server] [--build label=webDir[@serverBin]]...
 *     [--profile dir]
 *
 * Sections:
 *   bytes   JS, CSS, and fonts each route loads cold, as transfer sizes the server sends
 *           for identity, gzip, and br, plus the encoding the browser negotiated.
 *   cold    first visit on a fresh profile and an empty account: FCP, LCP, CLS, long tasks.
 *   warm    a fresh tab once the service worker controls the origin, with a year of data.
 *   idle    Today left open: API requests and main-thread time per second.
 *   tap     Today's tap to the next paint that shows the new focus.
 *   heavy   in-app navigation to year and insights (90 days), cold and warm aggregate cache.
 *   server  push and pull of the seeded log, time to first byte of a full pull, memory.
 *
 * Several --build flags alternate run by run, so drift and warmup favor none of them.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
	chromium,
	webkit,
	type BrowserContext,
	type BrowserType,
	type CDPSession,
	type ElementHandle,
	type Page
} from '@playwright/test';
import { addDays } from '../src/lib/domain/time.ts';
import type { Op } from '../src/lib/replica/op.ts';
import { seedYear } from './perf-seed.ts';

const WEB = resolve(import.meta.dir, '..');
const PASSWORD = 'perf-harness';
const SECTIONS = ['bytes', 'cold', 'warm', 'idle', 'tap', 'heavy', 'server'] as const;
type Section = (typeof SECTIONS)[number];

function args() {
	const a = process.argv.slice(2);
	const get = (k: string) => {
		const i = a.indexOf(k);
		return i >= 0 ? a[i + 1] : undefined;
	};
	const builds = a.flatMap((x, i) => (a[i - 1] === '--build' ? [x] : []));
	return {
		runs: Number(get('--runs') ?? 5),
		taps: Number(get('--taps') ?? 60),
		out: get('--out') ?? join(tmpdir(), `heimdall-perf-${Date.now()}.json`),
		/** A directory for CPU profiles of one extra, unreported Chromium pass. */
		profile: get('--profile'),
		only: new Set((get('--only')?.split(',') ?? SECTIONS) as Section[]),
		builds: (builds.length ? builds : ['current=build']).map((spec) => {
			const [label, rest] = spec.split('=');
			const [dir, bin] = rest.split('@');
			return {
				label,
				webDir: resolve(WEB, dir),
				bin: resolve(WEB, bin ?? '../target/release/heimdall')
			};
		})
	};
}
const opt = args();
type Build = (typeof opt.builds)[number];

// ---------------------------------------------------------------------------------------

const stats = (xs: readonly number[]) => {
	const s = [...xs].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
	const q = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN);
	const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
	return {
		n: s.length,
		median: s.length ? med : NaN,
		min: s[0] ?? NaN,
		max: s.at(-1) ?? NaN,
		p95: q(0.95)
	};
};
const r1 = (x: number) => Math.round(x * 10) / 10;
const fmt = (xs: readonly number[], unit = 'ms') => {
	const s = stats(xs);
	return s.n ? `${r1(s.median)} ${unit} [${r1(s.min)}–${r1(s.max)}] n=${s.n}` : 'n/a';
};

function freePort(): Promise<number> {
	return new Promise((ok) => {
		const s = createServer();
		s.listen(0, '127.0.0.1', () => {
			const port = (s.address() as { port: number }).port;
			s.close(() => ok(port));
		});
	});
}

type Server = {
	base: string;
	proc: ChildProcess;
	dataDir: string;
	stop: () => void;
	rssKb: () => number;
};

const hashFiles = new Map<string, string>();
function hashFile(bin: string): string {
	let file = hashFiles.get(bin);
	if (!file) {
		const out = spawnSync(bin, ['hash-password'], { input: `${PASSWORD}\n` });
		if (out.status !== 0) throw new Error(`hash-password failed: ${out.stderr}`);
		file = join(mkdtempSync(join(tmpdir(), 'heimdall-perf-pw-')), 'hash');
		writeFileSync(file, out.stdout);
		hashFiles.set(bin, file);
	}
	return file;
}

export async function serve(b: Build): Promise<Server> {
	const port = await freePort();
	const dataDir = mkdtempSync(join(tmpdir(), 'heimdall-perf-data-'));
	const proc = spawn(
		b.bin,
		[
			'--listen',
			`127.0.0.1:${port}`,
			'--data-dir',
			dataDir,
			'--web-dir',
			b.webDir,
			'--password-hash-file',
			hashFile(b.bin),
			'--insecure-cookies'
		],
		{ stdio: ['ignore', 'ignore', 'inherit'] }
	);
	const base = `http://127.0.0.1:${port}`;
	for (let i = 0; ; i++) {
		try {
			if ((await fetch(`${base}/api/health`)).ok) break;
		} catch {
			if (i > 200) throw new Error(`server for ${b.label} did not start`);
			await Bun.sleep(25);
		}
	}
	return {
		base,
		proc,
		dataDir,
		stop: () => {
			proc.kill();
			rmSync(dataDir, { recursive: true, force: true });
		},
		rssKb: () =>
			Number(
				spawnSync('ps', ['-o', 'rss=', '-p', String(proc.pid)])
					.stdout.toString()
					.trim()
			)
	};
}

export async function login(base: string): Promise<string> {
	const res = await fetch(`${base}/api/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ password: PASSWORD })
	});
	if (!res.ok) throw new Error(`login ${res.status}`);
	return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

type SyncPage = { head: number; ops: unknown[]; more: boolean };
async function syncCall(base: string, cookie: string, after: number, ops: readonly Op[]) {
	const res = await fetch(`${base}/api/sync`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie },
		body: JSON.stringify({ after, ops })
	});
	return { ok: res.ok, status: res.status, body: res.ok ? ((await res.json()) as SyncPage) : null };
}

/** Pushes the log 500 ops at a time, as the client's outbox does. */
export async function push(base: string, cookie: string, ops: readonly Op[]) {
	let after = 0;
	let failed = 0;
	let requests = 0;
	for (let i = 0; i < ops.length; i += 500) {
		const r = await syncCall(base, cookie, after, ops.slice(i, i + 500));
		requests++;
		if (!r.body) failed++;
		else after = r.body.head;
	}
	return { head: after, requests, failed };
}

/** Raw HTTP, so the timings and byte counts are what crossed the socket. */
function raw(
	url: string,
	init: { method?: string; headers?: Record<string, string>; body?: string } = {}
) {
	return new Promise<{
		status: number;
		ttfb: number;
		total: number;
		bytes: number;
		encoding: string | null;
	}>((ok, fail) => {
		const t0 = performance.now();
		const req = httpRequest(url, { method: init.method ?? 'GET', headers: init.headers }, (res) => {
			const ttfb = performance.now() - t0;
			let bytes = 0;
			res.on('data', (c: Buffer) => (bytes += c.length));
			res.on('end', () =>
				ok({
					status: res.statusCode ?? 0,
					ttfb,
					total: performance.now() - t0,
					bytes,
					encoding: (res.headers['content-encoding'] as string | undefined) ?? null
				})
			);
		});
		req.on('error', fail);
		req.end(init.body);
	});
}

// ---------------------------------------------------------------------------------------

type Engine = { name: string; type: BrowserType; throttle: number };
export const ENGINES: Engine[] = [
	{ name: 'chromium-4x', type: chromium, throttle: 4 },
	{ name: 'webkit', type: webkit, throttle: 1 }
];

/** Observers for paint, layout shift, long tasks, and event timing, before any app code. */
const OBSERVE = `(() => {
	const p = (window.__perf = { lt: [], cls: 0, lcp: 0, fcp: 0, events: [], types: [] });
	const types = (PerformanceObserver.supportedEntryTypes || []);
	p.types = types;
	const on = (type, cb, extra) => {
		if (!types.includes(type)) return;
		new PerformanceObserver((l) => l.getEntries().forEach(cb)).observe({ type, buffered: true, ...extra });
	};
	on('longtask', (e) => p.lt.push([e.startTime, e.duration]));
	on('layout-shift', (e) => { if (!e.hadRecentInput) p.cls += e.value; });
	on('largest-contentful-paint', (e) => (p.lcp = e.startTime));
	on('paint', (e) => { if (e.name === 'first-contentful-paint') p.fcp = e.startTime; });
	on('event', (e) => p.events.push({ name: e.name, start: e.startTime, dur: e.duration, ps: e.processingStart, pe: e.processingEnd, id: e.interactionId }), { durationThreshold: 16 });
})();`;

export async function context(
	e: Engine,
	browser: Awaited<ReturnType<BrowserType['launch']>>,
	base: string
) {
	const ctx = await browser.newContext({
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 3,
		hasTouch: true,
		isMobile: true,
		baseURL: base
	});
	await ctx.addInitScript(OBSERVE);
	const res = await ctx.request.post('/api/login', { data: { password: PASSWORD } });
	if (!res.ok()) throw new Error(`browser login ${res.status()}`);
	return ctx;
}

type Watched = {
	page: Page;
	errors: string[];
	failed: string[];
	assets: Map<string, { type: string; encoding: string | null }>;
};

export async function tab(e: Engine, ctx: BrowserContext): Promise<Watched> {
	const page = await ctx.newPage();
	if (e.throttle > 1) {
		const cdp = await ctx.newCDPSession(page);
		await cdp.send('Emulation.setCPUThrottlingRate', { rate: e.throttle });
	}
	const w: Watched = { page, errors: [], failed: [], assets: new Map() };
	page.on('pageerror', (err) => w.errors.push(err.message));
	page.on('response', (r) => {
		const type = r.request().resourceType();
		if (r.status() >= 400) w.failed.push(`${r.status()} ${r.url()}`);
		if (['script', 'stylesheet', 'font'].includes(type))
			w.assets.set(new URL(r.url()).pathname, {
				type,
				encoding: r.headers()['content-encoding'] ?? null
			});
	});
	page.on('requestfailed', (r) => {
		if (!r.url().includes('/api/live')) w.failed.push(`failed ${r.url()}`);
	});
	return w;
}

/** Waits for load, then for a second without long tasks, then reads the observers. */
export async function vitals(w: Watched) {
	const { page } = w;
	await page.waitForLoadState('load');
	await page.waitForFunction(
		() => {
			const p = (window as any).__perf;
			const last = p.lt.reduce((m: number, [s, d]: number[]) => Math.max(m, s + d), 0);
			return performance.now() > 1500 && performance.now() - last > 1000;
		},
		null,
		{ polling: 250, timeout: 30_000 }
	);
	return page.evaluate(() => {
		const p = (window as any).__perf;
		const after = p.lt.filter(([s]: number[]) => s >= p.fcp);
		return {
			fcp: p.fcp || null,
			lcp: p.lcp || null,
			cls: p.types.includes('layout-shift') ? p.cls : null,
			longTasks: p.types.includes('longtask') ? p.lt.length : null,
			longTaskMs: p.types.includes('longtask')
				? p.lt.reduce((a: number, [, d]: number[]) => a + d, 0)
				: null,
			tbt: p.types.includes('longtask')
				? after.reduce((a: number, [, d]: number[]) => a + Math.max(0, d - 50), 0)
				: null,
			controlled: !!navigator.serviceWorker?.controller,
			path: location.pathname,
			types: p.types as string[]
		};
	});
}
type Vitals = Awaited<ReturnType<typeof vitals>>;

function routes(today: string) {
	return {
		today: '/',
		'history day': `/history/${addDays(today as never, -1)}`,
		week: '/week',
		month: '/month',
		year: '/year',
		insights: '/insights',
		'check-in': '/checkin',
		tasks: '/tasks',
		settings: '/settings'
	} as Record<string, string>;
}

/** IndexedDB from inside the page: record counts and the sync cursor, or clear a store. */
export async function idb(page: Page, action: { count?: string[]; clear?: string }) {
	return page.evaluate(async ({ count = [], clear }) => {
		const db: IDBDatabase = await new Promise((ok, no) => {
			const r = indexedDB.open('heimdall');
			r.onsuccess = () => ok(r.result);
			r.onerror = () => no(r.error);
		});
		const req = <T>(r: IDBRequest<T>) =>
			new Promise<T>(
				(ok, no) => ((r.onsuccess = () => ok(r.result)), (r.onerror = () => no(r.error)))
			);
		const out: Record<string, number> = {};
		for (const s of count) out[s] = await req(db.transaction(s).objectStore(s).count());
		const meta = (await req(db.transaction('meta').objectStore('meta').get('meta'))) as
			{ cursor?: number } | undefined;
		out.cursor = meta?.cursor ?? 0;
		if (clear) {
			const tx = db.transaction(clear, 'readwrite');
			tx.objectStore(clear).clear();
			await new Promise((ok) => (tx.oncomplete = ok));
		}
		db.close();
		return out;
	}, action);
}

// ---------------------------------------------------------------------------------------

/** One build behind a fresh server: empty, or holding the seeded year up to seq `head`. */
type Target = { build: Build; server: Server; head: number };

export async function target(build: Build, ops: readonly Op[] = []): Promise<Target> {
	const server = await serve(build);
	if (!ops.length) return { build, server, head: 0 };
	const pushed = await push(server.base, await login(server.base), ops);
	if (pushed.failed) throw new Error(`seeding ${build.label}: ${pushed.failed} failed pushes`);
	return { build, server, head: pushed.head };
}
export const results: Record<string, any> = {};
const R = (label: string) =>
	(results[label] ??= { bytes: {}, cold: {}, warm: {}, idle: {}, tap: {}, heavy: {}, server: [] });

async function measureBytes(
	t: Target,
	browser: Awaited<ReturnType<BrowserType['launch']>>,
	today: string
) {
	const e = ENGINES[0];
	for (const [name, path] of Object.entries(routes(today))) {
		const ctx = await context(e, browser, t.server.base);
		const w = await tab({ ...e, throttle: 1 }, ctx);
		await w.page.goto(path);
		await vitals(w);
		const files: Record<string, unknown>[] = [];
		const sum = {
			js: { identity: 0, gzip: 0, br: 0 },
			css: { identity: 0, gzip: 0, br: 0 },
			font: { identity: 0, gzip: 0, br: 0 }
		};
		for (const [file, a] of w.assets) {
			const kind = a.type === 'script' ? 'js' : a.type === 'stylesheet' ? 'css' : 'font';
			const sizes: Record<string, { bytes: number; encoding: string | null }> = {};
			for (const enc of ['identity', 'gzip', 'br'] as const) {
				const r = await raw(t.server.base + file, { headers: { 'accept-encoding': enc } });
				if (r.status !== 200) w.failed.push(`${r.status} ${file}`);
				sizes[enc] = { bytes: r.bytes, encoding: r.encoding };
				sum[kind][enc] += r.bytes;
			}
			files.push({ file, kind, browserEncoding: a.encoding, sizes });
		}
		R(t.build.label).bytes[name] = { sum, files, errors: w.errors, failed: w.failed };
		await ctx.close();
	}
}

async function measureCold(
	t: Target,
	e: Engine,
	browser: Awaited<ReturnType<BrowserType['launch']>>,
	today: string,
	run: number
) {
	for (const [name, path] of Object.entries(routes(today))) {
		const ctx = await context(e, browser, t.server.base);
		const w = await tab(e, ctx);
		await w.page.goto(path);
		const v = await vitals(w);
		((R(t.build.label).cold[e.name] ??= {})[name] ??= []).push({
			run,
			...v,
			errors: w.errors.length,
			failed: w.failed
		});
		await ctx.close();
	}
}

/** A profile that holds the seeded year: signed in, fully pulled, service worker active. */
export async function primed(
	t: Target,
	e: Engine,
	browser: Awaited<ReturnType<BrowserType['launch']>>
) {
	const ctx = await context(e, browser, t.server.base);
	const w = await tab({ ...e, throttle: 1 }, ctx);
	await w.page.goto('/');
	const t0 = performance.now();
	let got: Record<string, number> = { cursor: 0 };
	while (got.cursor < t.head) {
		if (performance.now() - t0 > 180_000)
			throw new Error(`pull stalled at ${got.cursor}/${t.head}`);
		await Bun.sleep(250);
		got = await idb(w.page, { count: ['mark'] });
	}
	await w.page.evaluate(() => navigator.serviceWorker.ready);
	await w.page.close();
	return { ctx, pullMs: performance.now() - t0, marks: got.mark };
}

async function measureWarm(ctx: BrowserContext, t: Target, e: Engine, today: string, run: number) {
	for (const [name, path] of Object.entries(routes(today))) {
		const w = await tab(e, ctx);
		await w.page.goto(path);
		const v = await vitals(w);
		((R(t.build.label).warm[e.name] ??= {})[name] ??= []).push({
			run,
			...v,
			errors: w.errors.length,
			failed: w.failed
		});
		await w.page.close();
	}
}

/**
 * A finger rests about 80 ms between touchstart and touchend. Playwright's tap sends both
 * back to back, which queues touchend behind the touchstart's own frame and reports that
 * wait as input delay. Chromium gets a paced tap over CDP; WebKit has no such channel and
 * keeps Playwright's tap.
 */
export async function humanTap(page: Page, el: ElementHandle, e: Engine) {
	if (e.type !== chromium) return el.tap();
	const box = (await el.boundingBox())!;
	const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	const cdp = (tapSessions.get(page) ??
		tapSessions.set(page, await page.context().newCDPSession(page)).get(page))!;
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
	await page.waitForTimeout(80);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const tapSessions = new WeakMap<Page, CDPSession>();

export async function measureTap(ctx: BrowserContext, t: Target, e: Engine, run: number) {
	const w = await tab(e, ctx);
	const { page } = w;
	await page.goto('/');
	await page.locator('.row .hit').first().waitFor();
	await vitals(w);
	await page.evaluate(() => {
		const taps: unknown[] = ((window as any).__taps = []);
		addEventListener(
			'click',
			(ev) => {
				const btn = (ev.target as Element).closest?.('.row .hit');
				if (!btn) return;
				const start = ev.timeStamp;
				requestAnimationFrame(() => {
					const pressed = btn.getAttribute('aria-pressed') === 'true';
					const ch = new MessageChannel();
					ch.port1.onmessage = () => taps.push({ start, paint: performance.now(), pressed });
					ch.port2.postMessage(0);
				});
			},
			true
		);
	});
	const before = await idb(page, { count: ['mark', 'outbox'] });
	let changed = 0;
	for (let i = 0; i < opt.taps; i++) {
		const target = (await page
			.locator('.row .hit:not([aria-pressed="true"])')
			.nth(i % 3)
			.elementHandle())!;
		await humanTap(page, target, e);
		try {
			await page.waitForFunction((n) => (window as any).__taps.length >= n, i + 1, {
				timeout: 3000,
				polling: 'raf'
			});
			if (
				await target.evaluate((b) => b.getAttribute('aria-pressed') === 'true').catch(() => false)
			)
				changed++;
		} catch {
			/* counted as a tap that did not paint a change */
		}
		await page.waitForTimeout(350);
	}
	await page.waitForTimeout(1000);
	const after = await idb(page, { count: ['mark', 'outbox'] });
	const { taps, events } = await page.evaluate(() => ({
		taps: (window as any).__taps as { start: number; paint: number; pressed: boolean }[],
		events: (window as any).__perf.events as {
			name: string;
			start: number;
			dur: number;
			ps: number;
			pe: number;
		}[]
	}));
	const clicks = events.filter((x) => x.name === 'click');
	const rows = taps.map((tp) => {
		const et = clicks.find((c) => Math.abs(c.start - tp.start) < 1);
		return {
			raf: tp.paint - tp.start,
			eventTiming: et ? et.dur : null,
			/** Input delay, handlers, and the wait from handlers to the presented frame. */
			phases: et ? [et.ps - et.start, et.pe - et.ps, et.start + et.dur - et.pe] : null,
			pressed: tp.pressed
		};
	});
	const supportsEvent = (await page.evaluate(() =>
		PerformanceObserver.supportedEntryTypes.includes('event')
	)) as boolean;
	(R(t.build.label).tap[e.name] ??= []).push({
		run,
		taps: opt.taps,
		painted: rows.length,
		pressedAtPaint: rows.filter((r) => r.pressed).length,
		changed,
		marksWritten: after.mark - before.mark,
		eventTimingSupported: supportsEvent,
		eventTimingBelow16: rows.filter((r) => r.eventTiming === null).length,
		raf: stats(rows.map((r) => r.raf)),
		eventTiming: stats(rows.map((r) => r.eventTiming ?? 16)),
		phases: [0, 1, 2].map(
			(i) => stats(rows.flatMap((r) => (r.phases ? [r.phases[i]] : []))).median
		),
		samples: rows,
		events,
		errors: w.errors.length,
		failed: w.failed
	});
	await page.close();
}

/** Today left alone: what it keeps doing per second, in requests and main-thread time. */
async function measureIdle(ctx: BrowserContext, t: Target, e: Engine, run: number) {
	const w = await tab(e, ctx);
	const { page } = w;
	await page.goto('/');
	await page.locator('.row .hit').first().waitFor();
	await vitals(w);
	let requests = 0;
	page.on('request', (r) => {
		if (new URL(r.url()).pathname.startsWith('/api/')) requests++;
	});
	const cdp = e.type === chromium ? await ctx.newCDPSession(page) : null;
	const busy = async () => {
		if (!cdp) return null;
		await cdp.send('Performance.enable');
		const { metrics } = (await cdp.send('Performance.getMetrics')) as {
			metrics: { name: string; value: number }[];
		};
		const m = new Map(metrics.map((x) => [x.name, x.value]));
		return { task: m.get('TaskDuration')! * 1000, script: m.get('ScriptDuration')! * 1000 };
	};
	const SECONDS = 5;
	const before = await busy();
	await page.waitForTimeout(SECONDS * 1000);
	const after = await busy();
	(R(t.build.label).idle[e.name] ??= []).push({
		run,
		seconds: SECONDS,
		apiRequestsPerSecond: requests / SECONDS,
		mainThreadMsPerSecond: before && after ? (after.task - before.task) / SECONDS : null,
		scriptMsPerSecond: before && after ? (after.script - before.script) / SECONDS : null,
		errors: w.errors.length
	});
	await page.close();
}

async function measureHeavy(ctx: BrowserContext, t: Target, e: Engine, run: number) {
	const w = await tab(e, ctx);
	const { page } = w;
	await page.goto('/');
	await page.evaluate(() => localStorage.setItem('heimdall.insights.window', '90'));
	await page.reload();
	await page.locator('.row .hit').first().waitFor();
	await vitals(w);
	for (const target of ['year', 'insights'] as const) {
		for (const cache of ['cold', 'warm'] as const) {
			const before = await idb(
				page,
				cache === 'cold' ? { count: ['dayAgg'], clear: 'dayAgg' } : { count: ['dayAgg'] }
			);
			await page.waitForTimeout(300);
			const m = await page.evaluate(async (target) => {
				const ready =
					target === 'year'
						? () => document.querySelector('.map[data-ready]')
						: () => document.querySelector('.grid[aria-busy="false"], .page .empty');
				const p = (window as any).__perf;
				const link = document.querySelector<HTMLAnchorElement>(`nav a[href="/${target}"]`);
				if (!link) throw new Error(`no nav link to ${target}`);
				const t0 = performance.now();
				link.click();
				const t1: number = await new Promise((ok) => {
					const check = () => {
						if (ready()) {
							requestAnimationFrame(() => {
								const ch = new MessageChannel();
								ch.port1.onmessage = () => ok(performance.now());
								ch.port2.postMessage(0);
							});
						} else requestAnimationFrame(check);
					};
					check();
				});
				const lt = p.lt.filter(([s]: number[]) => s >= t0 && s <= t1);
				const shaded = document.querySelectorAll('.map rect[class*="l"]:not(.l0)').length;
				const cards = document.querySelectorAll('.grid > *').length;
				return {
					ms: t1 - t0,
					longTasks: lt.length,
					longestTask: lt.reduce((a: number, [, d]: number[]) => Math.max(a, d), 0),
					longTaskMs: lt.reduce((a: number, [, d]: number[]) => a + d, 0),
					work: target === 'year' ? { shadedDays: shaded } : { cards },
					path: location.pathname
				};
			}, target);
			await page.waitForTimeout(800);
			const after = await idb(page, { count: ['dayAgg'] });
			((R(t.build.label).heavy[e.name] ??= {})[`${target} ${cache}`] ??= []).push({
				run,
				...m,
				aggRowsBefore: cache === 'cold' ? 0 : before.dayAgg,
				aggRowsAfter: after.dayAgg,
				errors: w.errors.length
			});
			await page.evaluate(() =>
				document.querySelector<HTMLAnchorElement>('nav a[href="/"]')?.click()
			);
			await page.locator('.row .hit').first().waitFor();
			await page.waitForTimeout(800);
		}
	}
	await page.close();
}

type CpuProfile = {
	nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[];
	samples: number[];
	timeDeltas: number[];
};

/** Self time by function, the evidence for what bounds a number. */
function topSelf(p: CpuProfile, n = 12) {
	const byId = new Map(p.nodes.map((x) => [x.id, x.callFrame]));
	const self = new Map<string, number>();
	p.samples.forEach((id, i) => {
		const f = byId.get(id)!;
		const key = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
		self.set(key, (self.get(key) ?? 0) + (p.timeDeltas[i] ?? 0) / 1000);
	});
	const total = [...self.values()].reduce((a, b) => a + b, 0);
	return [...self.entries()]
		.filter(([k]) => !k.startsWith('(idle)'))
		.sort((a, b) => b[1] - a[1])
		.slice(0, n)
		.map(([k, ms]) => `${r1(ms)} ms ${r1((100 * ms) / total)}% ${k}`);
}

/** One unreported pass under the sampling profiler, which slows the work it watches. */
async function profilePass(ctx: BrowserContext, t: Target, e: Engine, dir: string) {
	const w = await tab(e, ctx);
	const { page } = w;
	await page.goto('/');
	await page.evaluate(() => localStorage.setItem('heimdall.insights.window', '90'));
	await page.reload();
	await page.locator('.row .hit').first().waitFor();
	await vitals(w);
	const cdp = await ctx.newCDPSession(page);
	await cdp.send('Profiler.enable');
	await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
	const profiled = async (name: string, fn: () => Promise<void>) => {
		await cdp.send('Profiler.start');
		await fn();
		const { profile } = (await cdp.send('Profiler.stop')) as unknown as { profile: CpuProfile };
		const file = join(dir, `${t.build.label}-${name}.cpuprofile`);
		writeFileSync(file, JSON.stringify(profile));
		console.log(`\nprofile ${name} (${file})\n  ${topSelf(profile).join('\n  ')}`);
	};
	await profiled('tap', async () => {
		for (let i = 0; i < 20; i++) {
			await page.locator('.row .hit:not([aria-pressed="true"])').first().tap();
			await page.waitForTimeout(350);
		}
	});
	await profiled('idle-today', () => page.waitForTimeout(5000));
	for (const [name, path, ready, clear] of [
		['year-cold', '/year', '.map[data-ready]', true],
		['insights-cold', '/insights', '.grid[aria-busy="false"]', true],
		['insights-warm', '/insights', '.grid[aria-busy="false"]', false]
	] as const) {
		if (clear) await idb(page, { clear: 'dayAgg' });
		await profiled(name, async () => {
			await page.evaluate(
				(p) => document.querySelector<HTMLAnchorElement>(`nav a[href="${p}"]`)!.click(),
				path
			);
			await page.locator(ready).waitFor();
			await page.waitForTimeout(300);
		});
		await page.evaluate(() =>
			document.querySelector<HTMLAnchorElement>('nav a[href="/"]')!.click()
		);
		await page.locator('.row .hit').first().waitFor();
		await page.waitForTimeout(800);
	}
	await page.close();
}

async function measureServer(b: Build, ops: readonly Op[], run: number) {
	const s = await serve(b);
	try {
		const idle = s.rssKb();
		const cookie = await login(s.base);
		let t0 = performance.now();
		const pushed = await push(s.base, cookie, ops);
		const pushMs = performance.now() - t0;
		const afterPush = s.rssKb();
		t0 = performance.now();
		let after = 0;
		let pulled = 0;
		let pages = 0;
		let failed = pushed.failed;
		for (;;) {
			const r = await syncCall(s.base, cookie, after, []);
			pages++;
			if (!r.body) {
				failed++;
				break;
			}
			pulled += r.body.ops.length;
			after = (r.body.ops.at(-1) as { seq: number } | undefined)?.seq ?? after;
			if (!r.body.more) break;
		}
		const pullMs = performance.now() - t0;
		const firstPage: Awaited<ReturnType<typeof raw>>[] = [];
		for (const enc of ['identity', 'gzip', 'br', 'identity', 'gzip']) {
			firstPage.push(
				await raw(`${s.base}/api/sync`, {
					method: 'POST',
					headers: { 'content-type': 'application/json', cookie, 'accept-encoding': enc },
					body: JSON.stringify({ after: 0, ops: [] })
				})
			);
		}
		const result = {
			run,
			ops: ops.length,
			head: pushed.head,
			pushRequests: pushed.requests,
			pushMs,
			pullPages: pages,
			pulled,
			pullMs,
			failed,
			firstPage,
			rssKb: { idle, afterPush, afterPull: s.rssKb() }
		};
		R(b.label).server.push(result);
	} finally {
		s.stop();
	}
}

// ---------------------------------------------------------------------------------------

async function main() {
	const now = Date.now();
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const seed = seedYear(now, zone);
	const git = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: WEB })
		.stdout.toString()
		.trim();
	const meta = {
		date: new Date(now).toISOString(),
		git,
		zone,
		cpus: cpus().length,
		cpu: cpus()[0]?.model,
		loadavg: loadavg(),
		runs: opt.runs,
		taps: opt.taps,
		sections: [...opt.only],
		builds: opt.builds,
		seed: { ...seed.counts, ops: seed.ops.length, today: seed.today },
		browsers: {} as Record<string, string>
	};
	console.log(
		`heimdall perf @ ${git}, load ${loadavg().map(r1).join(' ')}, ${seed.ops.length} seed ops`
	);

	if (opt.only.has('server')) {
		for (let run = 0; run < opt.runs; run++)
			for (const b of opt.builds) await measureServer(b, seed.ops, run);
	}

	type Launched = Awaited<ReturnType<BrowserType['launch']>>;
	const each = async (ops: readonly Op[], fn: (t: Target) => Promise<void>) => {
		for (const build of opt.builds) {
			const t = await target(build, ops);
			try {
				await fn(t);
			} finally {
				t.server.stop();
			}
		}
	};
	const seeded = async (
		e: Engine,
		browser: Launched,
		fn: (ctx: BrowserContext, t: Target) => Promise<void>
	) =>
		each(seed.ops, async (t) => {
			const p = await primed(t, e, browser);
			((R(t.build.label).prime ??= {})[e.name] ??= []).push({ pullMs: p.pullMs, marks: p.marks });
			try {
				await fn(p.ctx, t);
			} finally {
				await p.ctx.close();
			}
		});

	for (const e of ENGINES) {
		if (!['bytes', 'cold', 'warm', 'idle', 'tap', 'heavy'].some((s) => opt.only.has(s as Section)))
			break;
		const browser: Launched = await e.type.launch();
		meta.browsers[e.name] = browser.version();
		if (opt.only.has('bytes') && e === ENGINES[0])
			await each([], (t) => measureBytes(t, browser, seed.today));
		for (let run = 0; run < opt.runs; run++) {
			if (opt.only.has('cold')) await each([], (t) => measureCold(t, e, browser, seed.today, run));
			if (['warm', 'idle', 'tap', 'heavy'].some((s) => opt.only.has(s as Section))) {
				await seeded(e, browser, async (ctx, t) => {
					if (opt.only.has('warm')) await measureWarm(ctx, t, e, seed.today, run);
					if (opt.only.has('idle')) await measureIdle(ctx, t, e, run);
					if (opt.only.has('tap')) await measureTap(ctx, t, e, run);
					if (opt.only.has('heavy')) await measureHeavy(ctx, t, e, run);
				});
			}
			console.log(`  ${e.name} run ${run + 1}/${opt.runs} done`);
		}
		if (opt.profile && e.throttle > 1)
			await seeded(e, browser, (ctx, t) => profilePass(ctx, t, e, opt.profile!));
		await browser.close();
	}

	writeFileSync(opt.out, JSON.stringify({ meta, results }, null, '\t'));
	report();
	console.log(`\nraw results: ${opt.out}`);
}

function report() {
	for (const [label, r] of Object.entries(results)) {
		console.log(`\n== ${label}`);
		for (const [route, b] of Object.entries(r.bytes as Record<string, any>)) {
			const k = (x: { gzip: number; br: number; identity: number }) =>
				`${r1(x.identity / 1024)}/${r1(x.gzip / 1024)}/${r1(x.br / 1024)}`;
			console.log(
				`bytes ${route.padEnd(12)} js ${k(b.sum.js)} KiB  css ${k(b.sum.css)} KiB  font ${k(b.sum.font)} KiB (identity/gzip/br)`
			);
		}
		for (const phase of ['cold', 'warm'] as const) {
			for (const [engine, byRoute] of Object.entries(
				r[phase] as Record<string, Record<string, Vitals[]>>
			)) {
				for (const [route, runs] of Object.entries(byRoute)) {
					const pick = (f: (v: Vitals) => number | null) =>
						runs.map(f).filter((x): x is number => x !== null);
					const errs = runs.reduce((a, v: any) => a + v.errors + v.failed.length, 0);
					const ctl = runs.filter((v) => v.controlled).length;
					console.log(
						`${phase} ${engine} ${route.padEnd(12)} fcp ${fmt(pick((v) => v.fcp))}  lcp ${fmt(pick((v) => v.lcp))}  tbt ${fmt(pick((v) => v.tbt))}  cls ${fmt(
							pick((v) => v.cls),
							''
						)}  sw ${ctl}/${runs.length} err ${errs}`
					);
				}
			}
		}
		for (const [engine, runs] of Object.entries(r.idle as Record<string, any[]>)) {
			console.log(
				`idle ${engine} api requests/s ${fmt(
					runs.map((x) => x.apiRequestsPerSecond),
					''
				)}  main thread ${fmt(
					runs.flatMap((x) => (x.mainThreadMsPerSecond === null ? [] : [x.mainThreadMsPerSecond])),
					'ms/s'
				)}`
			);
		}
		for (const [engine, runs] of Object.entries(r.tap as Record<string, any[]>)) {
			console.log(
				`tap ${engine} raf p50 ${fmt(runs.map((x) => x.raf.median))} p95 ${fmt(runs.map((x) => x.raf.p95))} | event-timing p50 ${fmt(runs.map((x) => x.eventTiming.median))} p95 ${fmt(runs.map((x) => x.eventTiming.p95))} | changed ${runs.map((x) => `${x.changed}/${x.taps}`).join(' ')} marks ${runs.map((x) => x.marksWritten).join(' ')} <16ms ${runs.map((x) => x.eventTimingBelow16).join(' ')} | delay/handlers/present ${runs.map((x) => x.phases.map(r1).join('/')).join(' ')}`
			);
		}
		for (const [engine, byCase] of Object.entries(
			r.heavy as Record<string, Record<string, any[]>>
		)) {
			for (const [c, runs] of Object.entries(byCase)) {
				console.log(
					`heavy ${engine} ${c.padEnd(14)} settled ${fmt(runs.map((x) => x.ms))}  longest task ${fmt(runs.map((x) => x.longestTask))}  long-task ms ${fmt(runs.map((x) => x.longTaskMs))}  agg rows ${runs.map((x) => x.aggRowsAfter).join(' ')} work ${JSON.stringify(runs[0].work)}`
				);
			}
		}
		for (const [engine, runs] of Object.entries((r.prime ?? {}) as Record<string, any[]>)) {
			console.log(
				`first sync ${engine} pull of the year ${fmt(runs.map((x) => x.pullMs))} marks ${runs.map((x) => x.marks).join(' ')}`
			);
		}
		const sv = r.server as any[];
		if (sv.length) {
			console.log(
				`server push ${fmt(sv.map((x) => x.pushMs))} (${sv[0].pushRequests} req) pull ${fmt(sv.map((x) => x.pullMs))} (${sv[0].pullPages} pages, pulled ${sv.map((x) => x.pulled).join(' ')}) failed ${sv.map((x) => x.failed).join(' ')}`
			);
			const fp = (enc: string) =>
				sv.flatMap((x) =>
					x.firstPage.filter(
						(f: any) => (f.encoding ?? 'identity') === enc || (enc === 'identity' && !f.encoding)
					)
				);
			console.log(
				`server full-log first page ttfb ${fmt(sv.flatMap((x) => x.firstPage.map((f: any) => f.ttfb)))} bytes ${[...new Set(sv.flatMap((x) => x.firstPage.map((f: any) => `${f.encoding ?? 'identity'}:${f.bytes}`)))].join(' ')} (${fp('identity').length} uncompressed)`
			);
			console.log(
				`server rss idle ${fmt(
					sv.map((x) => x.rssKb.idle / 1024),
					'MiB'
				)} after push ${fmt(
					sv.map((x) => x.rssKb.afterPush / 1024),
					'MiB'
				)} after pull ${fmt(
					sv.map((x) => x.rssKb.afterPull / 1024),
					'MiB'
				)}`
			);
		}
	}
}

if (import.meta.main) await main();
