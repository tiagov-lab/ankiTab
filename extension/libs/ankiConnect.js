// AnkiConnect client. Errors are plain objects with a `type` field so callers can
// decide what to show: 'offline' (anki/AnkiConnect is not reachable), 'permission'
// (the extension is not allowed to talk to 127.0.0.1) and 'anki' (AnkiConnect
// answered with an error).
const ANKI_CONNECT_URL = 'http://127.0.0.1:8765';
const REQUEST_TIMEOUT_MS = 5000;

export const HOST_PERMISSIONS = {origins: ['http://127.0.0.1:8765/*', 'http://localhost:8765/*']};

function error(type, message) {
	const e = {type};
	if (message !== undefined) e.message = message;
	return e;
}

function permissionsContains(permissions) {
	return new Promise((resolve) => {
		if (!chrome.permissions || !chrome.permissions.contains) {
			resolve(true);
			return;
		}
		try {
			const maybePromise = chrome.permissions.contains(permissions, (granted) => {
				void chrome.runtime.lastError;
				resolve(!!granted);
			});
			if (maybePromise && typeof maybePromise.then === 'function') {
				maybePromise.then((granted) => resolve(!!granted), () => resolve(true));
			}
		} catch (e) {
			resolve(true);
		}
	});
}

async function hasHostPermission() {
	return permissionsContains(HOST_PERMISSIONS);
}

async function networkError() {
	if (await hasHostPermission()) return error('offline');
	return error('permission');
}

function ankiConnectInvoke(action, params = {}) {
	const version = 6;
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		let settled = false;
		const settle = (fn, value) => {
			if (settled) return;
			settled = true;
			fn(value);
		};

		xhr.addEventListener('error', () => {
			networkError().then((e) => settle(reject, e));
		});
		xhr.addEventListener('timeout', () => {
			networkError().then((e) => settle(reject, e));
		});
		xhr.addEventListener('load', () => {
			let payload;
			try {
				payload = JSON.parse(xhr.responseText);
			} catch (e) {
				settle(reject, error('anki', 'invalid response from AnkiConnect'));
				return;
			}
			if (!payload || typeof payload !== 'object') {
				settle(reject, error('anki', 'invalid response from AnkiConnect'));
				return;
			}
			if (payload.error) {
				settle(reject, error('anki', String(payload.error)));
				return;
			}
			if (!Object.prototype.hasOwnProperty.call(payload, 'result')) {
				settle(reject, error('anki', 'missing result from AnkiConnect'));
				return;
			}
			resolve(payload.result);
		});
		xhr.open('POST', ANKI_CONNECT_URL);
		xhr.timeout = REQUEST_TIMEOUT_MS;
		xhr.send(JSON.stringify({ action, version, params }));
	});
}

// Cheap connectivity check used to poll while the "not running" screen is shown.
export function ping() {
	return ankiConnectInvoke('version');
}

// Ask the browser for access to the local AnkiConnect server.
export function requestPermission() {
	return new Promise((resolve) => {
		if (!chrome.permissions || !chrome.permissions.request) {
			resolve(false);
			return;
		}
		try {
			const maybePromise = chrome.permissions.request(HOST_PERMISSIONS, (granted) => {
				void chrome.runtime.lastError;
				resolve(!!granted);
			});
			if (maybePromise && typeof maybePromise.then === 'function') {
				maybePromise.then((granted) => resolve(!!granted), () => resolve(false));
			}
		} catch (e) {
			resolve(false);
		}
	});
}

export default ankiConnectInvoke;
