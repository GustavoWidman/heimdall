import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writePasswordHash } from './server';

/** Checks the production build exists and hashes the one password every test server takes. */
export default function setup(): void {
	const build = resolve(import.meta.dirname, '../../build/index.html');
	if (!existsSync(build)) throw new Error(`no production build at ${build}; run bun run build`);
	const file = join(mkdtempSync(join(tmpdir(), 'heimdall-e2e-auth-')), 'password.phc');
	writePasswordHash(file);
	process.env.HEIMDALL_E2E_HASH_FILE = file;
}
