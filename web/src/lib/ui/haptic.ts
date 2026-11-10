let iosSwitch: HTMLLabelElement | null = null;

/**
 * A short tactile tick on a gesture. Android has `navigator.vibrate`. iOS Safari has none,
 * but toggling an `<input type="checkbox" switch>` plays the system switch haptic, and a
 * click on its label from inside a user gesture is enough to toggle it.
 */
export function haptic(pattern: number | number[] = 10): void {
	if (typeof navigator.vibrate === 'function') {
		navigator.vibrate(pattern);
		return;
	}
	if (!matchMedia('(pointer: coarse)').matches) return;
	if (!iosSwitch) {
		iosSwitch = document.createElement('label');
		iosSwitch.setAttribute('aria-hidden', 'true');
		iosSwitch.style.cssText =
			'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.setAttribute('switch', '');
		input.tabIndex = -1;
		iosSwitch.append(input);
		document.body.append(iosSwitch);
	}
	iosSwitch.click();
}
