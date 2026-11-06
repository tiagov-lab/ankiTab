import rotateDeck from "../app/js/extended/rotateDeck.js";
import ankiConnectInvoke from "../libs/ankiConnect.js";
import {permissionsRequest, storageGet, storageSet} from "../libs/chromeApi.js";
import {getSettings, setSettings} from "../libs/settings.js";

const form = document.querySelector("#optionsForm");
const alertBox = document.querySelector(".alert");
let alertTimer = null;

export function setValue(elem, value) {
	switch (elem.type) {
		case "checkbox":
			elem.checked = !!value;
			break;
		default:
			elem.value = value === undefined || value === null ? "" : value;
	}
}

export function getValue(elem) {
	switch (elem.type) {
		case "checkbox":
			return elem.checked;
		case "number": {
			let value = parseInt(elem.value, 10);
			if (isNaN(value)) value = 0;
			const min = parseInt(elem.min, 10);
			const max = parseInt(elem.max, 10);
			if (!isNaN(min) && value < min) value = min;
			if (!isNaN(max) && value > max) value = max;
			return value;
		}
		default:
			return elem.value;
	}
}

export function readForm() {
	const settings = {};
	document.querySelectorAll(".save").forEach((elem) => {
		settings[elem.id] = getValue(elem);
	});

	const deckInputs = document.querySelectorAll(".deck");
	if (deckInputs.length) {
		settings.excludedDecks = [];
		deckInputs.forEach((deck) => {
			if (!deck.checked) settings.excludedDecks.push(deck.dataset.deck);
		});
	}
	return settings;
}

export function fillForm(settings) {
	document.querySelectorAll(".save").forEach((elem) => {
		if (elem.id in settings) setValue(elem, settings[elem.id]);
	});
}

function showSaved() {
	alertBox.style.opacity = 1;
	window.clearTimeout(alertTimer);
	alertTimer = window.setTimeout(() => {
		alertBox.style.opacity = 0;
	}, 1800);
}

function tickAll(value, event) {
	event.preventDefault();
	document.querySelectorAll(".deck").forEach((elem) => {
		elem.checked = value;
	});
}

function requestTopSites() {
	return permissionsRequest({permissions: ["topSites"]});
}

export function validateSearchUrl(input) {
	const value = input.value.trim();
	const valid = !value || value.indexOf("%s") !== -1;
	input.setCustomValidity(valid ? "" : "The search URL must contain %s");
	if (!valid) input.reportValidity();
	return valid;
}

async function ensureTopSitesPermission(settings, select) {
	if (settings.doneFallback !== "topsites" && settings.doneFallback !== "both") return;
	if (await requestTopSites()) return;
	settings.doneFallback = "search";
	if (select) select.value = "search";
}

async function saved(event) {
	event.preventDefault();

	const searchUrlInput = document.querySelector("#doneSearchUrl");
	if (!validateSearchUrl(searchUrlInput)) return;

	const settings = readForm();
	await ensureTopSitesPermission(settings, document.querySelector("#doneFallback"));

	await setSettings(settings);
	showSaved();
	rotateDeck(false).catch(() => {});
}

export function renderDecks(decks, excluded) {
	const container = document.querySelector("#decks");
	container.replaceChildren();
	decks.slice().sort().forEach((name) => {
		const parts = name.split("::");
		const labelText = "\u00a0\u00a0\u00a0".repeat(Math.max(0, parts.length - 1)) + parts[parts.length - 1];

		const wrapper = document.createElement("div");
		wrapper.className = "form-check";

		const label = document.createElement("label");
		label.className = "form-check-label";

		const input = document.createElement("input");
		input.type = "checkbox";
		input.className = "form-check-input deck";
		input.dataset.deck = name;
		input.checked = excluded.indexOf(name) === -1;

		const text = document.createElement("span");
		text.textContent = labelText;

		label.appendChild(input);
		label.appendChild(text);
		wrapper.appendChild(label);
		container.appendChild(wrapper);
	});
}

export async function loadDeckNames() {
	try {
		const stored = await storageGet(["deckNames"]);
		const names = stored.deckNames || [];
		if (names.length) return names;
		const fetched = await ankiConnectInvoke("deckNames");
		await storageSet({deckNames: fetched});
		return fetched;
	} catch (e) {
		// anki is not running; the deck list stays empty
		return [];
	}
}

async function init() {
	const settings = await getSettings();
	fillForm(settings);

	const themeSelect = document.querySelector("#themeSelect");
	themeSelect.value = window.ankitabTheme.get();
	themeSelect.addEventListener("change", () => {
		window.ankitabTheme.set(themeSelect.value);
	});

	form.addEventListener("submit", saved);
	document.querySelector("#tickall").addEventListener("click", (event) => tickAll(true, event));
	document.querySelector("#untickall").addEventListener("click", (event) => tickAll(false, event));

	const names = await loadDeckNames();
	renderDecks(names, settings.excludedDecks || []);
}

init();
