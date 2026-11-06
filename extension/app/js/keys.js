// Anki-desktop style keyboard handling. The reviewer owns the state machine
// (question | answer | busy); this module only maps keys to actions.
export function isEditableTarget(target) {
	if (!target || !target.tagName) return false;
	const tag = target.tagName.toLowerCase();
	return (
		tag === "input" ||
		tag === "textarea" ||
		tag === "select" ||
		target.isContentEditable === true
	);
}

function stop(event) {
	if (event && typeof event.preventDefault === "function") event.preventDefault();
}

/**
 * handlers: {
 *   state(): 'question' | 'answer' | 'busy',
 *   showAnswer(), answer(index), answerCount(), goodIndex(),
 *   showEdit(), undo(), bury(), suspend()
 * }
 */
export function createKeyHandler(handlers) {
	return function handleKey(event) {
		if (!event || event.repeat) return;
		if (event.altKey || event.metaKey) return;
		if (event.ctrlKey && event.key.toLowerCase() !== 'z') return;
		if (isEditableTarget(event.target)) return;
		// let the More menu's buttons handle their own enter/space
		if (event.target && event.target.closest && event.target.closest('#menu')) return;

		const state = handlers.state();
		if (state === 'busy') return;

		const key = event.key;

		if (event.ctrlKey) {
			// ctrl+z
			stop(event);
			handlers.undo();
			return;
		}

		// shift+2 is '@' on us layouts. Check for it before digits.
		if (key === '@') {
			stop(event);
			handlers.suspend();
			return;
		}

		if (key === '-') {
			stop(event);
			handlers.bury();
			return;
		}

		if (key === ' ' || key === 'Enter') {
			stop(event);
			if (state === 'question') handlers.showAnswer();
			else if (state === 'answer') handlers.answer(handlers.goodIndex());
			return;
		}

		if (state === 'answer' && key.length === 1 && key >= '1' && key <= '4') {
			const ease = Number(key);
			if (ease <= handlers.answerCount()) {
				stop(event);
				handlers.answer(ease);
			}
			return;
		}

		if (key === 'e' || key === 'E') {
			stop(event);
			handlers.edit();
			return;
		}

		if (key === 'r' || key === 'R' || key === 'F5' || event.code === 'F5') {
			stop(event);
			handlers.replay();
			return;
		}
	};
}
