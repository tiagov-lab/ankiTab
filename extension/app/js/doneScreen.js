import ankiConnectInvoke from '../../libs/ankiConnect.js';
import {el, showOverlay} from '../../libs/dom.js';
import {getSettings} from '../../libs/settings.js';
import {buildFallback} from './done/fallback.js';
import {buildStats} from './done/stats.js';
import {showToast} from './toast.js';

export function batchHeading(batch) {
	if (batch.onBreak) return 'Break time';
	const count = Number(batch.count) || 0;
	return count + (count === 1 ? ' card done' : ' cards done');
}

export function batchSub(batch) {
	if (!batch.onBreak) return 'The rest can wait.';
	const when = new Date(Number(batch.freeUntil) || Date.now());
	return 'Cards are back at ' + when.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

function batchHeader(batch) {
	const button = el('button', 'anki-btn batch-continue', batch.onBreak ? 'Study anyway' : 'Keep studying');
	button.type = 'button';
	button.addEventListener('click', () => {
		if (typeof batch.onContinue === 'function') batch.onContinue();
	});
	return [el('h1', '', batchHeading(batch)), el('p', 'batch-sub', batchSub(batch)), button];
}

function buildHeader({blank, batch}) {
	if (blank) return [];
	if (batch) return batchHeader(batch);
	return [el('h1', '', 'Congratulations! You have finished for now.')];
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
	const blank = Boolean(options.blank);
	document.title = 'AnkiTab';
	const settings = await getSettings();

	const inner = el('div', 'overlay-inner done-inner');
	buildHeader({blank, batch: options.batch}).forEach((node) => inner.appendChild(node));
	if (!blank) {
		inner.appendChild(buildStats(settings));
		addLinks(inner);
	}
	const fallback = await buildFallback(settings);
	if (fallback) inner.appendChild(fallback);

	showOverlay(inner);
	const search = document.querySelector('#overlay .done-search input');
	if (search) setTimeout(() => search.focus(), 0);
}
