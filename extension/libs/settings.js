// Single source of truth for the extension's stored settings.
// bg.js (a classic background script) keeps a copy of this object because it
// cannot import ES modules; keep the two in sync.
export const DEFAULT_SETTINGS = {
	interleavingTrigger: 1,
	lastDeck: "",
	interleavingDisabled: false,
	deckNames: [],
	excludedDecks: [],
	emptyDecks: [],
	doneShowStats: true,
	doneShowNextDue: true,
	doneFallback: "search",
	doneSearchUrl: "https://duckduckgo.com/?q=%s",
	showDueCounts: true,
	autoFlipChoice: true,
	batchSize: 0,
	batchBreakMinutes: 0,
	batchFreeUntil: 0,
};

// Returns every setting, with defaults filled in for anything not stored yet.
export function getSettings() {
	return new Promise((resolve) => {
		chrome.storage.local.get(DEFAULT_SETTINGS, (result) => resolve(result));
	});
}

export function setSettings(partial) {
	return new Promise((resolve) => {
		chrome.storage.local.set(partial, () => resolve());
	});
}
