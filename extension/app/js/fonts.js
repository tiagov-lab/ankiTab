import ankiConnectInvoke from "../../libs/ankiConnect.js";
import {isRemoteUrl, mediaFilename} from "../../libs/url.js";
import {base64ToBuffer} from "./media.js";
import {frameReady, postToSandbox} from "./sandboxFrame.js";

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

// Resolves once the font has been posted (or failed); the sandbox itself waits
// for the face to finish loading before it shows a card that uses it.
export function sendFontToSandbox(face) {
	const key = [face.family, face.filename, face.descriptors.weight || "", face.descriptors.style || ""].join("|");
	if (sentFonts.has(key)) return sentFonts.get(key);
	const promise = ankiConnectInvoke("retrieveMediaFile", {filename: face.filename}).then(async (data) => {
		if (!data) throw new Error("no media data");
		const buffer = base64ToBuffer(data);
		await frameReady;
		const posted = postToSandbox(
			{command: "font", key, family: face.family, descriptors: face.descriptors, data: buffer},
			[buffer]
		);
		if (!posted) throw new Error("no sandbox");
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
