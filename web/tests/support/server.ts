import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const PASSWORD = 'correct horse battery staple';

const WEB = resolve(import.meta.dirname, '../..');
const BIN = process.env.HEIMDALL_BIN ?? resolve(WEB, '../target/release/heimdall');
const WEB_DIR = resolve(WEB, 'build');

/** Hashes the test password and writes it where `--password-hash-file` reads it. */
export function writePasswordHash(file: string): void {
	const out = spawnSync(BIN, ['hash-password'], { input: `${PASSWORD}\n`, encoding: 'utf8' });
	if (out.status !== 0) throw new Error(`${BIN} hash-password failed: ${out.stderr}`);
	writeFileSync(file, out.stdout);
}

export type Server = {
	readonly url: string;
	/** Stops answering, as when the network drops. */
	stop(): Promise<void>;
	/** Serves the same data again on the same port. */
	start(): Promise<void>;
	dispose(): Promise<void>;
};

/** A heimdall server of its own: a fresh data directory on a port the OS picks. */
export async function startServer(hashFile: string): Promise<Server> {
	const dataDir = mkdtempSync(join(tmpdir(), 'heimdall-e2e-'));
	let child: ChildProcess | null = null;
	let listen = '127.0.0.1:0';

	async function start() {
		const proc = spawn(
			BIN,
			[
				'--listen',
				listen,
				'--data-dir',
				dataDir,
				'--web-dir',
				WEB_DIR,
				'--password-hash-file',
				hashFile,
				'--insecure-cookies'
			],
			{ env: { ...process.env, RUST_LOG: 'info', NO_COLOR: '1' } }
		);
		child = proc;
		listen = await new Promise<string>((ok, fail) => {
			let log = '';
			const timer = setTimeout(() => fail(new Error(`server did not start:\n${log}`)), 10_000);
			const read = (chunk: Buffer) => {
				log += chunk.toString();
				const m = /listening on (\S+)/.exec(log);
				if (m) {
					clearTimeout(timer);
					ok(m[1]);
				}
			};
			proc.stdout?.on('data', read);
			proc.stderr?.on('data', read);
			proc.on('exit', (code) => fail(new Error(`server exited with ${code}:\n${log}`)));
		});
	}

	async function stop() {
		const proc = child;
		child = null;
		if (!proc || proc.exitCode !== null) return;
		await new Promise<void>((ok) => {
			proc.once('exit', () => ok());
			proc.kill('SIGKILL');
		});
	}

	await start();
	return {
		url: `http://${listen}`,
		stop,
		start,
		async dispose() {
			await stop();
			rmSync(dataDir, { recursive: true, force: true });
		}
	};
}
