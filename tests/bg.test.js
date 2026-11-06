import {describe, it, expect} from 'vitest';
import {loadClassicScript} from './helpers/classic.js';
import {DEFAULT_SETTINGS} from '../extension/libs/settings.js';

function loadBg() {
	return loadClassicScript('extension/bg.js', ['defaults', 'actionApi']);
}

describe('bg.js', () => {
	it('opens a new tab when the toolbar icon is clicked', () => {
		loadBg();
		expect(chrome.__actionClicks.length).toBe(1);
		chrome.__actionClicks[0]();
		expect(chrome.__tabsCreated).toEqual([{}]);
	});

	it('writes only the missing defaults on install', () => {
		chrome.__store.batchSize = 7;
		chrome.__store.lastDeck = 'Deck X';
		loadBg();
		chrome.__onInstalled[0]();
		expect(chrome.__store.batchSize).toBe(7);
		expect(chrome.__store.lastDeck).toBe('Deck X');
		expect(chrome.__store.doneFallback).toBe('search');
		expect(chrome.__store.doneShowStats).toBe(true);
		expect(chrome.__store.emptyDecks).toEqual([]);
	});

	it('keeps the duplicated defaults in sync with DEFAULT_SETTINGS', () => {
		const {defaults} = loadBg();
		expect(Object.keys(defaults).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
		expect(Object.values(defaults)).toEqual(Object.values(DEFAULT_SETTINGS));
		expect(defaults).toEqual(DEFAULT_SETTINGS);
	});

	it('falls back to browserAction on MV2 manifests', () => {
		const clicks = [];
		chrome.browserAction = {onClicked: {addListener: (listener) => clicks.push(listener)}};
		delete chrome.action;
		loadBg();
		expect(clicks.length).toBe(1);
	});
});
