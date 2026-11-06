import {vi} from 'vitest';

// Returns a vi.fn(action, params) that resolves handlers[action](params) or
// rejects with an AnkiConnect-style error.
export function mockAnki(handlers = {}) {
	return vi.fn((action, params) => {
		const handler = handlers[action];
		if (typeof handler !== 'function') {
			return Promise.reject({type: 'anki', message: 'unknown action'});
		}
		try {
			return Promise.resolve(handler(params));
		} catch (e) {
			return Promise.reject(e);
		}
	});
}
