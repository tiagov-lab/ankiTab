import rotateDeck from "./extended/rotateDeck.js"
import ankiConnectInvoke from "../../libs/ankiConnect.js"
import {storageGet, storageSet} from "../../libs/chromeApi.js"
import {hideOverlay} from "../../libs/dom.js"
import {DEFAULT_SETTINGS, getSettings} from "../../libs/settings.js"
import {createKeyHandler} from "./keys.js"
import {showOffline} from "./offlineScreen.js"
import {prefetchAnswer, renderInSandbox} from "./renderCard.js"
import {postToSandbox, setDimmed} from "./sandboxFrame.js"
import {showToast} from "./toast.js"
import {showDoneScreen} from "./doneScreen.js"
import {
	cardButtonNames,
	clearDueCounts,
	fetchDueCounts,
	setAnswerButtonsDisabled,
	showAnswerControls,
	showQuestionControls,
} from "./answerBar.js"
import {breakEndsAt, createBatch, isOnBreak, renderBatchProgress} from "./batch.js"

let card = null;
let state = 'busy'; // 'question' | 'answer' | 'busy'
let settings = Object.assign({}, DEFAULT_SETTINGS);
let settingsWatched = false;
let keyboardAttached = false;
const batch = createBatch();

export function getState() {
	return state;
}

export function getCurrentCard() {
	return card;
}

export function batchLimit() {
	return batch.limit(settings);
}

function refreshBatchProgress() {
	const container = document.querySelector("#batchProgress");
	if (!container) return;
	renderBatchProgress(container, batch, settings);
}

function watchSettings() {
	if (settingsWatched) return;
	settingsWatched = true;
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== 'local') return;
		for (const key in changes) settings[key] = changes[key].newValue;
		if (changes.batchSize) refreshBatchProgress();
		if (changes.showDueCounts && card) fetchDueCounts(card.deckName, !!settings.showDueCounts);
	});
}

export function goodIndex() {
	return cardButtonNames(card).indexOf("Good") + 1;
}

async function renderQuestion() {
	if (!card) return;
	state = 'question';
	document.querySelector("#deckName").textContent = card.deckName || "";
	document.title = card.deckName ? "AnkiTab · " + card.deckName : "AnkiTab";
	showQuestionControls();
	refreshBatchProgress();
	renderInSandbox(card, card.question, {answer: false, autoFlip: !!settings.autoFlipChoice});
	fetchDueCounts(card.deckName, !!settings.showDueCounts);
	prefetchAnswer(card);
}

export function renderAnswer() {
	if (state !== 'question' || !card) return;
	state = 'answer';
	const nextReviews = Array.isArray(card.nextReviews) ? card.nextReviews : [];
	showAnswerControls(cardButtonNames(card), nextReviews, answerQuestion);
	renderInSandbox(card, card.answer, {answer: true});
	ankiConnectInvoke("guiShowAnswer").catch((e) => {
		console.warn("AnkiTab: guiShowAnswer failed", e);
	});
}

function handleActionError(e, fallbackMessage) {
	if (e && e.type === 'permission') {
		showOffline({permission: true, onRetry: startStudy});
	} else if (e && e.type === 'offline') {
		showOffline({onRetry: startStudy});
	} else {
		console.warn("AnkiTab: action failed", e);
		if (fallbackMessage) showToast(fallbackMessage);
	}
}

export async function answerQuestion(answer) {
	if (state !== 'answer' || !card) return;
	if (answer < 1 || answer > cardButtonNames(card).length) return;
	state = 'busy';
	setAnswerButtonsDisabled(true);
	setDimmed(true);

	try {
		await ankiConnectInvoke("guiAnswerCard", {ease: answer});
	} catch (e) {
		setDimmed(false);
		state = 'answer';
		setAnswerButtonsDisabled(false);
		handleActionError(e, "could not save the answer");
		return;
	}
	if (batch.recordAnswer(settings)) {
		const freeUntil = breakEndsAt(settings, Date.now());
		if (freeUntil > 0) {
			settings.batchFreeUntil = freeUntil;
			storageSet({batchFreeUntil: freeUntil}).catch(() => {});
		}
		showBatchDone();
		return;
	}
	await startStudy();
}

// Anki errors while fetching a card (e.g. interleaving off and nothing left to
// review) mean there is no card to show: end on the done screen, not a blank page.
function studyError(e) {
	if (e && e.type === 'anki') {
		console.warn("AnkiTab: no card to show", e);
		state = 'busy';
		showDoneScreen();
	} else {
		handleActionError(e);
	}
}

export function showBatchDone(opts) {
	showDoneScreen({
		batch: {
			count: batch.count,
			onBreak: !!opts?.onBreak,
			freeUntil: settings.batchFreeUntil,
			onContinue: () => {
				batch.keepGoing();
				hideOverlay();
				startStudy();
			},
		},
	});
}

async function markCurrentDeckEmpty() {
	const result = await storageGet(["lastDeck", "emptyDecks"]);
	const emptyDecks = (result.emptyDecks || []).slice();
	const name = result.lastDeck || (card && card.deckName);
	if (name) emptyDecks.push({name, date: Date.now()});
	await storageSet({emptyDecks});
}

export async function getCard(attempt = 0) {
	try {
		const result = await ankiConnectInvoke("guiCurrentCard");
		if (typeof result.question !== "string") {
			result.question = result.question[0];
		}
		card = result;
		return result;
	} catch (e) {
		if (e && e.type === 'anki' && attempt < 5) {
			await markCurrentDeckEmpty();
			const hasDeck = await rotateDeck();
			if (!hasDeck) return null;
			return getCard(attempt + 1);
		}
		throw e;
	}
}

export async function startStudy() {
	state = 'busy';
	try {
		const hasDeck = await rotateDeck();
		if (!hasDeck) return;
		if (await getCard()) await renderQuestion();
	} catch (e) {
		studyError(e);
	}
}

export async function editNote() {
	if (!card) return;
	try {
		const info = await ankiConnectInvoke("cardsInfo", {cards: [card.cardId]});
		const note = info && info[0] && info[0].note;
		if (!note) throw {type: 'anki', message: 'note not found'};
		await ankiConnectInvoke("guiEditNote", {note});
		showToast("opened in anki");
	} catch (e) {
		handleActionError(e, "could not open the editor");
	}
}

export function replayAudio() {
	postToSandbox({command: 'replayAudio'});
}

export async function undo() {
	if (state === 'busy') return;
	try {
		await ankiConnectInvoke("guiUndo");
		batch.undoAnswer();
		if (await getCard()) await renderQuestion();
	} catch (e) {
		if (e && e.type === 'anki') showToast("nothing to undo");
		else handleActionError(e);
	}
}

async function runCardAction(action, onError) {
	const previousState = state;
	state = 'busy';
	try {
		await action();
		await startStudy();
	} catch (e) {
		state = previousState;
		onError(e);
	}
}

export async function suspendCard() {
	if (!card || state === 'busy') return;
	await runCardAction(async () => {
		await ankiConnectInvoke("suspend", {cards: [card.cardId]});
		await ankiConnectInvoke("guiDeckReview", {name: card.deckName});
		showToast("card suspended");
	}, (e) => handleActionError(e, "could not suspend the card"));
}

export async function buryCard() {
	if (!card || state === 'busy') return;
	await runCardAction(async () => {
		await ankiConnectInvoke("buryCards", {cards: [card.cardId]});
		showToast("card buried");
	}, (e) => {
		if (e && (e.type === 'offline' || e.type === 'permission')) handleActionError(e);
		else showToast("bury isn't supported by AnkiConnect");
	});
}

const handleKey = createKeyHandler({
	state: () => state,
	showAnswer: renderAnswer,
	answer: answerQuestion,
	answerCount: () => cardButtonNames(card).length,
	goodIndex,
	edit: editNote,
	undo,
	suspend: suspendCard,
	bury: buryCard,
	replay: replayAudio,
});

export function handleKeyEvent(event) {
	handleKey(event);
}

export default async function start() {
	if (!keyboardAttached) {
		document.addEventListener('keydown', handleKey);
		keyboardAttached = true;
	}
	watchSettings();
	settings = Object.assign({}, DEFAULT_SETTINGS, await getSettings());
	if (card && state === 'question') fetchDueCounts(card.deckName, !!settings.showDueCounts);

	if (new URLSearchParams(location.search).get('blank') === '1') {
		state = 'busy';
		clearDueCounts();
		showDoneScreen({blank: true});
		return;
	}

	if (isOnBreak(settings, Date.now())) {
		state = 'busy';
		clearDueCounts();
		showBatchDone({onBreak: true});
		return;
	}
	await startStudy();
}
