// `action` is the MV3 name (Firefox MV3), `browserAction` the MV2 one (Chrome manifest)
const actionApi = chrome.action || chrome.browserAction;

actionApi.onClicked.addListener(function () { //Fired when the user clicks the extension's icon
	chrome.tabs.create({}); // opens the (overridden) new tab page
});

chrome.runtime.onInstalled.addListener(function() {
	let defaults={
		interleavingTrigger: 1,
		lastDeck:"",
		interleavingDisabled:false,
		betaEnabled:false,
		deckNames:[],
		excludedDecks:[],
		emptyDecks:[]
	};
	chrome.storage.local.get(Object.keys(defaults), function(result) {
		for(let s in result){
			delete defaults[s];
		}
		chrome.storage.local.set(defaults, function() {}); //Set missing default values
	});
});
