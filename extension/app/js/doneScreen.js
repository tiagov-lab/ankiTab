import ankiConnectInvoke from '../../libs/ankiConnect.js';
import {getSettings} from '../../libs/settings.js';
import {showToast} from './toast.js';

function el(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function startOfAnkiDay(now = new Date()) {
	const start = new Date(now);
	start.setHours(4, 0, 0, 0);
	if (now.getTime() < start.getTime()) start.setDate(start.getDate() - 1);
	return start.getTime();
}

function formatDuration(ms) {
	const minutes = Math.round(ms / 60000);
	if (minutes < 1) return 'less than a minute';
	if (minutes < 60) return minutes + 'm';
	return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
}

async function reviewedToday() {
	const count = Number(await ankiConnectInvoke('getNumCardsReviewedToday')) || 0;
	return count + ' card' + (count === 1 ? '' : 's') + ' reviewed today';
}

async function timeStudiedToday() {
	const cards = await ankiConnectInvoke('findCards', {query: 'rated:1'});
	if (!Array.isArray(cards) || cards.length > 2000) return null;
	if (!cards.length) return 'Time studied today: less than a minute';
	const reviews = await ankiConnectInvoke('getReviewsOfCards', {cards});
	const start = startOfAnkiDay();
	let total = 0;
	Object.values(reviews || {}).forEach((reviewList) => {
		(reviewList || []).forEach((review) => {
			if (review && Number(review.id) >= start) total += Number(review.time) || 0;
		});
	});
	return 'Time studied today: ' + formatDuration(total);
}

async function nextDueTomorrow() {
	const cards = await ankiConnectInvoke('findCards', {query: 'prop:due=1'});
	const count = Array.isArray(cards) ? cards.length : 0;
	return count + ' card' + (count === 1 ? '' : 's') + ' due tomorrow';
}

async function fillStats(container, settings) {
	const tasks = [];
	if (settings.doneShowStats) {
		tasks.push(
			reviewedToday().then((text) => el('div', 'stat-line', text)).catch(() => null),
			timeStudiedToday().then((text) => (text ? el('div', 'stat-line', text) : null)).catch(() => null)
		);
	}
	if (settings.doneShowNextDue) {
		tasks.push(nextDueTomorrow().then((text) => el('div', 'stat-line', text)).catch(() => null));
	}
	const lines = await Promise.all(tasks);
	lines.forEach((line) => {
		if (line) container.appendChild(line);
	});
}

function searchUrl(template, query) {
	const base = template && template.indexOf('%s') !== -1 ? template : 'https://duckduckgo.com/?q=%s';
	return base.split('%s').join(encodeURIComponent(query));
}

function addSearch(parent, settings) {
	const form = el('form', 'done-search');
	const input = el('input');
	input.type = 'search';
	input.placeholder = 'Search the web';
	input.autocomplete = 'off';
	const button = el('button', 'anki-btn', 'Search');
	button.type = 'submit';
	form.appendChild(input);
	form.appendChild(button);
	form.addEventListener('submit', (event) => {
		event.preventDefault();
		const query = input.value.trim();
		if (!query) return;
		location.href = searchUrl(settings.doneSearchUrl, query);
	});
	parent.appendChild(form);
}

function topSitesAvailable() {
	if (!chrome.permissions || !chrome.permissions.contains) return Promise.resolve(!!chrome.topSites);
	return new Promise((resolve) => {
		try {
			const maybePromise = chrome.permissions.contains({permissions: ['topSites']}, (granted) => {
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

function getTopSites() {
	return new Promise((resolve, reject) => {
		if (!chrome.topSites || !chrome.topSites.get) {
			reject(new Error('topSites is not available'));
			return;
		}
		try {
			const maybePromise = chrome.topSites.get((sites) => {
				if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
				else resolve(sites || []);
			});
			if (maybePromise && typeof maybePromise.then === 'function') maybePromise.then(resolve, reject);
		} catch (e) {
			reject(e);
		}
	});
}

function addTopSites(parent) {
	const grid = el('div', 'topsites');
	getTopSites().then((sites) => {
		sites.slice(0, 8).forEach((site) => {
			let host = '';
			try {
				host = new URL(site.url).hostname.replace(/^www\./, '');
			} catch (e) {
				host = site.title || '';
			}
			const link = el('a', 'topsite');
			link.href = site.url;
			const tile = el('span', 'tile', (host.charAt(0) || '?').toUpperCase());
			const name = el('span', 'site-name', host);
			link.appendChild(tile);
			link.appendChild(name);
			grid.appendChild(link);
		});
		if (!grid.children.length) grid.hidden = true;
	}).catch((e) => {
		console.warn('AnkiTab: could not load top sites', e);
		grid.hidden = true;
	});
	parent.appendChild(grid);
}

async function addFallback(parent, settings) {
	let mode = settings.doneFallback || 'search';
	const allowed = ['none', 'search', 'topsites', 'both'];
	if (allowed.indexOf(mode) === -1) mode = 'search';
	if (mode === 'none') return;

	let withTopSites = mode === 'topsites' || mode === 'both';
	if (withTopSites && !(await topSitesAvailable())) {
		withTopSites = false;
		if (mode === 'topsites') mode = 'search';
	}

	if (mode === 'search' || mode === 'both') addSearch(parent, settings);
	if (withTopSites) addTopSites(parent);
}

function batchHeading(batch) {
	if (batch.onBreak) return 'Break time';
	const count = Number(batch.count) || 0;
	return count + (count === 1 ? ' card done' : ' cards done');
}

function batchSub(batch) {
	if (!batch.onBreak) return 'The rest can wait.';
	const when = new Date(Number(batch.freeUntil) || Date.now());
	return 'Cards are back at ' + when.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

function addBatchContinue(parent, batch) {
	const button = el('button', 'anki-btn batch-continue', batch.onBreak ? 'Study anyway' : 'Keep studying');
	button.type = 'button';
	button.addEventListener('click', () => {
		if (typeof batch.onContinue === 'function') batch.onContinue();
	});
	parent.appendChild(button);
}

function addLinks(parent) {
	const links = el('div', 'done-links');
	const options = el('button', '', 'Options');
	options.type = 'button';
	options.addEventListener('click', () => {
		location.href = chrome.runtime.getURL('options/index.html');
	});
	const sync = el('button', '', 'Sync');
	sync.type = 'button';
	sync.addEventListener('click', async () => {
		try {
			await ankiConnectInvoke('sync');
			showToast('synced');
		} catch (e) {
			showToast('could not sync');
		}
	});
	links.appendChild(options);
	links.appendChild(sync);
	parent.appendChild(links);
}

export async function showDoneScreen(options = {}) {
	const blank = !!options.blank;
	const batch = options.batch;
	document.title = 'AnkiTab';

	const overlay = document.getElementById('overlay');
	const settings = await getSettings();

	const inner = el('div', 'overlay-inner done-inner');

	if (!blank && batch) {
		inner.appendChild(el('h1', '', batchHeading(batch)));
		inner.appendChild(el('p', 'batch-sub', batchSub(batch)));
		addBatchContinue(inner, batch);
		const stats = document.createElement('div');
		stats.className = 'done-stats';
		inner.appendChild(stats);
		fillStats(stats, settings);
		addLinks(inner);
	} else if (!blank) {
		inner.appendChild(el('h1', '', 'Congratulations! You have finished for now.'));
		const stats = document.createElement('div');
		stats.className = 'done-stats';
		inner.appendChild(stats);
		fillStats(stats, settings);
		addLinks(inner);
	}

	await addFallback(inner, settings);

	overlay.replaceChildren(inner);
	overlay.hidden = false;
	const search = overlay.querySelector('.done-search input');
	if (search) setTimeout(() => search.focus(), 0);
}
