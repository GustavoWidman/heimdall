import type { RangeTotals } from '../domain/stats';
import { spent } from '../ui/format';

const MINUTE = 60_000;

function count(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

/**
 * How one week reads next to the week before, as plain description. A week still under
 * way is set against the same days of the week before, so a Tuesday is not compared to a
 * whole week.
 */
export function contrast(cur: RangeTotals, prev: RangeTotals, partial: boolean): string[] {
	const ref = partial ? 'by this point last week' : 'last week';
	if (prev.ticks === 0 && prev.focusMs === 0 && prev.restMs === 0) {
		return ['nothing was watched the week before, so there is nothing to set this one against.'];
	}
	const lines: string[] = [];
	const ds = cur.switches - prev.switches;
	if (ds > 0) lines.push(`${count(ds, 'more switch', 'more switches')} than ${ref}`);
	else if (ds < 0) lines.push(`${count(-ds, 'fewer switch', 'fewer switches')} than ${ref}`);
	else lines.push(`as many switches as ${ref}`);
	for (const [noun, d] of [
		['focus', cur.focusMs - prev.focusMs],
		['juggling', cur.juggleMs - prev.juggleMs],
		['load', cur.loadMs - prev.loadMs]
	] as const) {
		if (Math.abs(d) < 5 * MINUTE) lines.push(`about the same ${noun} as ${ref}`);
		else lines.push(`${spent(Math.abs(d))} ${d > 0 ? 'more' : 'less'} ${noun} than ${ref}`);
	}
	return lines;
}
