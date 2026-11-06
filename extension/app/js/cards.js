import rotateDeck from "./extended/rotateDeck.js"
import MIME from "./mimeTypes.js"
import ankiConnectInvoke from "../../libs/ankiConnect.js"
import {DEFAULT_SETTINGS, getSettings} from "../../libs/settings.js"
import {createKeyHandler} from "./keys.js"
import {showOffline} from "./offlineScreen.js"
import {showToast} from "./toast.js"
import {showDoneScreen} from "./doneScreen.js"

let card = null;
let state = 'busy'; // 'question' | 'answer' | 'busy'
let settings = Object.assign({}, DEFAULT_SETTINGS);
let settingsWatched = false;
let keyboardAttached = false;
let dueCountRequest = 0;

const $ = (selector) => document.querySelector(selector);

export function getState() {
	return state;
}

export function getCurrentCard() {
	return card;
}

function sandbox() {
	return document.querySelector("#flashcardSandbox");
}

function postThemeToSandbox() {
	const frame = sandbox();
	if (!frame || !frame.contentWindow) return;
	const dark = window.ankitabTheme
		? window.ankitabTheme.isDark()
		: document.documentElement.classList.contains('dark-theme');
	frame.contentWindow.postMessage({command: 'theme', dark}, '*');
}

function bufferToText(base64) {
	return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
}

function replaceAudioTags(html) {
	return html.replace(/\[sound:([^\]]*)\]/g, (match, filename) => {
		let mediaType = "audio";
		const extension = '.' + filename.split('.').pop();
		const mimeType = (MIME[extension] || "").split('/')[0];
		if (mimeType == "video")
			mediaType = "video";
		return '<' + mediaType + ' controls src="' + filename + '"></' + mediaType + '>';
	});
}

function buildCardHTML(css, content) {
	return "<style>" + css + "</style>" + replaceAudioTags(content);
}

// Card templates sometimes load helpers from Anki's media folder (<script src="_mc.js">).
// Those files only exist inside Anki, so fetch them through AnkiConnect and inline them.
async function inlineMediaScripts(html) {
	const tpl = document.createElement("template");
	tpl.innerHTML = html;
	const scripts = Array.from(tpl.content.querySelectorAll("script[src]"));
	await Promise.all(scripts.map(async (script) => {
		const src = script.getAttribute("src");
		if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src)) return; // remote URL, leave it
		try {
			const data = await ankiConnectInvoke("retrieveMediaFile", {filename: decodeURIComponent(src.split(/[?#]/)[0])});
			if (data) {
				script.removeAttribute("src");
				script.textContent = bufferToText(data);
			}
		} catch (e) {
			console.warn("AnkiTab: could not load media script", src, e);
		}
	}));
	return tpl.innerHTML;
}

let renderSeq = 0;

// main.js sets the iframe's src after this module loads; wait for that page, not
// the initial about:blank, before posting cards to it.
const frameReady = new Promise((resolve) => {
	const frame = document.querySelector("#flashcardSandbox");
	if (!frame) return resolve();
	frame.addEventListener("load", function onLoad() {
		if (!frame.getAttribute("src")) return;
		frame.removeEventListener("load", onLoad);
		resolve();
	});
});

async function renderInSandbox(content, isAnswer) {
	const seq = ++renderSeq;
	const current = getCurrentCard();
	if (!current) return;
	const html = await inlineMediaScripts(buildCardHTML(current.css, content));
	await frameReady;
	if (seq !== renderSeq) return; // a newer render (e.g. the answer) started meanwhile
	// Build the card under an invisible <div> too, which makes it easy to find
	// the media that has to be fetched from AnkiConnect.
	document.querySelector("#flashcard").innerHTML = html;
	postThemeToSandbox();
	const frame = sandbox();
	if (frame && frame.contentWindow) {
		frame.contentWindow.postMessage({
			command: 'render',
			html,
			answer: !!isAnswer,
			autoFlip: !!settings.autoFlipChoice && !isAnswer
		}, '*');
		frame.style.opacity = '';
	}
	retrieveMedia();
}

function retrieveMedia() {
	document.querySelector("#flashcard").querySelectorAll("[src]:not(script)").forEach((elem) => {
		const filename = elem.src.split('/').pop();
		const fileExtension = '.' + filename.split('.').pop();
		ankiConnectInvoke("retrieveMediaFile", {filename: decodeURIComponent(filename)}).then((data) => {
			const newSrc = "data:" + MIME[fileExtension] + ";base64," + data;
			const frame = sandbox();
			if (frame && frame.contentWindow) {
				frame.contentWindow.postMessage({
					command: 'replaceMedia', oldSrc: filename, newSrc
				}, '*');
			}
		}).catch((e) => {
			// A missing media file must never replace the card.
			console.warn("AnkiTab: could not load media", filename, e);
		});
	});
}

function defaultSettings() {
	return Object.assign({}, DEFAULT_SETTINGS);
}

function loadSettings() {
	return getSettings().then((result) => {
		settings = Object.assign(defaultSettings(), result);
		if (card && state === 'question') fetchDueCounts(card.deckName);
	});
}

function watchSettings() {
	if (settingsWatched) return;
	settingsWatched = true;
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== 'local') return;
		let refreshCounts = false;
		for (const key in changes) {
			settings[key] = changes[key].newValue;
			if (key === 'showDueCounts') refreshCounts = true;
		}
		if (refreshCounts && card) fetchDueCounts(card.deckName);
	});
}

function setTitle(deckName) {
	document.title = deckName ? "AnkiTab · " + deckName : "AnkiTab";
}

function clearDueCounts() {
	const line = document.querySelector("#dueCounts");
	if (!line) return;
	line.replaceChildren();
	line.hidden = true;
}

function renderDueCounts(stats) {
	const line = document.querySelector("#dueCounts");
	const entry = stats ? Object.values(stats)[0] : null;
	if (!entry) {
		clearDueCounts();
		return;
	}
	const newCount = Number(entry.new_count) || 0;
	const learnCount = Number(entry.learn_count) || 0;
	const reviewCount = Number(entry.review_count) || 0;

	line.replaceChildren();
	const values = [
		["due-new", newCount],
		["due-learn", learnCount],
		["due-review", reviewCount],
	];
	values.forEach(([className, value], index) => {
		if (index > 0) {
			const separator = document.createElement("span");
			separator.className = "due-sep";
			separator.textContent = " + ";
			line.appendChild(separator);
		}
		const number = document.createElement("span");
		number.className = className;
		number.textContent = String(value);
		line.appendChild(number);
	});
	line.hidden = false;
}

function fetchDueCounts(deckName) {
	const request = ++dueCountRequest;
	if (!settings.showDueCounts) {
		clearDueCounts();
		return;
	}
	clearDueCounts();
	ankiConnectInvoke("getDeckStats", {decks: [deckName]}).then((stats) => {
		if (request !== dueCountRequest) return;
		renderDueCounts(stats);
	}).catch((e) => {
		if (request === dueCountRequest) clearDueCounts();
		console.warn("AnkiTab: could not load due counts", e);
	});
}

function showQuestionControls() {
	const question = document.querySelector("#questionControls");
	const answer = document.querySelector("#answerControls");
	if (question) question.hidden = false;
	if (answer) {
		answer.hidden = true;
		answer.replaceChildren();
	}
}

function buttonNames(count) {
	if (count >= 4) return ["Again", "Hard", "Good", "Easy"];
	if (count === 3) return ["Again", "Good", "Easy"];
	return ["Again", "Good"];
}

function currentButtonNames() {
	return buttonNames(card && card.buttons ? card.buttons.length : 2);
}

function goodIndex() {
	return currentButtonNames().indexOf("Good") + 1;
}

function buildAnswerButtons() {
	const container = document.querySelector("#answerControls");
	container.replaceChildren();
	const names = currentButtonNames();
	const nextReviews = card && Array.isArray(card.nextReviews) ? card.nextReviews : [];

	names.forEach((name, index) => {
		const choice = document.createElement("div");
		choice.className = "answer-choice";

		const interval = document.createElement("span");
		interval.className = "interval";
		interval.textContent = nextReviews[index] || "";

		const button = document.createElement("button");
		button.type = "button";
		button.className = "anki-btn answer-btn";
		button.textContent = name;
		button.addEventListener("click", () => answerQuestion(index + 1));

		choice.appendChild(interval);
		choice.appendChild(button);
		container.appendChild(choice);
	});
	container.hidden = false;
}

async function renderQuestion() {
	if (!card) return;
	state = 'question';
	document.querySelector("#deckName").textContent = card.deckName || "";
	setTitle(card.deckName);
	showQuestionControls();
	renderInSandbox(card.question, false);
	fetchDueCounts(card.deckName);
}

export function renderAnswer() {
	if (state !== 'question' || !card) return;
	state = 'answer';
	document.querySelector("#questionControls").hidden = true;
	buildAnswerButtons();
	renderInSandbox(card.answer, true);
	ankiConnectInvoke("guiShowAnswer").catch((e) => {
		console.warn("AnkiTab: guiShowAnswer failed", e);
	});
}

function setAnswerButtonsDisabled(disabled) {
	document.querySelectorAll("#answerControls button").forEach((button) => {
		button.disabled = disabled;
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

async function answerQuestion(answer) {
	if (state !== 'answer' || !card) return;
	if (answer < 1 || answer > currentButtonNames().length) return;
	state = 'busy';
	setAnswerButtonsDisabled(true);
	const frame = sandbox();
	if (frame) frame.style.opacity = '0.4';

	try {
		await ankiConnectInvoke("guiAnswerCard", {ease: answer});
	} catch (e) {
		if (frame) frame.style.opacity = '';
		state = 'answer';
		setAnswerButtonsDisabled(false);
		handleActionError(e, "could not save the answer");
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

async function continueStudy() {
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
	const result = await new Promise((resolve) => {
		chrome.storage.local.get(["lastDeck", "emptyDecks"], resolve);
	});
	const emptyDecks = (result.emptyDecks || []).slice();
	const name = result.lastDeck || (card && card.deckName);
	if (name) emptyDecks.push({name, date: Date.now()});
	await new Promise((resolve) => {
		chrome.storage.local.set({emptyDecks}, resolve);
	});
}

async function getCard(attempt = 0) {
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

async function startStudy() {
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

function replayAudio() {
	const frame = sandbox();
	if (frame && frame.contentWindow) {
		frame.contentWindow.postMessage({command: 'replayAudio'}, '*');
	}
}

export async function undo() {
	if (state === 'busy') return;
	try {
		await ankiConnectInvoke("guiUndo");
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

async function buryCard() {
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
	await startStudy();
}
