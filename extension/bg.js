// `action` is the MV3 name (Firefox MV3), `browserAction` the MV2 one (Chrome manifest)
const actionApi = chrome.action || chrome.browserAction;

actionApi.onClicked.addListener(function () { //Fired when the user clicks the extension's icon
	chrome.tabs.create({}); // opens the (overridden) new tab page
});

// This is a classic background script, so it cannot import
// extension/libs/settings.js. Keep this object in sync with DEFAULT_SETTINGS there.
const defaults = {
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
};

chrome.runtime.onInstalled.addListener(function() {
	chrome.storage.local.get(Object.keys(defaults), function(result) {
		const missing = {};
		for (const key in defaults) {
			if (!(key in result)) missing[key] = defaults[key];
		}
		chrome.storage.local.set(missing, function() {}); //Set missing default values
	});
});
