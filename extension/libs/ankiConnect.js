// 127.0.0.1 instead of localhost: AnkiConnect binds IPv4 only and Firefox may resolve localhost to ::1 first
const ANKI_CONNECT_URL = 'http://127.0.0.1:8765';
const HOST_PERMISSIONS = {origins: ['http://127.0.0.1:8765/*', 'http://localhost:8765/*']};

function showError(html) {
	const target = document.querySelector(".card") || document.body;
	target.innerHTML = '<div class="alert alert-danger" role="alert">' + html + '</div>';
}

// In Firefox MV3, host permissions can be revoked by the user (or not granted yet),
// in which case requests to AnkiConnect fail. Offer a button to grant them.
function showPermissionPrompt() {
	showError('AnkiTab needs permission to talk to AnkiConnect on 127.0.0.1:8765. <button class="btn btn-primary btn-sm" id="grantAnkiPermission">Grant permission</button>');
	const btn = document.querySelector("#grantAnkiPermission");
	btn && btn.addEventListener('click', () => {
		chrome.permissions.request(HOST_PERMISSIONS).then((granted) => granted && location.reload());
	});
}

async function hasHostPermission() {
	if (!chrome.permissions || !chrome.permissions.contains) return true;
	try {
		return await chrome.permissions.contains(HOST_PERMISSIONS);
	} catch (e) {
		return true;
	}
}

function ankiConnectInvoke(action, params={}) {
	const version = 6;
	return new Promise((resolve, reject)=>{
		const xhr = new XMLHttpRequest();
		xhr.addEventListener('error', async () => {
			if (await hasHostPermission()) {
				showError('Make sure that anki is running and <a href="https://ankiweb.net/shared/info/2055492159" class="alert-link">ankiConnect</a> is installed, ankiTab won\'t work otherwise.');
			} else {
				showPermissionPrompt();
			}
			reject('failed to connect to AnkiConnect');
		});
		xhr.addEventListener('load', () => {
			try {
				const response = JSON.parse(xhr.responseText);
				if (response.error) {
					throw response.error;
				} else {
					if (response.hasOwnProperty('result')) {
						resolve(response.result);
					} else {
						console.log('failed to get results from AnkiConnect');
					}
				}
			} catch (e) {
				console.error(e);
				reject(e);
			}
		});
		xhr.open('POST', ANKI_CONNECT_URL);
		xhr.send(JSON.stringify({action, version, params}));
	});
}

export default ankiConnectInvoke;
