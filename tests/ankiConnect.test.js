import {describe, it, expect, vi, beforeEach} from 'vitest';
import ankiConnectInvoke, {ping, requestPermission, HOST_PERMISSIONS} from '../extension/libs/ankiConnect.js';

class FakeXHR {
	constructor() {
		this.listeners = {};
		FakeXHR.instances.push(this);
	}
	addEventListener(type, listener) {
		(this.listeners[type] = this.listeners[type] || []).push(listener);
	}
	open(method, url) {
		this.method = method;
		this.url = url;
	}
	send(body) {
		this.body = body;
	}
	fire(type) {
		(this.listeners[type] || []).forEach((listener) => listener());
	}
	respondWith(payload) {
		this.responseText = typeof payload === 'string' ? payload : JSON.stringify(payload);
		this.fire('load');
	}
}

beforeEach(() => {
	FakeXHR.instances = [];
	globalThis.XMLHttpRequest = FakeXHR;
});

describe('ankiConnectInvoke', () => {
	it('posts {action, version, params} to 127.0.0.1:8765 with a 5s timeout', () => {
		const promise = ankiConnectInvoke('deckNames', {foo: 1});
		const xhr = FakeXHR.instances[0];
		expect(xhr.method).toBe('POST');
		expect(xhr.url).toBe('http://127.0.0.1:8765');
		expect(xhr.timeout).toBe(5000);
		expect(JSON.parse(xhr.body)).toEqual({action: 'deckNames', version: 6, params: {foo: 1}});
		xhr.respondWith({result: 'ok'});
		return expect(promise).resolves.toBe('ok');
	});

	it('defaults params to an empty object', () => {
		ankiConnectInvoke('version');
		const xhr = FakeXHR.instances[0];
		expect(JSON.parse(xhr.body)).toEqual({action: 'version', version: 6, params: {}});
	});

	it('resolves with the raw result, even for null', async () => {
		const promise = ankiConnectInvoke('x');
		FakeXHR.instances[0].respondWith({result: null});
		await expect(promise).resolves.toBeNull();
	});

	it('turns {error} into an anki error', async () => {
		const promise = ankiConnectInvoke('x');
		FakeXHR.instances[0].respondWith({error: 'something broke'});
		await expect(promise).rejects.toEqual({type: 'anki', message: 'something broke'});
	});

	it('stringifies non-string errors', async () => {
		const promise = ankiConnectInvoke('x');
		FakeXHR.instances[0].respondWith({error: 42});
		await expect(promise).rejects.toEqual({type: 'anki', message: '42'});
	});

	it('rejects invalid json as an anki error', async () => {
		const promise = ankiConnectInvoke('x');
		FakeXHR.instances[0].respondWith('not json');
		await expect(promise).rejects.toEqual({type: 'anki', message: 'invalid response from AnkiConnect'});
	});

	it('rejects non-object payloads as an anki error', async () => {
		const promise = ankiConnectInvoke('x');
		FakeXHR.instances[0].respondWith('null');
		await expect(promise).rejects.toEqual({type: 'anki', message: 'invalid response from AnkiConnect'});
	});

	it('rejects a payload without result as an anki error', async () => {
		const promise = ankiConnectInvoke('x');
		FakeXHR.instances[0].respondWith({error: null});
		await expect(promise).rejects.toEqual({type: 'anki', message: 'missing result from AnkiConnect'});
	});

	it('reports offline on a network error when permission is granted', async () => {
		chrome.__permissionContains = true;
		const promise = ankiConnectInvoke('x');
		FakeXHR.instances[0].fire('error');
		await expect(promise).rejects.toEqual({type: 'offline'});
	});

	it('reports a permission error on a network error when permission is missing', async () => {
		chrome.__permissionContains = false;
		const promise = ankiConnectInvoke('x');
		FakeXHR.instances[0].fire('error');
		await expect(promise).rejects.toEqual({type: 'permission'});
	});

	it('reports offline on a timeout', async () => {
		const promise = ankiConnectInvoke('x');
		FakeXHR.instances[0].fire('timeout');
		await expect(promise).rejects.toEqual({type: 'offline'});
	});

	it('supports a promise-returning permissions api', async () => {
		chrome.permissions.contains = () => Promise.resolve(false);
		const promise = ankiConnectInvoke('x');
		FakeXHR.instances[0].fire('error');
		await expect(promise).rejects.toEqual({type: 'permission'});
	});

	it('treats a rejecting permission promise as granted', async () => {
		chrome.permissions.contains = () => Promise.reject(new Error('nope'));
		const promise = ankiConnectInvoke('x');
		FakeXHR.instances[0].fire('error');
		await expect(promise).rejects.toEqual({type: 'offline'});
	});

	it('treats a throwing permissions api as granted', async () => {
		chrome.permissions.contains = () => {
			throw new Error('nope');
		};
		const promise = ankiConnectInvoke('x');
		FakeXHR.instances[0].fire('error');
		await expect(promise).rejects.toEqual({type: 'offline'});
	});

	it('reports offline when the permissions api is missing', async () => {
		delete chrome.permissions;
		const promise = ankiConnectInvoke('x');
		FakeXHR.instances[0].fire('error');
		await expect(promise).rejects.toEqual({type: 'offline'});
	});

	it('settles only once when several events fire', async () => {
		const promise = ankiConnectInvoke('x');
		const xhr = FakeXHR.instances[0];
		const onResolve = vi.fn();
		const onReject = vi.fn();
		promise.then(onResolve, onReject);
		xhr.respondWith({result: 1});
		xhr.fire('error');
		xhr.fire('timeout');
		xhr.respondWith({result: 2});
		await promise;
		expect(onResolve).toHaveBeenCalledTimes(1);
		expect(onResolve).toHaveBeenCalledWith(1);
		expect(onReject).not.toHaveBeenCalled();
	});
});

describe('ping', () => {
	it('invokes the version action', async () => {
		const promise = ping();
		const xhr = FakeXHR.instances[0];
		expect(JSON.parse(xhr.body).action).toBe('version');
		xhr.respondWith({result: 6});
		await expect(promise).resolves.toBe(6);
	});
});

describe('requestPermission', () => {
	it('resolves true when the browser grants the permission', async () => {
		chrome.__permissionRequest = true;
		await expect(requestPermission()).resolves.toBe(true);
	});

	it('resolves false when the browser denies the permission', async () => {
		chrome.__permissionRequest = false;
		await expect(requestPermission()).resolves.toBe(false);
	});

	it('asks for the host permissions', async () => {
		const request = vi.fn((permissions, callback) => callback(true));
		chrome.permissions.request = request;
		await requestPermission();
		expect(request).toHaveBeenCalledWith(HOST_PERMISSIONS, expect.any(Function));
	});

	it('resolves false when the permissions api is missing', async () => {
		delete chrome.permissions;
		await expect(requestPermission()).resolves.toBe(false);
	});

	it('resolves false when the permissions api is missing request()', async () => {
		chrome.permissions = {};
		await expect(requestPermission()).resolves.toBe(false);
	});

	it('resolves false when request() throws', async () => {
		chrome.permissions.request = () => {
			throw new Error('nope');
		};
		await expect(requestPermission()).resolves.toBe(false);
	});

	it('supports a promise-returning permissions api', async () => {
		chrome.permissions.request = () => Promise.resolve(true);
		await expect(requestPermission()).resolves.toBe(true);
	});
});
