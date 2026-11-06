// Runs as a classic script in <head>, before the page paints, so the dark theme
// never flashes. It stores the choice in localStorage because extension pages
// share an origin and localStorage can be read synchronously.
(function () {
	const KEY = "ankitab-theme";
	const media = window.matchMedia("(prefers-color-scheme: dark)");
	const listeners = new Set();

	function normalize(value) {
		return value === "light" || value === "dark" ? value : "system";
	}

	function get() {
		try {
			return normalize(localStorage.getItem(KEY));
		} catch (e) {
			return "system";
		}
	}

	function isDark() {
		const value = get();
		return value === "dark" || (value === "system" && media.matches);
	}

	function apply() {
		document.documentElement.classList.toggle("dark-theme", isDark());
	}

	function emit() {
		const dark = isDark();
		listeners.forEach((cb) => {
			try {
				cb(dark);
			} catch (e) {
				console.warn("AnkiTab: theme listener failed", e);
			}
		});
	}

	function set(value) {
		try {
			localStorage.setItem(KEY, normalize(value));
		} catch (e) {
			// storage can be unavailable in a sandboxed context; still apply it
		}
		apply();
		emit();
	}

	function onChange(cb) {
		listeners.add(cb);
		return () => listeners.delete(cb);
	}

	// One-time migration from the old localStorage['theme'] key.
	try {
		const old = localStorage.getItem("theme");
		if ((old === "dark" || old === "light") && !localStorage.getItem(KEY)) {
			localStorage.setItem(KEY, old);
		}
		if (old !== null) localStorage.removeItem("theme");
	} catch (e) {
		// ignore
	}

	if (media.addEventListener) {
		media.addEventListener("change", () => {
			if (get() === "system") {
				apply();
				emit();
			}
		});
	} else if (media.addListener) {
		media.addListener(() => {
			if (get() === "system") {
				apply();
				emit();
			}
		});
	}

	// keep other open tabs (e.g. the options page) in sync
	window.addEventListener("storage", (event) => {
		if (event.key === KEY) {
			apply();
			emit();
		}
	});

	apply();

	window.ankitabTheme = {get, set, isDark, onChange};
})();
