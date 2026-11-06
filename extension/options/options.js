import rotateDeck from "../app/js/extended/rotateDeck.js";
import ankiConnectInvoke from "../libs/ankiConnect.js";
import {getSettings, setSettings} from "../libs/settings.js";

const form = document.querySelector("#optionsForm");
const alertBox = document.querySelector(".alert");
let alertTimer = null;

function setValue(elem, value) {
	switch (elem.type) {
		case "checkbox":
			elem.checked = !!value;
			break;
		default:
			elem.value = value === undefined || value === null ? "" : value;
	}
}

function getValue(elem) {
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
	return new Promise((resolve) => {
		if (!chrome.permissions || !chrome.permissions.request) {
			resolve(false);
			return;
		}
		try {
			const maybePromise = chrome.permissions.request({permissions: ["topSites"]}, (granted) => {
				void chrome.runtime.lastError;
				resolve(!!granted);
			});
			if (maybePromise && typeof maybePromise.then === "function") {
				maybePromise.then((granted) => resolve(!!granted), () => resolve(false));
			}
		} catch (e) {
			resolve(false);
		}
	});
}

async function saved(event) {
	event.preventDefault();

	const searchUrlInput = document.querySelector("#doneSearchUrl");
	const value = searchUrlInput.value.trim();
	if (value && value.indexOf("%s") === -1) {
		searchUrlInput.setCustomValidity("The search URL must contain %s");
		searchUrlInput.reportValidity();
		return;
	}
	searchUrlInput.setCustomValidity("");

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

	const fallback = document.querySelector("#doneFallback");
	if (settings.doneFallback === "topsites" || settings.doneFallback === "both") {
		const granted = await requestTopSites();
		if (!granted) {
			settings.doneFallback = "search";
			fallback.value = "search";
		}
	}

	await setSettings(settings);
	showSaved();
	rotateDeck(false).catch(() => {});
}

function renderDecks(decks, excluded) {
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

async function init() {
	const settings = await getSettings();
	document.querySelectorAll(".save").forEach((elem) => {
		if (elem.id in settings) setValue(elem, settings[elem.id]);
	});

	const themeSelect = document.querySelector("#themeSelect");
	themeSelect.value = window.ankitabTheme.get();
	themeSelect.addEventListener("change", () => {
		window.ankitabTheme.set(themeSelect.value);
	});

	form.addEventListener("submit", saved);
	document.querySelector("#tickall").addEventListener("click", (event) => tickAll(true, event));
	document.querySelector("#untickall").addEventListener("click", (event) => tickAll(false, event));

	const rate = document.querySelector("#rateLink");
	if (navigator.userAgent.indexOf("Firefox") !== -1) {
		rate.href = "https://addons.mozilla.org/en-US/firefox/addon/ankitab/";
	}

	let names = [];
	try {
		const stored = await new Promise((resolve) => chrome.storage.local.get(["deckNames"], resolve));
		names = stored.deckNames || [];
		if (!names.length) {
			names = await ankiConnectInvoke("deckNames");
			await new Promise((resolve) => chrome.storage.local.set({deckNames: names}, resolve));
		}
	} catch (e) {
		// anki is not running; the deck list stays empty
	}
	renderDecks(names, settings.excludedDecks || []);
}

init();
