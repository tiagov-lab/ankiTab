let hideTimer = null;
let removeTimer = null;

export function showToast(message) {
	const el = document.getElementById('toast');
	if (!el) return;
	window.clearTimeout(hideTimer);
	window.clearTimeout(removeTimer);
	el.textContent = message;
	el.hidden = false;
	// Force a frame so the transition runs when the toast is shown again.
	requestAnimationFrame(() => el.classList.add('visible'));
	hideTimer = window.setTimeout(() => {
		el.classList.remove('visible');
		removeTimer = window.setTimeout(() => {
			el.hidden = true;
		}, 250);
	}, 2500);
}
