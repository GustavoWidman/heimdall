/**
 * Writes a `.br` (quality 11) and a `.gz` (level 9) beside every text file in build/, so
 * the server sends bytes compressed once at their smallest instead of compressing each
 * response at a fast, larger setting. Runs after `vite build`; the service worker's
 * precache list is already written by then, so it never lists these copies.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const BUILD = resolve(import.meta.dir, '../build');
const TEXT = /\.(js|css|html|svg|json|webmanifest|txt)$/;

function* files(dir: string): Generator<string> {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) yield* files(path);
		else if (TEXT.test(name)) yield path;
	}
}

let raw = 0;
let br = 0;
for (const path of files(BUILD)) {
	const data = readFileSync(path);
	const b = brotliCompressSync(data, {
		params: {
			[constants.BROTLI_PARAM_QUALITY]: 11,
			[constants.BROTLI_PARAM_SIZE_HINT]: data.length
		}
	});
	writeFileSync(`${path}.br`, b);
	writeFileSync(`${path}.gz`, gzipSync(data, { level: 9 }));
	raw += data.length;
	br += b.length;
}
console.log(
	`compressed build/: ${(raw / 1024).toFixed(0)} KiB of text, ${(br / 1024).toFixed(0)} KiB as br`
);
