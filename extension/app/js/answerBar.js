import ankiConnectInvoke from "../../libs/ankiConnect.js"
import {el} from "../../libs/dom.js"

// Owns the answer bar: due counts, the question/answer control swap and the
// answer buttons. cards.js decides when to show them.

let dueCountRequest = 0;

function dueCountsLine() {
	return document.querySelector("#dueCounts");
}

export function clearDueCounts() {
	const line = dueCountsLine();
	if (!line) return;
	line.replaceChildren();
	line.hidden = true;
}

export function renderDueCounts(stats) {
	const line = dueCountsLine();
	if (!line) return;
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
			const separator = el("span", "due-sep", " + ");
			line.appendChild(separator);
		}
		const number = el("span", className, String(value));
		line.appendChild(number);
	});
	line.hidden = false;
}

export function fetchDueCounts(deckName, enabled) {
	const request = ++dueCountRequest;
	clearDueCounts();
	if (!enabled) return;
	ankiConnectInvoke("getDeckStats", {decks: [deckName]}).then((stats) => {
		if (request !== dueCountRequest) return;
		renderDueCounts(stats);
	}).catch((e) => {
		if (request === dueCountRequest) clearDueCounts();
		console.warn("AnkiTab: could not load due counts", e);
	});
}

function answerControls() {
	return document.querySelector("#answerControls");
}

export function showQuestionControls() {
	const question = document.querySelector("#questionControls");
	const answer = answerControls();
	if (question) question.hidden = false;
	if (answer) {
		answer.hidden = true;
		answer.replaceChildren();
	}
}

export function showAnswerControls(names, intervals, onAnswer) {
	const question = document.querySelector("#questionControls");
	const container = answerControls();
	if (question) question.hidden = true;
	if (!container) return;
	container.replaceChildren();

	names.forEach((name, index) => {
		const choice = el("div", "answer-choice");
		choice.appendChild(el("span", "interval", intervals[index] || ""));

		const button = el("button", "anki-btn answer-btn", name);
		button.type = "button";
		button.addEventListener("click", () => onAnswer(index + 1));

		choice.appendChild(button);
		container.appendChild(choice);
	});
	container.hidden = false;
}

export function cardButtonNames(card) {
	return buttonNames(card && card.buttons ? card.buttons.length : 2);
}

export function buttonNames(count) {
	if (count >= 4) return ["Again", "Hard", "Good", "Easy"];
	if (count === 3) return ["Again", "Good", "Easy"];
	return ["Again", "Good"];
}

export function setAnswerButtonsDisabled(disabled) {
	document.querySelectorAll("#answerControls button").forEach((button) => {
		button.disabled = disabled;
	});
}
