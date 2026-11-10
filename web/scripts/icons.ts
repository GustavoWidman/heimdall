/**
 * Draws the heimdall mark and renders every icon file from it.
 *
 *   bun scripts/icons.ts            (from web/)
 *
 * The mark is a six-blade camera aperture, open on a dark pupil, ringed by a thin band of
 * task hues. Rasterizing goes through Chromium; set CHROMIUM to a browser binary when the
 * Playwright-managed one is not installed.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const INK = '#161615';
const PUPIL = '#0b0b0c';
/** Six hues from the task palette, in wheel order, at the dark theme's lightness. */
const BAND = [20, 80, 130, 195, 262, 334];

function oklch(L: number, C: number, h: number): string {
	const a = C * Math.cos((h * Math.PI) / 180);
	const b = C * Math.sin((h * Math.PI) / 180);
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const lin = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
	];
	return (
		'#' +
		lin
			.map((c) => {
				const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
				return Math.round(Math.min(1, Math.max(0, v)) * 255)
					.toString(16)
					.padStart(2, '0');
			})
			.join('')
	);
}

type Pt = readonly [number, number];
const C = 256;
const n = (v: number) => +v.toFixed(2);
const at = (r: number, deg: number): Pt => [
	C + r * Math.cos((deg * Math.PI) / 180),
	C + r * Math.sin((deg * Math.PI) / 180)
];
const p = ([x, y]: Pt) => `${n(x)} ${n(y)}`;

/** Where the ray from `a` through `b` leaves the circle of radius r around the center. */
function exit(a: Pt, b: Pt, r: number): Pt {
	const d = [b[0] - a[0], b[1] - a[1]];
	const len = Math.hypot(d[0], d[1]);
	const u = [d[0] / len, d[1] / len];
	const f = [a[0] - C, a[1] - C];
	const B = f[0] * u[0] + f[1] * u[1];
	const t = -B + Math.sqrt(B * B - (f[0] ** 2 + f[1] ** 2 - r * r));
	return [a[0] + u[0] * t, a[1] + u[1] * t];
}

/**
 * The mark in a 512 box. `small` trades detail for weight so it survives 16 px: a wider
 * opening, heavier seams, and a thicker band.
 */
function mark(small: boolean): string {
	const R = small ? 200 : 172;
	const open = small ? 0.5 : 0.42;
	const seam = small ? 16 : 5;
	const band = small ? 34 : 10;
	const gap = small ? 14 : 15;
	const hex = Array.from({ length: 6 }, (_, i) => at(R * open, -75 + i * 60));
	const ends = hex.map((v, i) => exit(v, hex[(i + 1) % 6], R));

	const blades = hex
		.map((_, i) => {
			const v = hex[(i + 1) % 6];
			const shade = i % 2 ? 'url(#b2)' : 'url(#b1)';
			return `<path d="M${p(v)}L${p(ends[i])}A${R} ${R} 0 0 1 ${p(ends[(i + 1) % 6])}Z" fill="${shade}"/>`;
		})
		.join('');
	const seams = hex.map((v, i) => `<path d="M${p(v)}L${p(ends[i])}"/>`).join('');

	const rb = R + gap + band / 2;
	const arcs = BAND.map((h, i) => {
		const span = 360 / BAND.length;
		const a0 = -90 + i * span + (small ? 0 : 1.5);
		const a1 = -90 + (i + 1) * span - (small ? 0 : 1.5);
		return `<path d="M${p(at(rb, a0))}A${n(rb)} ${n(rb)} 0 0 1 ${p(at(rb, a1))}" stroke="${oklch(0.75, 0.13, h)}"/>`;
	}).join('');

	const glint = at(R * open * 0.42, -50);
	return [
		`<defs>`,
		`<radialGradient id="b1" cx="${C}" cy="${C}" r="${R}" gradientUnits="userSpaceOnUse"><stop offset=".3" stop-color="#f6f5f1"/><stop offset="1" stop-color="#dcd9d2"/></radialGradient>`,
		`<radialGradient id="b2" cx="${C}" cy="${C}" r="${R}" gradientUnits="userSpaceOnUse"><stop offset=".3" stop-color="#e9e7e1"/><stop offset="1" stop-color="#cdc9c1"/></radialGradient>`,
		`</defs>`,
		`<g fill="none" stroke-width="${band}">${arcs}</g>`,
		`<circle cx="${C}" cy="${C}" r="${R}" fill="${PUPIL}"/>`,
		blades,
		`<g stroke="${INK}" stroke-opacity="${small ? 1 : 0.55}" stroke-width="${seam}" stroke-linecap="round">${seams}</g>`,
		small
			? ''
			: `<circle cx="${n(glint[0])}" cy="${n(glint[1])}" r="${n(R * open * 0.16)}" fill="#fff" fill-opacity=".9"/>`
	].join('');
}

/** The full icon: the mark on an ink tile. `corner` 0 gives a full-bleed square. */
function icon({
	corner,
	small = false,
	scale = 1
}: {
	corner: number;
	small?: boolean;
	scale?: number;
}) {
	const art =
		scale === 1
			? mark(small)
			: `<g transform="translate(${C} ${C}) scale(${scale}) translate(-${C} -${C})">${mark(small)}</g>`;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${corner}" fill="${INK}"/>${art}</svg>\n`;
}

const ROUNDED = 112;
const svgs = {
	'../assets/icon.svg': icon({ corner: ROUNDED }),
	'src/lib/assets/favicon.svg': icon({ corner: ROUNDED, small: true })
};
const pngs: Record<string, { size: number; svg: string }> = {
	'static/icons/icon-192.png': { size: 192, svg: icon({ corner: ROUNDED }) },
	'static/icons/icon-512.png': { size: 512, svg: icon({ corner: ROUNDED }) },
	// Maskable: full bleed, art inside the central 80% circle that every mask keeps.
	'static/icons/icon-maskable-512.png': { size: 512, svg: icon({ corner: 0, scale: 0.86 }) },
	// iOS rounds the corners itself and fills transparency with black.
	'static/apple-touch-icon.png': { size: 180, svg: icon({ corner: 0 }) }
};

for (const [path, svg] of Object.entries(svgs)) {
	await writeFile(resolve(root, path), svg);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [path, { size, svg }] of Object.entries(pngs)) {
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(
		`<style>*{margin:0}body{background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
	);
	const out = resolve(root, path);
	await mkdir(dirname(out), { recursive: true });
	await page.screenshot({ path: out, omitBackground: true });
	console.log(`${path} ${size}px`);
}
await browser.close();
