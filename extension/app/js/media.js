import MIME from "./mimeTypes.js";
import ankiConnectInvoke from "../../libs/ankiConnect.js";
import {isRemoteUrl, mediaFilename} from "../../libs/url.js";

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

export function base64ToBuffer(base64) {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
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
