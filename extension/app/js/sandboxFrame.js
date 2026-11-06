// Everything that talks to the card iframe: waiting for its page, posting
// messages, keeping its theme in sync and dimming it while an answer saves.

function sandbox() {
	return document.querySelector("#flashcardSandbox");
}

// main.js sets the iframe's src after this module loads; wait for that page, not
// the initial about:blank, before posting cards to it.
export const frameReady = new Promise((resolve) => {
	const frame = sandbox();
	if (!frame) return resolve();
	frame.addEventListener("load", function onLoad() {
		if (!frame.getAttribute("src")) return;
		frame.removeEventListener("load", onLoad);
		resolve();
	});
});

export function postToSandbox(message, transfer) {
	const frame = sandbox();
	if (!frame || !frame.contentWindow) return false;
	if (transfer) frame.contentWindow.postMessage(message, "*", transfer);
	else frame.contentWindow.postMessage(message, "*");
	return true;
}

export function postTheme() {
	const dark = window.ankitabTheme
		? window.ankitabTheme.isDark()
		: document.documentElement.classList.contains("dark-theme");
	postToSandbox({command: "theme", dark});
}

export function setDimmed(dimmed) {
	const frame = sandbox();
	if (frame) frame.style.opacity = dimmed ? "0.4" : "";
}
