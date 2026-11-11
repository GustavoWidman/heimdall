// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	/** The release this build belongs to, from package.json. */
	const __HEIMDALL_VERSION__: string;

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

declare module 'svelte/elements' {
	interface HTMLInputAttributes {
		/** Safari's switch control for a checkbox. */
		switch?: boolean;
	}
}

export {};
