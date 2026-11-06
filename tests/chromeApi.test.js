import {describe, it, expect, vi} from 'vitest';
import {
	callChrome,
	storageGet,
	storageSet,
	permissionsContains,
	permissionsRequest,
	getTopSites,
} from '../extension/libs/chromeApi.js';

describe('callChrome', () => {
	it('resolves the value the callback receives', async () => {
		const fn = (value, callback) => callback(value);
		await expect(callChrome(fn, 3)).resolves.toBe(3);
	});

	it('resolves the result of a promise-returning api', async () => {
		await expect(callChrome(() => Promise.resolve('ok'))).resolves.toBe('ok');
	});

	it('rejects when the api throws synchronously', async () => {
		const boom = new Error('boom');
		await expect(
			callChrome(() => {
				throw boom;
			})
		).rejects.toBe(boom);
	});

	it('rejects with chrome.runtime.lastError', async () => {
		const fn = (callback) => {
			chrome.runtime.lastError = {message: 'nope'};
			callback();
			chrome.runtime.lastError = undefined;
		};
		await expect(callChrome(fn)).rejects.toThrow('nope');
	});

	it('passes the extra arguments through', async () => {
		const fn = vi.fn((a, b, callback) => callback(a + b));
		await expect(callChrome(fn, 1, 2)).resolves.toBe(3);
		expect(fn).toHaveBeenCalledWith(1, 2, expect.any(Function));
	});
});

describe('storageGet/storageSet', () => {
	it('reads the requested keys from chrome.storage.local', async () => {
		chrome.__store.a = 1;
		chrome.__store.b = 2;
		await expect(storageGet(['a', 'b'])).resolves.toEqual({a: 1, b: 2});
	});

	it('writes values to chrome.storage.local', async () => {
		await storageSet({a: 1});
		expect(chrome.__store.a).toBe(1);
	});
});

describe('permissionsContains', () => {
	it('resolves the granted value', async () => {
		chrome.__permissionContains = true;
		await expect(permissionsContains({permissions: ['topSites']}, false)).resolves.toBe(true);
		chrome.__permissionContains = false;
		await expect(permissionsContains({permissions: ['topSites']}, true)).resolves.toBe(false);
	});

	it('supports a promise-returning permissions api', async () => {
		chrome.permissions.contains = () => Promise.resolve(true);
		await expect(permissionsContains({}, false)).resolves.toBe(true);
	});

	it('resolves the fallback when the api is missing', async () => {
		delete chrome.permissions;
		await expect(permissionsContains({}, true)).resolves.toBe(true);
	});

	it('resolves the fallback when contains is missing', async () => {
		chrome.permissions = {};
		await expect(permissionsContains({}, false)).resolves.toBe(false);
	});

	it('resolves the fallback when the api throws', async () => {
		chrome.permissions.contains = () => {
			throw new Error('boom');
		};
		await expect(permissionsContains({}, true)).resolves.toBe(true);
	});

	it('resolves the fallback when the promise rejects', async () => {
		chrome.permissions.contains = () => Promise.reject(new Error('nope'));
		await expect(permissionsContains({}, false)).resolves.toBe(false);
	});

	it('uses a separate error fallback when the api exists but fails', async () => {
		chrome.permissions.contains = () => {
			throw new Error('boom');
		};
		await expect(permissionsContains({}, 'missing', 'error')).resolves.toBe('error');
		delete chrome.permissions;
		await expect(permissionsContains({}, 'missing', 'error')).resolves.toBe('missing');
	});
});

describe('permissionsRequest', () => {
	it('resolves the granted value', async () => {
		chrome.__permissionRequest = true;
		await expect(permissionsRequest({permissions: ['topSites']})).resolves.toBe(true);
		chrome.__permissionRequest = false;
		await expect(permissionsRequest({permissions: ['topSites']})).resolves.toBe(false);
	});

	it('supports a promise-returning permissions api', async () => {
		chrome.permissions.request = () => Promise.resolve(true);
		await expect(permissionsRequest({})).resolves.toBe(true);
	});

	it('resolves false when the api is missing', async () => {
		delete chrome.permissions;
		await expect(permissionsRequest({})).resolves.toBe(false);
	});

	it('resolves false when request is missing', async () => {
		chrome.permissions = {};
		await expect(permissionsRequest({})).resolves.toBe(false);
	});

	it('resolves false when the api throws', async () => {
		chrome.permissions.request = () => {
			throw new Error('boom');
		};
		await expect(permissionsRequest({})).resolves.toBe(false);
	});

	it('resolves false when the promise rejects', async () => {
		chrome.permissions.request = () => Promise.reject(new Error('nope'));
		await expect(permissionsRequest({})).resolves.toBe(false);
	});
});

describe('getTopSites', () => {
	it('resolves the top sites', async () => {
		chrome.__topSites = [{url: 'https://example.com/', title: 'Example'}];
		await expect(getTopSites()).resolves.toEqual([{url: 'https://example.com/', title: 'Example'}]);
	});

	it('supports a promise-returning topSites api', async () => {
		chrome.topSites.get = () => Promise.resolve([{url: 'https://example.com/'}]);
		await expect(getTopSites()).resolves.toEqual([{url: 'https://example.com/'}]);
	});

	it('rejects when the api is missing', async () => {
		delete chrome.topSites;
		await expect(getTopSites()).rejects.toThrow('topSites is not available');
	});

	it('rejects when get is missing', async () => {
		chrome.topSites = {};
		await expect(getTopSites()).rejects.toThrow('topSites is not available');
	});

	it('rejects with the lastError message', async () => {
		chrome.__topSitesError = 'no top sites';
		await expect(getTopSites()).rejects.toThrow('no top sites');
	});

	it('rejects when the api throws', async () => {
		chrome.topSites.get = () => {
			throw new Error('boom');
		};
		await expect(getTopSites()).rejects.toThrow('boom');
	});
});
