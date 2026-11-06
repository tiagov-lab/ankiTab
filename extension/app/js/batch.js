// Batch mode state and progress rendering. The card flow owns when a batch is
// recorded or a break is scheduled; this module only tracks the count.

const DOT_LIMIT = 12;

export function createBatch() {
	let count = 0;
	let off = false;

	function limit(settings) {
		if (off) return 0;
		return Number(settings.batchSize) || 0;
	}

	function recordAnswer(settings) {
		count += 1;
		const cap = limit(settings);
		return cap > 0 && count >= cap;
	}

	function undoAnswer() {
		count = Math.max(0, count - 1);
	}

	function keepGoing() {
		off = true;
	}

	return {
		get count() {
			return count;
		},
		get off() {
			return off;
		},
		limit,
		recordAnswer,
		undoAnswer,
		keepGoing,
	};
}

export function isOnBreak(settings, now) {
	const limit = Number(settings.batchSize) || 0;
	return limit > 0 && now < (Number(settings.batchFreeUntil) || 0);
}

// The end of a break that starts now. Zero means breaks are not configured.
export function breakEndsAt(settings, now) {
	const minutes = Number(settings.batchBreakMinutes) || 0;
	if (minutes <= 0) return 0;
	return now + minutes * 60000;
}

export function renderBatchProgress(container, batch, settings) {
	const limit = batch.limit(settings);
	container.replaceChildren();
	if (limit <= 0) {
		container.hidden = true;
		container.removeAttribute("title");
		container.classList.remove("text");
		return;
	}
	container.classList.toggle("text", limit > DOT_LIMIT);
	if (limit <= DOT_LIMIT) {
		for (let index = 0; index < limit; index++) {
			const dot = document.createElement("span");
			dot.className = "batch-dot";
			if (index < batch.count) dot.classList.add("filled");
			if (index === batch.count) dot.classList.add("current");
			container.appendChild(dot);
		}
	} else {
		container.textContent = (batch.count + 1) + " / " + limit;
	}
	container.title = "card " + (batch.count + 1) + " of " + limit + " in this tab";
	container.hidden = false;
}
