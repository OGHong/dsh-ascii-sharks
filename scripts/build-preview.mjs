#!/usr/bin/env node
/**
 * Build `preview/harness.js`: the simulation and renderer bundled standalone.
 *
 * This exists so the *visual* half can be developed and screenshotted without a
 * running DSH shell: it exposes the engine, the renderer, and the shape table on
 * `window.AsciiSharks`, which the preview pages drive.
 *
 * A development artifact; it is not part of the shipped package.
 */
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(join(ROOT, "preview"), { recursive: true });

await writeFile(
	join(ROOT, "preview/_entry.ts"),
	`export { OceanEngine } from "../src/engine";
export { AsciiRenderer, themeFor } from "../src/renderer";
export { World, SHARK_NODES } from "../src/world";
export { SPECIES } from "../src/species";
export { SHAPES, KINDS } from "../src/shapes";
`,
	"utf8",
);

const result = await build({
	entryPoints: [join(ROOT, "preview/_entry.ts")],
	bundle: true,
	platform: "browser",
	format: "iife",
	globalName: "AsciiSharks",
	target: "es2022",
	write: false,
	minify: false,
	logLevel: "warning",
});

await writeFile(join(ROOT, "preview/harness.js"), result.outputFiles[0]?.text ?? "", "utf8");
console.log("preview/harness.js written");
