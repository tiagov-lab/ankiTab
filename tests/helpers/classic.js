import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, "../..");

// Loads a classic (non-module) script by reading it and evaluating it in the
// jsdom global, appending an export object for the requested globals. Avoids
// changing the source or turning the script into a module.
export function loadClassicScript(relativePath, exportNames = []) {
	const full = path.join(repoRoot, relativePath);
	const source = fs.readFileSync(full, "utf8");
	const tail = exportNames.length ? `\n;globalThis.__exports = {${exportNames.join(", ")}};` : "";
	// sourceURL lets v8 attribute the eval'd code to the file so coverage sees it.
	(0, eval)(source + tail + `\n//# sourceURL=file://${full}`);
	const exports = globalThis.__exports;
	delete globalThis.__exports;
	return exports;
}
