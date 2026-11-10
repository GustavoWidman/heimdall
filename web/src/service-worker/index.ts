/**
 * Keeps heimdall opening offline. Each build precaches itself under its own cache, serves
 * every navigation from the cached app shell, and leaves /api to the network. A new build
 * installs in the background and waits: it takes over at the next launch, once no window
 * runs the old one, so an update never lands mid-tap.
 */
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { self } from '$app/service-worker';

const CACHE = `heimdall-${version}`;
const SHELL = '/';
const PRECACHE = [SHELL, ...immutable.map((f) => `/${f.path}`), ...assets.map((f) => `/${f.path}`)];
const precached = new Set(PRECACHE);

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

	if (request.mode === 'navigate') {
		event.respondWith(fromCache(SHELL, request));
	} else if (precached.has(url.pathname)) {
		event.respondWith(fromCache(url.pathname, request));
	}
});

async function fromCache(key: string, request: Request): Promise<Response> {
	const cache = await caches.open(CACHE);
	return (await cache.match(key)) ?? fetch(request);
}
