#!/usr/bin/env node
/**
 * Build `lib/client.js`: one self-contained `window.__ModuleLoader__.load()` call.
 *
 * DSH's client loader hands a factory nothing but a `require` over the modules the
 * shell already seeded (`react`, `react/jsx-runtime`, and the UI primitives). It
 * cannot resolve a local path, so the entire simulation has to arrive as one file:
 * esbuild bundles `src/entry.ts` to CommonJS with React left external, and this
 * script wraps the result in the loader envelope.
 *
 * The two hard rules, both of them load-time failures if broken:
 *
 *   - React and its JSX runtime stay `external`. Bundling a second React would
 *     give the components a different hook dispatcher than the tree they render
 *     into, and every hook would throw.
 *   - The wrapper must expose exactly `apply` and `inject`, which is what the Cordis
 *     client runtime looks for on the module's exports.
 *
 * The Host half is built separately by `tsc` (see `tsconfig.build.json`).
 */
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_NAME = "dsh-ascii-sharks";

/** Modules the shell seeds into its platform table; never bundle these. */
const EXTERNAL = ["react", "react/jsx-runtime", "react-dom", "react-dom/client"];

await mkdir(join(ROOT, "lib"), { recursive: true });

const result = await build({
	entryPoints: [join(ROOT, "src/entry.ts")],
	bundle: true,
	platform: "browser",
	format: "cjs",
	target: "es2022",
	write: false,
	external: EXTERNAL,
	jsx: "automatic",
	legalComments: "none",
	// The loader runs this file as a classic script through `new Function`, so a
	// source map has nowhere to attach itself and would only double the payload.
	sourcemap: false,
	minify: true,
	define: { "process.env.NODE_ENV": '"production"' },
	logLevel: "warning",
});

const bundled = result.outputFiles[0]?.text ?? "";

/**
 * The loader envelope.
 *
 * `require` is the loader's own name-to-module lookup; `module`/`exports` are the
 * CommonJS face esbuild's output expects to find in scope. The trailing
 * `return module.exports` is what the loader takes as the entry's value.
 */
const wrapped = `window.__ModuleLoader__.load({
	id: ${JSON.stringify(PACKAGE_NAME)},
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
${indent(bundled, "\t\t")}
		return module.exports;
	}
});
`;

await writeFile(join(ROOT, "lib/client.js"), wrapped, "utf8");

const bytes = Buffer.byteLength(wrapped);
console.log(`lib/client.js  ${(bytes / 1024).toFixed(1)} KB`);

/**
 * Indent a block so it reads as part of the envelope.
 * @param {string} text - The block.
 * @param {string} pad - The indent.
 * @returns {string} The indented block.
 */
function indent(text, pad) {
	return text
		.split("\n")
		.map((line) => (line.length === 0 ? line : pad + line))
		.join("\n");
}
