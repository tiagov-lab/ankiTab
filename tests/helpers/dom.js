import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../..');

function readPage(relativePath) {
	const full = path.join(repoRoot, relativePath);
	const html = fs.readFileSync(full, 'utf8');
	// Scripts would try to load module files a second time; the tests import the
	// modules themselves. Everything else (head, base, body) is kept so that the
	// page behaves like the real extension page.
	return html
		.replace(/<!doctype[^>]*>/i, '')
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

function loadPage(relativePath) {
	document.documentElement.innerHTML = readPage(relativePath);
}

// Replace the whole document (head + body) with the extension page, minus scripts.
export function loadAppPage() {
	loadPage('extension/app/index.html');
}

export function loadOptionsPage() {
	loadPage('extension/options/index.html');
}

// Backwards-compatible name used by the tests: injects the body of the app page.
export function loadAppHtml() {
	loadAppPage();
}

export function loadOptionsHtml() {
	loadOptionsPage();
}

// jsdom's Location cannot navigate; tests that assert on navigation replace it
// with a plain object. `search` is kept so modules that read location.search on
// import behave predictably.
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');

export function stubLocation(search = '') {
	const fake = {
		href: 'moz-extension://test/app/index.html' + search,
		search,
		hash: '',
		origin: 'moz-extension://test',
		pathname: '/app/index.html',
		toString() {
			return this.href;
		},
	};
	Object.defineProperty(globalThis, 'location', {
		configurable: true,
		writable: true,
		value: fake,
	});
	return fake;
}

export function restoreLocation() {
	if (originalLocationDescriptor) {
		Object.defineProperty(globalThis, 'location', originalLocationDescriptor);
	} else {
		delete globalThis.location;
	}
}

export function flushMicrotasks() {
	return Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());
}

export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
