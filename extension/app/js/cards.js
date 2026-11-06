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
	buttonNames,
	clearDueCounts,
	fetchDueCounts,
	setAnswerButtonsDisabled,
	showAnswerControls,
	showQuestionControls,
} from "./answerBar.js"

let card = null;
let state = 'busy'; // 'question' | 'answer' | 'busy'
let settings = Object.assign({}, DEFAULT_SETTINGS);
let settingsWatched = false;
let keyboardAttached = false;
let batchCount = 0; // cards answered in this tab
let batchOff = false; // "keep studying" was picked; no more cap in this tab

export function getState() {
	return state;
}

export function getCurrentCard() {
	return card;
}

function defaultSettings() {
	return Object.assign({}, DEFAULT_SETTINGS);
}

function loadSettings() {
	return getSettings().then((result) => {
		settings = Object.assign(defaultSettings(), result);
		if (card && state === 'question') fetchDueCounts(card.deckName, !!settings.showDueCounts);
	});
}

export function batchLimit() {
	return batchOff ? 0 : (Number(settings.batchSize) || 0);
}

function watchSettings() {
	if (settingsWatched) return;
	settingsWatched = true;
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== 'local') return;
		let refreshCounts = false;
		let refreshBatch = false;
		for (const key in changes) {
			settings[key] = changes[key].newValue;
			if (key === 'showDueCounts') refreshCounts = true;
			if (key === 'batchSize') refreshBatch = true;
		}
		if (refreshBatch) renderBatchProgress();
		if (refreshCounts && card) fetchDueCounts(card.deckName, !!settings.showDueCounts);
	});
}

function setTitle(deckName) {
	document.title = deckName ? "AnkiTab · " + deckName : "AnkiTab";
}

export function renderBatchProgress() {
	const container = document.querySelector("#batchProgress");
	if (!container) return;
	const limit = batchLimit();
	if (limit <= 0) {
		container.replaceChildren();
		container.hidden = true;
		container.removeAttribute("title");
		container.classList.remove("text");
		return;
	}
	container.replaceChildren();
	container.classList.toggle("text", limit > 12);
	if (limit <= 12) {
		for (let index = 0; index < limit; index++) {
			const dot = document.createElement("span");
			dot.className = "batch-dot";
			if (index < batchCount) dot.classList.add("filled");
			if (index === batchCount) dot.classList.add("current");
			container.appendChild(dot);
		}
	} else {
		container.textContent = (batchCount + 1) + " / " + limit;
	}
	container.title = "card " + (batchCount + 1) + " of " + limit + " in this tab";
	container.hidden = false;
}

export function currentButtonNames() {
	return buttonNames(card && card.buttons ? card.buttons.length : 2);
}

export function goodIndex() {
	return currentButtonNames().indexOf("Good") + 1;
}

async function renderQuestion() {
	if (!card) return;
	state = 'question';
	document.querySelector("#deckName").textContent = card.deckName || "";
	setTitle(card.deckName);
	showQuestionControls();
	renderBatchProgress();
	renderInSandbox(card, card.question, {answer: false, autoFlip: !!settings.autoFlipChoice});
	fetchDueCounts(card.deckName, !!settings.showDueCounts);
	prefetchAnswer(card);
}

export function renderAnswer() {
	if (state !== 'question' || !card) return;
	state = 'answer';
	const nextReviews = Array.isArray(card.nextReviews) ? card.nextReviews : [];
	showAnswerControls(currentButtonNames(), nextReviews, answerQuestion);
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
	if (answer < 1 || answer > currentButtonNames().length) return;
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
	batchCount++;
	const limit = batchLimit();
	if (limit > 0 && batchCount >= limit) {
		const breakMinutes = Number(settings.batchBreakMinutes) || 0;
		if (breakMinutes > 0) {
			const freeUntil = Date.now() + breakMinutes * 60000;
			settings.batchFreeUntil = freeUntil;
			storageSet({batchFreeUntil: freeUntil}).catch(() => {});
		}
		showBatchDone();
		return;
	}
	await continueStudy();
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
	const onBreak = !!opts?.onBreak;
	showDoneScreen({
		batch: {
			count: batchCount,
			onBreak,
			freeUntil: settings.batchFreeUntil,
			onContinue: () => {
				batchOff = true;
				hideOverlay();
				if (onBreak) startStudy();
				else continueStudy();
			},
		},
	});
}

export async function continueStudy() {
	state = 'busy';
	try {
		const hasDeck = await rotateDeck();
		if (!hasDeck) return;
		const next = await getCard();
		if (!next) return;
		card = next;
		await renderQuestion();
	} catch (e) {
		studyError(e);
	}
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
		const next = await getCard();
		if (!next) return;
		card = next;
		await renderQuestion();
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
		batchCount = Math.max(0, batchCount - 1);
		const next = await getCard();
		if (next) {
			card = next;
			await renderQuestion();
		}
	} catch (e) {
		if (e && e.type === 'anki') showToast("nothing to undo");
		else handleActionError(e);
	}
}

export async function suspendCard() {
	if (!card || state === 'busy') return;
	const previousState = state;
	state = 'busy';
	try {
		await ankiConnectInvoke("suspend", {cards: [card.cardId]});
		await ankiConnectInvoke("guiDeckReview", {name: card.deckName});
		showToast("card suspended");
		await continueStudy();
	} catch (e) {
		state = previousState;
		handleActionError(e, "could not suspend the card");
	}
}

export async function buryCard() {
	if (!card || state === 'busy') return;
	const previousState = state;
	state = 'busy';
	try {
		await ankiConnectInvoke("buryCards", {cards: [card.cardId]});
		showToast("card buried");
		await continueStudy();
	} catch (e) {
		state = previousState;
		if (e && (e.type === 'offline' || e.type === 'permission')) {
			handleActionError(e);
		} else {
			showToast("bury isn't supported by AnkiConnect");
		}
	}
}

const handleKey = createKeyHandler({
	state: () => state,
	showAnswer: renderAnswer,
	answer: answerQuestion,
	answerCount: () => currentButtonNames().length,
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
	await loadSettings();

	if (new URLSearchParams(location.search).get('blank') === '1') {
		state = 'busy';
		clearDueCounts();
		showDoneScreen({blank: true});
		return;
	}

	if ((Number(settings.batchSize) || 0) > 0 && Date.now() < (Number(settings.batchFreeUntil) || 0)) {
		state = 'busy';
		clearDueCounts();
		showBatchDone({onBreak: true});
		return;
	}
	await startStudy();
}
