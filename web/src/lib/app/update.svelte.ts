/**
 * Whether a newer build sits installed behind the running one. The service worker holds a
 * new build back until every window closes; this notices it waiting, so the page can offer
 * to reload into it now. Checks for a new build each time the app comes back to the screen,
 * since a home-screen app may stay open for days without a navigation that would check.
 */
export class Update {
	#ready = $state(false);
	#dismissed = $state(false);
	#reg: ServiceWorkerRegistration | null = null;

	/** A new build is installed and waits for this page to let go. */
	get ready(): boolean {
		return this.#ready;
	}

	/** Whether to offer the new build unasked; closed, it waits on the more screen. */
	get offer(): boolean {
		return this.#ready && !this.#dismissed;
	}

	/** Stops offering the new build until the next launch. */
	dismiss(): void {
		this.#dismissed = true;
	}

	async start(): Promise<void> {
		if (this.#reg || !('serviceWorker' in navigator)) return;
		const reg = await navigator.serviceWorker.ready;
		this.#reg = reg;
		this.#watch(reg);
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') void reg.update().catch(() => {});
		});
	}

	/** Lets the waiting build take over, then reloads into it. */
	apply(): void {
		const waiting = this.#reg?.waiting;
		if (!waiting) {
			location.reload();
			return;
		}
		navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
			once: true
		});
		waiting.postMessage('take-over');
	}

	#watch(reg: ServiceWorkerRegistration) {
		// A first install has no build to replace: it controls this page without a reload.
		const replaces = () => navigator.serviceWorker.controller !== null;
		if (reg.waiting && replaces()) this.#ready = true;
		reg.addEventListener('updatefound', () => {
			const next = reg.installing;
			next?.addEventListener('statechange', () => {
				if (next.state === 'installed' && replaces()) this.#ready = true;
			});
		});
	}
}

/** The one per page: the service worker is shared by every screen. */
export const update = new Update();
