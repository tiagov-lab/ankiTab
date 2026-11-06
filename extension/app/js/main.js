import startStudy, {
	handleKeyEvent,
	renderAnswer,
	editNote,
	undo,
	suspendCard,
} from "./cards.js"
import ankiConnectInvoke from "../../libs/ankiConnect.js"
import {postTheme} from "./sandboxFrame.js"
import {showToast} from "./toast.js"

document.querySelector("base").href = "/";

const frame = document.querySelector("#flashcardSandbox");
const theme = window.ankitabTheme || {
	get: () => "system",
	isDark: () => false,
	set: () => {},
	onChange: () => {},
};

function themeName(value) {
	if (value === 'light') return 'Light';
	if (value === 'dark') return 'Dark';
	return 'System';
}

function updateThemeButton() {
	const button = document.querySelector("#themeBtn");
	if (button) button.textContent = "Theme: " + themeName(theme.get());
}

function cycleTheme() {
	const order = ['system', 'light', 'dark'];
	const current = theme.get();
	const next = order[(order.indexOf(current) + 1) % order.length];
	theme.set(next);
}

frame.addEventListener("load", postTheme);
// The query parameter lets the iframe paint the right background on its very
// first frame; the load listener and later postMessages keep it in sync.
frame.src = chrome.runtime.getURL("app/sandbox.html") +
	"?theme=" + (theme.isDark() ? "dark" : "light");
theme.onChange(() => {
	postTheme();
	updateThemeButton();
});

// Menu ------------------------------------------------------------------
const menuButton = document.querySelector("#moreButton");
const menu = document.querySelector("#menu");

function setMenuOpen(open) {
	if (!menu || !menuButton) return;
	menu.hidden = !open;
	menuButton.setAttribute("aria-expanded", open ? "true" : "false");
}

menuButton.addEventListener("click", (event) => {
	event.stopPropagation();
	setMenuOpen(menu.hidden);
});
menu.addEventListener("click", (event) => event.stopPropagation());
document.addEventListener("click", () => setMenuOpen(false));
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") setMenuOpen(false);
});

function closeMenu() {
	setMenuOpen(false);
}

document.querySelector("#optionsBtn").addEventListener("click", () => {
	closeMenu();
	location.href = chrome.runtime.getURL("options/index.html");
});

document.querySelector("#syncBtn").addEventListener("click", async () => {
	closeMenu();
	try {
		await ankiConnectInvoke("sync");
		showToast("synced");
	} catch (e) {
		showToast("could not sync");
	}
});

document.querySelector("#themeBtn").addEventListener("click", () => {
	cycleTheme();
	updateThemeButton();
});

document.querySelector("#undoBtn").addEventListener("click", () => {
	closeMenu();
	undo();
});

document.querySelector("#suspendBtn").addEventListener("click", () => {
	closeMenu();
	suspendCard();
});

// Bar buttons must not keep focus after a click, otherwise space/enter would
// activate the focused button instead of the reviewer shortcut.
document.querySelector("#answerBar").addEventListener("mousedown", (event) => {
	if (event.target.closest("button") && !event.target.closest("#menu")) event.preventDefault();
});

document.querySelector("#editBtn").addEventListener("click", () => editNote());
document.querySelector("#showAnswerBtn").addEventListener("click", () => renderAnswer());

// Messages from the sandbox --------------------------------------------
window.addEventListener("message", (event) => {
	if (!frame || event.source !== frame.contentWindow) return;
	const data = event.data;
	if (!data || typeof data !== "object") return;
	// A multiple choice card picked every option: show the answer like space does.
	if (data.command === "showAnswer") {
		renderAnswer();
		return;
	}
	if (data.command !== "key") return;
	handleKeyEvent({
		key: data.key,
		code: data.code,
		ctrlKey: !!data.ctrlKey,
		shiftKey: !!data.shiftKey,
		altKey: !!data.altKey,
		metaKey: !!data.metaKey,
		repeat: !!data.repeat,
		target: null,
		preventDefault: () => {},
	});
});

updateThemeButton();
startStudy();

if (new URLSearchParams(location.search).get("blank") !== "1") {
	window.onbeforeunload = () => {
		ankiConnectInvoke("guiDeckBrowser").catch(() => {});
	};
}
