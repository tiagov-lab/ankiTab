// Fresh `chrome` fake for every test, plus jsdom globals reset.
import {beforeEach, vi} from 'vitest';

function makeChrome() {
	const listeners = new Set();
	const store = {};

	function fireChanges(changes) {
		if (!Object.keys(changes).length) return;
		listeners.forEach((listener) => listener(changes, 'local'));
	}

	function get(keys, callback) {
		const result = {};
		if (keys === null || keys === undefined) {
			Object.assign(result, store);
		} else if (typeof keys === 'string') {
			if (keys in store) result[keys] = store[keys];
		} else if (Array.isArray(keys)) {
			for (const key of keys) {
				if (key in store) result[key] = store[key];
			}
		} else if (typeof keys === 'object') {
			for (const key of Object.keys(keys)) {
				result[key] = key in store ? store[key] : keys[key];
			}
		}
		if (callback) callback(result);
	}

	function set(values, callback) {
		const changes = {};
		for (const key of Object.keys(values)) {
			const oldValue = store[key];
			store[key] = values[key];
			if (oldValue !== values[key]) changes[key] = {oldValue, newValue: values[key]};
		}
		if (callback) callback();
		fireChanges(changes);
	}

	function remove(keys, callback) {
		const list = Array.isArray(keys) ? keys : [keys];
		const changes = {};
		for (const key of list) {
			if (key in store) {
				changes[key] = {oldValue: store[key]};
				delete store[key];
			}
		}
		if (callback) callback();
		fireChanges(changes);
	}

	function clear(callback) {
		remove(Object.keys(store), callback);
	}

	const chrome = {
		__store: store,
		__changesListeners: listeners,
		__permissionContains: true,
		__permissionRequest: true,
		__topSites: [],
		__topSitesError: undefined,
		__tabsCreated: [],
		__onInstalled: [],
		__actionClicks: [],
		storage: {
			local: {get, set, remove, clear},
			onChanged: {
				addListener: (listener) => listeners.add(listener),
				removeListener: (listener) => listeners.delete(listener),
			},
		},
		runtime: {
			getURL: (path) => 'moz-extension://test/' + path,
			lastError: undefined,
			onInstalled: {
				addListener: (listener) => chrome.__onInstalled.push(listener),
			},
		},
		permissions: {
			contains: (permissions, callback) => {
				if (callback) callback(chrome.__permissionContains);
			},
			request: (permissions, callback) => {
				if (callback) callback(chrome.__permissionRequest);
			},
		},
		topSites: {
			get: (callback) => {
				const error = chrome.__topSitesError;
				chrome.runtime.lastError = error ? {message: error} : undefined;
				try {
					if (callback) callback(error ? [] : chrome.__topSites);
				} finally {
					chrome.runtime.lastError = undefined;
				}
			},
		},
		tabs: {
			create: (options) => {
				chrome.__tabsCreated.push(options);
			},
		},
		action: {
			onClicked: {
				addListener: (listener) => chrome.__actionClicks.push(listener),
			},
		},
	};

	chrome.__reset = () => {
		for (const key of Object.keys(store)) delete store[key];
		listeners.clear();
		chrome.__permissionContains = true;
		chrome.__permissionRequest = true;
		chrome.__topSites = [];
		chrome.__topSitesError = undefined;
		chrome.__tabsCreated.length = 0;
		chrome.__onInstalled.length = 0;
		chrome.__actionClicks.length = 0;
	};

	return chrome;
}

const originalLocationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');

// Track event listeners so every test starts with a clean document/window even
// though jsdom keeps the same globals for the whole file.
const trackedListeners = [];
const originalAddEventListener = EventTarget.prototype.addEventListener;
const originalRemoveEventListener = EventTarget.prototype.removeEventListener;
let windowRemoveRaw = null;

function trackListener(target, type, listener, options) {
	if (listener) trackedListeners.push({target, type, listener, options});
}

function forgetListener(target, type, listener) {
	for (let index = trackedListeners.length - 1; index >= 0; index--) {
		const tracked = trackedListeners[index];
		if (tracked.target === target && tracked.type === type && tracked.listener === listener) {
			trackedListeners.splice(index, 1);
			break;
		}
	}
}

if (!globalThis.__ankitabListenerPatch) {
	globalThis.__ankitabListenerPatch = true;
	EventTarget.prototype.addEventListener = function (type, listener, options) {
		trackListener(this, type, listener, options);
		return originalAddEventListener.call(this, type, listener, options);
	};
	EventTarget.prototype.removeEventListener = function (type, listener, options) {
		forgetListener(this, type, listener);
		return originalRemoveEventListener.call(this, type, listener, options);
	};

	// jsdom exposes window.addEventListener as an own property, shadowing the
	// EventTarget.prototype patch above.
	const windowAdd = window.addEventListener;
	const windowRemove = window.removeEventListener;
	window.addEventListener = function (type, listener, options) {
		trackListener(window, type, listener, options);
		return windowAdd.call(window, type, listener, options);
	};
	window.removeEventListener = function (type, listener, options) {
		forgetListener(window, type, listener);
		return windowRemove.call(window, type, listener, options);
	};
	windowRemoveRaw = windowRemove;
}

function removeTrackedListeners() {
	while (trackedListeners.length) {
		const {target, type, listener, options} = trackedListeners.pop();
		if (target === window && windowRemoveRaw) {
			windowRemoveRaw.call(window, type, listener, options);
		} else {
			originalRemoveEventListener.call(target, type, listener, options);
		}
	}
}

beforeEach(() => {
	removeTrackedListeners();
	globalThis.chrome = makeChrome();
	if (originalLocationDescriptor) {
		Object.defineProperty(globalThis, 'location', originalLocationDescriptor);
	}
	document.body.innerHTML = '';
	document.title = '';
	document.documentElement.className = '';
	document.body.className = '';
	delete window.ankitabTheme;
	window.onbeforeunload = null;
	window.onload = null;
	try {
		localStorage.clear();
	} catch (e) {
		// ignore
	}
});

// Exposed so tests can build a chrome fake outside the beforeEach if needed.
export {makeChrome};
export const viGlobal = vi;
