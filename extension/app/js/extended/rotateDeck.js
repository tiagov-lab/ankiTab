import ankiConnectInvoke from "../../../libs/ankiConnect.js"
import {storageGet, storageSet} from "../../../libs/chromeApi.js"
import {showDoneScreen} from "../doneScreen.js"

const checkEmptyDelay=3600*1000; // in milliseconds

// Picks the next deck and asks Anki to review it. Resolves true when a deck was
// started, false when everything scheduled for today has been reviewed.
export default async function rotateDeck(DOMchange=true){
	const result = await storageGet(["interleavingDisabled", "excludedDecks", "lastDeck", "deckNames", "emptyDecks"]);
	if(result.interleavingDisabled){
		return true;
	}

	let deckNames = result.deckNames || [];
	if(!deckNames.length){
		deckNames = await ankiConnectInvoke("deckNames");
		await storageSet({deckNames});
	}else{
		// refresh the cache for the next run without blocking this card
		ankiConnectInvoke("deckNames").then((decks)=>storageSet({deckNames: decks})).catch(()=>{});
	}

	const now = Date.now();
	const emptyDecks = (result.emptyDecks || []).filter((deck)=>Math.abs(now-deck.date)<checkEmptyDelay);
	await storageSet({emptyDecks});
	const emptyDeckNames = emptyDecks.map((deck)=>deck.name);
	const excludedDecks = result.excludedDecks || [];

	const decksLeft = deckNames.filter((deck)=>excludedDecks.indexOf(deck)==-1 && emptyDeckNames.indexOf(deck)==-1);
	if(!decksLeft.length){
		// All cards scheduled for today have been reviewed
		if(DOMchange){
			showDoneScreen();
		}
		return false;
	}

	const lastDeck = decksLeft.sort().filter((deck)=>deck>result.lastDeck).shift() || decksLeft[0];
	await ankiConnectInvoke("guiDeckReview", {name: lastDeck});
	await storageSet({lastDeck});
	return true;
};
