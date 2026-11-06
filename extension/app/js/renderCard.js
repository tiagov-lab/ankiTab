import {prepareCardCss} from "./fonts.js";
import {buildCardHTML, inlineMediaScripts, resolveMedia} from "./media.js";
import {frameReady, postTheme, postToSandbox, setDimmed} from "./sandboxFrame.js";

let renderSeq = 0;

// Posts one side of a card to the sandbox once its fonts and media are in place.
// A render that is overtaken while waiting (e.g. the answer started) gives up.
export async function renderInSandbox(card, content, {answer = false, autoFlip = false} = {}) {
	if (!card) return;
	const seq = ++renderSeq;
	const prepared = prepareCardCss(card.css);
	const html = await resolveMedia(await inlineMediaScripts(buildCardHTML(prepared.css, content)));
	await prepared.fonts;
	await frameReady;
	if (seq !== renderSeq) return; // a newer render (e.g. the answer) started meanwhile
	postTheme();
	const posted = postToSandbox({
		command: "render",
		html,
		answer: !!answer,
		autoFlip: !!autoFlip && !answer,
	});
	if (posted) setDimmed(false);
}

// Warms the media cache with the back side, so flipping does not wait for it.
export function prefetchAnswer(card) {
	if (!card) return;
	try {
		resolveMedia(buildCardHTML(prepareCardCss(card.css).css, card.answer)).catch(() => {});
	} catch (e) {
		// Prefetch is best effort; the answer render resolves its media itself.
	}
}
