import {ping, requestPermission} from '../../libs/ankiConnect.js';

let pollTimer = null;
let onVisibility = null;
let retryCallback = null;
let pollInFlight = false;

function el(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function blankLink() {
	const link = el('a', '', 'Open a blank tab');
	link.href = chrome.runtime.getURL('app/index.html') + '?blank=1';
	return link;
}

function stopPolling() {
	if (pollTimer) window.clearInterval(pollTimer);
	pollTimer = null;
	if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
	onVisibility = null;
}

export function hideOffline() {
	stopPolling();
	retryCallback = null;
	const overlay = document.getElementById('overlay');
	if (overlay) {
		overlay.hidden = true;
		overlay.replaceChildren();
	}
}

function startPolling() {
	stopPolling();
	const tick = async () => {
		if (document.visibilityState !== 'visible') return;
		if (pollInFlight) return;
		pollInFlight = true;
		try {
			await ping();
			const retry = retryCallback;
			hideOffline();
			if (retry) retry();
		} catch (e) {
			// anki is still closed; keep waiting
		} finally {
			pollInFlight = false;
		}
	};
	onVisibility = () => {
		if (document.visibilityState === 'visible') tick();
	};
	document.addEventListener('visibilitychange', onVisibility);
	pollTimer = window.setInterval(tick, 3000);
}

export function showOffline(options = {}) {
	const overlay = document.getElementById('overlay');
	if (!overlay) return;
	document.title = 'AnkiTab';
	const permission = !!options.permission;
	retryCallback = typeof options.onRetry === 'function' ? options.onRetry : null;
	stopPolling();

	const inner = el('div', 'overlay-inner');
	inner.appendChild(el('h1', '', permission ? 'Allow access to Anki' : "Anki isn't running"));

	if (permission) {
		inner.appendChild(el('p', '', 'AnkiTab needs permission to talk to AnkiConnect on 127.0.0.1:8765.'));
		const actions = el('div', 'offline-actions');
		const grant = el('button', 'anki-btn', 'Grant permission');
		grant.type = 'button';
		grant.addEventListener('click', async () => {
			grant.disabled = true;
			try {
				const granted = await requestPermission();
				if (granted) {
					const retry = retryCallback;
					hideOffline();
					if (retry) retry();
				} else {
					grant.disabled = false;
				}
			} catch (e) {
				grant.disabled = false;
			}
		});
		actions.appendChild(grant);
		actions.appendChild(blankLink());
		inner.appendChild(actions);
	} else {
		inner.appendChild(el('p', '', 'start anki with the AnkiConnect add-on. this page will continue as soon as it can connect.'));

		const retrying = el('div', 'offline-retrying');
		retrying.appendChild(el('span', 'spinner'));
		retrying.appendChild(el('span', '', 'retrying…'));
		inner.appendChild(retrying);

		const actions = el('div', 'offline-actions');
		const retry = el('button', 'anki-btn', 'Retry now');
		retry.type = 'button';
		retry.addEventListener('click', async () => {
			try {
				await ping();
				const callback = retryCallback;
				hideOffline();
				if (callback) callback();
			} catch (e) {
				// stay on the offline screen
			}
		});
		actions.appendChild(retry);
		actions.appendChild(blankLink());
		inner.appendChild(actions);
	}

	overlay.replaceChildren(inner);
	overlay.hidden = false;
	if (!permission) startPolling();
}
