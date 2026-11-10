import { createContext } from 'svelte';
import type {
	App,
	Focus,
	Instant,
	Intent,
	MarkId,
	Task,
	TaskId,
	TransitionKind
} from '#lib/app/app.svelte.ts';
import { HOUR } from './format';
import { haptic } from './haptic';

export type GestureIntent = Extract<Intent, { k: 'tap' | 'hold' | 'release' | 'rest' | 'off' }>;

/** What one live gesture just did, for the feedback that follows it: chips, note, pulse. */
export type Moment = {
	/** Increments per moment, so two identical gestures still read as two. */
	readonly seq: number;
	readonly mark: MarkId;
	readonly kind: TransitionKind;
	readonly from: Focus;
	readonly to: Focus;
	readonly entered: TaskId | null;
	readonly at: Instant;
	/** A task just left that is due within three hours, sooner than what came next. */
	readonly dueSoon: Task | null;
};

const NEAR = 3 * HOUR;

function tasksOf(f: Focus): readonly TaskId[] {
	return f.k === 'working' ? f.tasks : [];
}

function dueSoon(from: Focus, to: Focus, now: number, task: (id: TaskId) => Task | undefined) {
	const next = tasksOf(to);
	const nextDue = Math.min(...next.map((id) => task(id)?.deadline ?? Infinity));
	let soonest: Task | null = null;
	for (const id of tasksOf(from)) {
		if (next.includes(id)) continue;
		const t = task(id);
		const due = t?.deadline;
		if (!t || due == null || due <= now || due - now >= NEAR || due >= nextDue) continue;
		if (!soonest || due < (soonest.deadline as number)) soonest = t;
	}
	return soonest;
}

/** The gesture layer over the app: every tick goes through here so feedback can follow it. */
export class Watch {
	moment: Moment | null = $state(null);
	readonly app: App;
	#seq = 0;
	readonly #byId: ReadonlyMap<TaskId, Task>;

	constructor(app: App) {
		this.app = app;
		this.#byId = $derived(new Map(app.tasks.map((t) => [t.id, t])));
	}

	task(id: TaskId): Task | undefined {
		return this.#byId.get(id);
	}

	hueOf = (id: TaskId): number => this.#byId.get(id)?.hue ?? 0;

	/** Tap or hold a task. A hold on a task already in a juggle lets go of it. */
	press(task: TaskId, mode: 'tap' | 'hold'): Moment | null {
		const f = this.app.today.view.state.focus;
		const juggled = f.k === 'working' && f.tasks.length > 1 && f.tasks.includes(task);
		if (mode === 'tap') return this.act({ k: 'tap', task });
		return this.act({ k: juggled ? 'release' : 'hold', task });
	}

	/** Records a gesture. Null when it changed nothing, such as a tap on the task in focus. */
	act(intent: GestureIntent): Moment | null {
		const decision = this.app.do(intent);
		const change = decision.ok ? decision.changes[0] : undefined;
		if (!change) return null;
		const t = this.app.today.view.transitions.find((x) => x.mark === change.id);
		if (!t) return null;
		haptic(t.to.k === 'working' && t.to.tasks.length > 1 ? [8, 40, 8] : 10);
		if (intent.at !== undefined) return null;
		const byId = (id: TaskId) => this.task(id);
		this.moment = {
			seq: ++this.#seq,
			mark: t.mark,
			kind: t.kind,
			from: t.from,
			to: t.to,
			entered: t.entered,
			at: t.at,
			dueSoon: dueSoon(t.from, t.to, t.at, byId)
		};
		return this.moment;
	}
}

export type Ctx = { readonly app: App; readonly watch: Watch };

export const [useCtx, provideCtx] = createContext<Ctx>();
