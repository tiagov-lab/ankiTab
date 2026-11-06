import {describe, it, expect} from 'vitest';
import {DEFAULT_SETTINGS, getSettings, setSettings} from '../extension/libs/settings.js';

describe('getSettings', () => {
	it('returns every default when nothing is stored', async () => {
		await expect(getSettings()).resolves.toEqual(DEFAULT_SETTINGS);
	});

	it('lets stored values win over the defaults', async () => {
		chrome.__store.batchSize = 12;
		chrome.__store.doneFallback = 'none';
		const settings = await getSettings();
		expect(settings.batchSize).toBe(12);
		expect(settings.doneFallback).toBe('none');
		expect(settings.showDueCounts).toBe(true);
		expect(Object.keys(settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
	});
});

describe('setSettings', () => {
	it('writes the given keys to storage', async () => {
		await setSettings({showDueCounts: false, batchSize: 3});
		expect(chrome.__store.showDueCounts).toBe(false);
		expect(chrome.__store.batchSize).toBe(3);
	});

	it('leaves other stored keys alone', async () => {
		chrome.__store.lastDeck = 'Deck A';
		await setSettings({batchSize: 1});
		expect(chrome.__store.lastDeck).toBe('Deck A');
	});
});
