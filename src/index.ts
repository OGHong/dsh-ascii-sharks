/**
 * `dsh-ascii-sharks` — the Host half.
 *
 * There is almost nothing for the Host to do here, and that is a deliberate design
 * choice rather than an unfinished one:
 *
 *   - The ocean is a *browser surface*. It touches a canvas, a `matchMedia`, and
 *     `localStorage`, none of which exist in the Host process.
 *   - Its preferences are per-window visual taste, not account settings. Putting a
 *     density slider in the Host's settings document would push it across every
 *     window the account owns, including the ones on a different machine.
 *
 * The row exists for one reason: `dsh-client-modules` builds the browser module
 * graph by scanning Loader entries for packages that declare `dsh.client`. A
 * package absent from the composed tree is a package whose browser half is never
 * served, so this file's job is to be present and to stay inert.
 *
 * It registers a single service — the defaults this build ships — which a future
 * profile override can retarget through the `config` field of the patch row
 * without touching the browser half.
 * @module dsh-ascii-sharks
 */

/** The preferences this build ships, published for a browser half that asks. */
export interface OceanDefaults {
	/** Whether a fresh profile starts with the ocean on. */
	readonly enabled: boolean;
	/** Density multiplier a fresh profile starts at. */
	readonly strength: number;
}

/** Defaults published under the `asciiSharks` service. */
const DEFAULTS: OceanDefaults = { enabled: true, strength: 0.9 };

/**
 * The minimum this file reads from its context.
 *
 * Described structurally rather than imported: the plugin has no runtime
 * dependency on a Host package beyond the service registry it is handed, so a
 * shape that drifts from the real Host shows up as a type error here rather than as
 * a crash inside a running composition.
 */
interface HostContext {
	readonly logger?: { readonly warn?: (text: string) => unknown };
	/** Publish one service, disposed with this plugin's fiber. */
	set?(name: string, value: OceanDefaults): unknown;
}

/**
 * Publish the defaults.
 *
 * Guarded rather than assumed: a composition that does not expose `set` (a test
 * harness, a future Host) must still load this package, because its browser half is
 * what the reader sees and it does not depend on this call.
 * @param ctx - The Host context.
 */
export function apply(ctx: HostContext) {
	if (typeof ctx.set !== "function") {
		ctx.logger?.warn?.("dsh-ascii-sharks: this Host has no service registry; the browser half still loads");
		return;
	}
	try {
		ctx.set("asciiSharks", DEFAULTS);
	} catch (error) {
		ctx.logger?.warn?.(`dsh-ascii-sharks: could not publish the defaults (${String(error)})`);
	}
}
