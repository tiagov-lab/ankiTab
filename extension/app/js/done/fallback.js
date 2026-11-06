import {getTopSites, permissionsContains} from '../../../libs/chromeApi.js';
import {el} from '../../../libs/dom.js';

const MODES = ['none', 'search', 'topsites', 'both'];

function usesTopSites(mode) {
	return mode === 'topsites' || mode === 'both';
}

function canUseTopSites() {
	return permissionsContains({permissions: ['topSites']}, !!chrome.topSites, false);
}

export function searchUrl(template, query) {
	const base = template && template.indexOf('%s') !== -1 ? template : 'https://duckduckgo.com/?q=%s';
	return base.split('%s').join(encodeURIComponent(query));
}

export function resolveFallbackMode(mode, topSitesAllowed) {
	const requested = MODES.indexOf(mode) === -1 ? 'search' : mode;
	return usesTopSites(requested) && !topSitesAllowed ? 'search' : requested;
}

export function buildSearch(settings) {
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
	return form;
}

function siteName(site) {
	try {
		return new URL(site.url).hostname.replace(/^www\./, '');
	} catch (e) {
		return site.title || '';
	}
}

export function buildTopSites() {
	const grid = el('div', 'topsites');
	getTopSites().then((sites) => {
		sites.slice(0, 8).forEach((site) => {
			const host = siteName(site);
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
	return grid;
}

export async function buildFallback(settings) {
	const requested = settings.doneFallback || 'search';
	const allowed = usesTopSites(requested) ? await canUseTopSites() : false;
	const mode = resolveFallbackMode(requested, allowed);
	if (mode === 'none') return null;
	const fragment = document.createDocumentFragment();
	if (mode === 'search' || mode === 'both') fragment.appendChild(buildSearch(settings));
	if (usesTopSites(mode)) fragment.appendChild(buildTopSites());
	return fragment;
}
