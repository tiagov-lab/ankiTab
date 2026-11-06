import rotateDeck from "./extended/rotateDeck.js"
import MIME from "./mimeTypes.js"
import ankiConnectInvoke from "../../libs/ankiConnect.js"
import {storageGet, storageSet} from "../../libs/chromeApi.js"
import {hideOverlay} from "../../libs/dom.js"
import {DEFAULT_SETTINGS, getSettings} from "../../libs/settings.js"
import {isRemoteUrl, mediaFilename} from "../../libs/url.js"
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
let batchCount = 0; // cards answered in this tab
let batchOff = false; // "keep studying" was picked; no more cap in this tab

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

export function bufferToText(base64) {
	return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
}

export function replaceAudioTags(html) {
	return html.replace(/\[sound:([^\]]*)\]/g, (match, filename) => {
		let mediaType = "audio";
		const extension = '.' + filename.split('.').pop();
		const mimeType = (MIME[extension] || "").split('/')[0];
		if (mimeType == "video")
			mediaType = "video";
		return '<' + mediaType + ' controls src="' + filename + '"></' + mediaType + '>';
	});
}

export function buildCardHTML(css, content) {
	return "<style>" + css + "</style>" + replaceAudioTags(content);
}

// Card templates sometimes load helpers from Anki's media folder (<script src="_mc.js">).
// Those files only exist inside Anki, so fetch them through AnkiConnect and inline them.
export async function inlineMediaScripts(html) {
	const tpl = document.createElement("template");
	tpl.innerHTML = html;
	const scripts = Array.from(tpl.content.querySelectorAll("script[src]"));
	await Promise.all(scripts.map(async (script) => {
		const src = script.getAttribute("src");
		if (isRemoteUrl(src)) return; // remote URL, leave it
		try {
			const data = await ankiConnectInvoke("retrieveMediaFile", {filename: mediaFilename(src)});
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

// Media referenced by a card (<img src="paste-123.jpg">) only exists inside
// Anki, so it is fetched through AnkiConnect and inlined as a data URI before
// the card is posted to the sandbox. Without this the card would paint with a
// broken image and pop it in later. Promises are cached (not values) so a flip
// reuses the front's fetches and concurrent requests share one call.
const MEDIA_CACHE_LIMIT = 200;
const mediaCache = new Map();

export function getMediaDataUri(filename) {
	const cached = mediaCache.get(filename);
	if (cached) return cached;
	const promise = ankiConnectInvoke("retrieveMediaFile", {filename}).then((data) => {
		if (!data) throw new Error("no media data");
		const fileExtension = '.' + filename.split('.').pop();
		return "data:" + (MIME[fileExtension] || "application/octet-stream") + ";base64," + data;
	}).catch((e) => {
		// A missing media file must never replace the card.
		console.warn("AnkiTab: could not load media", filename, e);
		mediaCache.delete(filename);
		return null;
	});
	mediaCache.set(filename, promise);
	// Long sessions touch a lot of cards; keep memory bounded.
	if (mediaCache.size > MEDIA_CACHE_LIMIT) {
		mediaCache.delete(mediaCache.keys().next().value);
	}
	return promise;
}

// Inline every local src (img, audio, video, source, embed...) as a data URI.
// Anything that already has a scheme is left alone; a file that cannot be
// fetched keeps its original src.
export async function resolveMedia(html) {
	const tpl = document.createElement("template");
	tpl.innerHTML = html;
	const elements = Array.from(tpl.content.querySelectorAll("[src]"))
		.filter((elem) => elem.tagName.toLowerCase() !== "script");
	await Promise.all(elements.map(async (elem) => {
		try {
			const src = elem.getAttribute("src");
			if (!src || isRemoteUrl(src)) return; // remote URL or data URI
			const dataUri = await getMediaDataUri(mediaFilename(src));
			if (dataUri) elem.setAttribute("src", dataUri);
		} catch (e) {
			console.warn("AnkiTab: could not resolve media", elem.getAttribute("src"), e);
		}
	}));
	return tpl.innerHTML;
}

// Note types load fonts from Anki's media folder with @font-face
// (src: url('_yumin.ttf')). Kanji fonts are 5-25 MB each, so inlining them into
// every card's css would re-send and re-parse them on each render. Instead the
// local @font-face rules are stripped from the css and each font file is sent to
// the sandbox once, where it is registered with the FontFace API.
const FONT_FACE_RULE = /@font-face\s*\{[^}]*\}/gi;
const sentFonts = new Map(); // "family|filename|weight|style" -> promise

export function cssValue(block, property) {
	const match = block.match(new RegExp("(?:^|[;{\\s])" + property + "\\s*:\\s*([^;}]+)", "i"));
	return match ? match[1].trim() : "";
}

export function extractLocalFontFaces(css) {
	const faces = [];
	const stripped = (css || "").replace(FONT_FACE_RULE, (block) => {
		const family = cssValue(block, "font-family").replace(/^(['"])(.*)\1$/, "$2").trim();
		const src = cssValue(block, "src");
		const urls = Array.from(src.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi), (m) => m[2].trim());
		const local = urls.find((url) => !isRemoteUrl(url));
		if (!family || !local) return block; // remote or data: fonts load on their own
		const descriptors = {};
		const weight = cssValue(block, "font-weight");
		const style = cssValue(block, "font-style");
		if (weight) descriptors.weight = weight;
		if (style) descriptors.style = style;
		faces.push({family, filename: mediaFilename(local), descriptors});
		return "";
	});
	return {css: stripped, faces};
}

export function base64ToBuffer(base64) {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

// Resolves once the font has been posted (or failed); the sandbox itself waits
// for the face to finish loading before it shows a card that uses it.
export function sendFontToSandbox(face) {
	const key = [face.family, face.filename, face.descriptors.weight || "", face.descriptors.style || ""].join("|");
	if (sentFonts.has(key)) return sentFonts.get(key);
	const promise = ankiConnectInvoke("retrieveMediaFile", {filename: face.filename}).then(async (data) => {
		if (!data) throw new Error("no media data");
		const buffer = base64ToBuffer(data);
		await frameReady;
		const frame = sandbox();
		if (!frame || !frame.contentWindow) throw new Error("no sandbox");
		frame.contentWindow.postMessage({command: "font", key, family: face.family, descriptors: face.descriptors, data: buffer}, "*", [buffer]);
	}).catch((e) => {
		console.warn("AnkiTab: could not load font", face.filename, e);
		sentFonts.delete(key);
	});
	sentFonts.set(key, promise);
	return promise;
}

export function prepareCardCss(css) {
	const {css: stripped, faces} = extractLocalFontFaces(css);
	return {css: stripped, fonts: Promise.all(faces.map(sendFontToSandbox))};
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
	const prepared = prepareCardCss(current.css);
	const html = await resolveMedia(await inlineMediaScripts(buildCardHTML(prepared.css, content)));
	await prepared.fonts;
	await frameReady;
	if (seq !== renderSeq) return; // a newer render (e.g. the answer) started meanwhile
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

export function renderDueCounts(stats) {
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

export function fetchDueCounts(deckName) {
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

export function buttonNames(count) {
	if (count >= 4) return ["Again", "Hard", "Good", "Easy"];
	if (count === 3) return ["Again", "Good", "Easy"];
	return ["Again", "Good"];
}

export function currentButtonNames() {
	return buttonNames(card && card.buttons ? card.buttons.length : 2);
}

export function goodIndex() {
	return currentButtonNames().indexOf("Good") + 1;
}

export function buildAnswerButtons() {
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
	renderBatchProgress();
	renderInSandbox(card.question, false);
	fetchDueCounts(card.deckName);
	// Warm the media cache with the back side, so flipping does not wait for it.
	try {
		resolveMedia(buildCardHTML(prepareCardCss(card.css).css, card.answer)).catch(() => {});
	} catch (e) {
		// Prefetch is best effort; the answer render resolves its media itself.
	}
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

export async function answerQuestion(answer) {
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
	const frame = sandbox();
	if (frame && frame.contentWindow) {
		frame.contentWindow.postMessage({command: 'replayAudio'}, '*');
	}
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
