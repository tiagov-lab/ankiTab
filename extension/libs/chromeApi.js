// Chrome apis are callback based in one browser and promise based in another.
// callChrome turns either flavour into a promise and reads chrome.runtime.lastError
// so callers never have to branch on it.

function chromeApi() {
	return globalThis.chrome || {};
}

function lastError() {
	const runtime = chromeApi().runtime;
	return runtime && runtime.lastError;
}

export function callChrome(fn, ...args) {
	return new Promise((resolve, reject) => {
		let maybePromise;
		try {
			maybePromise = fn(...args, (result) => {
				const error = lastError();
				if (error) reject(new Error(error.message));
				else resolve(result);
			});
		} catch (e) {
			reject(e);
			return;
		}
		if (maybePromise && typeof maybePromise.then === 'function') {
			maybePromise.then(resolve, reject);
		}
	});
}

export function storageGet(keys) {
	const local = chromeApi().storage.local;
	return callChrome(local.get.bind(local), keys);
}

export function storageSet(values) {
	const local = chromeApi().storage.local;
	return callChrome(local.set.bind(local), values);
}

// `fallback` answers "the permissions api is missing"; `errorFallback` answers
// "it is there but cannot say". ankiConnect assumes the host permission is
// granted in that case (and reports offline), topSites assumes it is not.
export function permissionsContains(perms, fallback, errorFallback = fallback) {
	const permissions = chromeApi().permissions;
	if (!permissions || typeof permissions.contains !== 'function') return Promise.resolve(fallback);
	return callChrome(permissions.contains.bind(permissions), perms).then(
		(granted) => !!granted,
		() => errorFallback
	);
}

export function permissionsRequest(perms) {
	const permissions = chromeApi().permissions;
	if (!permissions || typeof permissions.request !== 'function') return Promise.resolve(false);
	return callChrome(permissions.request.bind(permissions), perms).then(
		(granted) => !!granted,
		() => false
	);
}

export function getTopSites() {
	const topSites = chromeApi().topSites;
	if (!topSites || typeof topSites.get !== 'function') {
		return Promise.reject(new Error('topSites is not available'));
	}
	return callChrome(topSites.get.bind(topSites)).then((sites) => sites || []);
}
