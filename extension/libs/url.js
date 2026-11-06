// Card markup refers to media and fonts by Anki media folder filename, sometimes
// with a query string or url encoding. These helpers decide whether a src is
// remote and turn it into the filename AnkiConnect expects.

const REMOTE_URL = /^[a-z][a-z0-9+.-]*:|^\/\//i;

export function isRemoteUrl(src) {
	return REMOTE_URL.test(src);
}

export function mediaFilename(src) {
	return decodeURIComponent(src.split(/[?#]/)[0]);
}
