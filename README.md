[link-cws]: https://chrome.google.com/webstore/detail/ankitab/ihoaepdiibjbifnhcjoaddgcnfgjmjdk "Version published on Chrome Web Store"
[link-amo]: https://addons.mozilla.org/en-US/firefox/addon/ankitab/ "Version published on Mozilla Add-ons"

<h1 align="center">
  <img src="https://raw.githubusercontent.com/corollari/ankiTab/master/promo/icon.png" width="64"></a>
  <br>
  AnkiTab
  <br>
</h1>

<h4 align="center">Browser extension that replaces the new tab page with <a href="https://apps.ankiweb.net/" target="_blank">Anki</a> flashcards</h4>

<p align="center">
  <a href="#install">Install</a> •
  <a href="#build">Build</a> •
  <a href="#credits">Credits</a> •
  <a href="#to-do">TO-DO</a> •
  <a href="#license">License</a>
</p>

![screenshot](https://raw.githubusercontent.com/corollari/ankiTab/master/promo/screenshot.png)

## Install
- [**Chrome** extension][link-cws] [<img valign="middle" src="https://img.shields.io/chrome-web-store/v/ihoaepdiibjbifnhcjoaddgcnfgjmjdk.svg?label=%20">][link-cws]
- **Firefox** add-on (Manifest V3, Firefox 128+): see [Firefox install](#firefox-install)

## Firefox install
1. Install [Anki](https://apps.ankiweb.net/) and the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on, and keep Anki running.
2. Build the package with `bash build.sh` (produces `ankitab-firefox.xpi`).
3. Load it:
   - **Temporary (any Firefox):** open `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* → pick `extension/manifest.json` after running `bash build.sh -f`. It stays until Firefox restarts.
   - **Permanent (signed):** run `bash sign.sh`. It signs the build with mozilla on the unlisted channel using the AMO api keys in `~/.config/amo/env` (`WEB_EXT_API_KEY`, `WEB_EXT_API_SECRET`), running web-ext in docker, and writes `ankitab-<version>-signed.xpi`. Bump `version` in `manifests/firefoxManifest.json` first: AMO refuses a version it has already signed.
   - **Permanent (other ways):** release Firefox only installs signed add-ons. Either sign the xpi as unlisted on [addons.mozilla.org](https://addons.mozilla.org/developers/) (`web-ext sign --channel=unlisted`), or use Firefox Developer Edition / Nightly / ESR with `xpinstall.signatures.required = false` in `about:config` and install the xpi via *about:addons → ⚙ → Install Add-on From File*.
4. If the new tab says AnkiTab needs permission, click *Grant permission* (or allow it under *about:addons → AnkiTab → Permissions*).

## Build
##### Setup:
```bash
git clone https://github.com/corollari/ankiTab.git
cd ankiTab
```

##### Build .zip packages for Firefox and Chrome:
```bash
bash build.sh
```

##### Prepare the extension to be loaded unpacked into Firefox:
```bash
bash build.sh -f
```

##### Prepare the extension to be loaded unpacked into Chrome:
```bash
bash build.sh -c
```

##### Build the images (only necessary after changing the icon):
```bash
bash build.sh -i
```

## Credits
The main icon used in the extension comes from [Open Iconic](https://useiconic.com/open).

## TO-DO
- [ ] Use a standalone web version of Anki instead of relying on AnkiConnect

## License
The Unlicense
