// DOM helpers shared by the screens that paint into the single #overlay.

export function el(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

export function showOverlay(content) {
	const overlay = document.getElementById('overlay');
	if (!overlay) return;
	overlay.replaceChildren(content);
	overlay.hidden = false;
}

export function hideOverlay() {
	const overlay = document.getElementById('overlay');
	if (!overlay) return;
	overlay.hidden = true;
	overlay.replaceChildren();
}
