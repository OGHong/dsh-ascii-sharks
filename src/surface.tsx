/**
 * The ocean surface.
 *
 * The canvas is mounted *inside* the conversation column, not on the shell's
 * overlay layer — and that is a deliberate correction of the obvious approach.
 *
 * `shell.overlay` is a frame-wide layer at `z-index: 20`, above every column, and
 * its children re-enable pointer events on themselves. A background painted there
 * would cover the columns instead of sitting behind them, so the only way to use
 * that seat for a backdrop is to fight it with negative z-indexes inside a layer
 * that is already above the content. Mounting into the column instead makes the
 * stacking honest: the column paints its own base colour, this canvas lands on
 * top of that colour as the column's first child, and everything else in the
 * column keeps painting above it in DOM order.
 *
 * The seat that drives all this is a zero-size anchor on the overlay: it exists
 * only to give React an mount/unmount lifecycle, and it never paints.
 * @module ascii-sharks/surface
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import { OceanEngine } from "./engine";
import { resolveRoster, type ConfigStore, type OceanConfig } from "./store";

/** The element that marks the New Session state. Stable across shell builds. */
const HERO = "[data-phase=\"hero\"]";

/** Attribute the canvas carries, so it can be found and removed after a reload. */
const CANVAS_ATTR = "data-ascii-ocean";

/** What the seat needs. */
export interface SeatProps {
	/** The shared configuration store; the seat subscribes to it. */
	readonly store: ConfigStore;
	/** The client context, used only to follow the colour scheme. */
	readonly ctx?: {
		get?(name: string): any;
		on?(event: string, listener: () => void): (() => void);
	} | undefined;
}

/** Read the scheme the shell is currently showing. */
function readScheme(): "light" | "dark" {
	return document.body?.hasAttribute("data-ds-dark-theme") === true ? "dark" : "light";
}

/**
 * Static parts of the canvas's own style.
 *
 * Kept as a string because the canvas is created imperatively: it is a child of a
 * shell-owned element, so it cannot be rendered by this component's tree.
 */
const CANVAS_STYLE = [
	"position:absolute",
	"inset:0",
	"width:100%",
	"height:100%",
	"display:block",
	"pointer-events:none",
	// Negative so it paints above the host's own background but below every in-flow
	// child: that is exactly "behind the content, in front of the surface".
	"z-index:-1",
	"font-family:var(--ds-font-family-code, ui-monospace, Menlo, monospace)",
].join(";");

/**
 * Mount one canvas over the conversation column while the New Session state is up.
 *
 * The host element is found by polling rather than by a `MutationObserver`: the
 * attribute that marks the hero (`data-phase`) is written by React on the same
 * element that already exists, so there is no node insertion to observe, and a
 * `subtree` observer on `#root` would fire on every token that streams into a
 * conversation. One `querySelector` per second is the cheaper trade.
 * @param config - The live configuration.
 * @param ctx - The client context, used only to follow the colour scheme.
 */
function mount(configRef: { current: OceanConfig }, ctx: SeatProps["ctx"]): () => void {
	let canvas: HTMLCanvasElement | null = null;
	let host: HTMLElement | null = null;
	let engine: OceanEngine | null = null;
	let observer: MutationObserver | null = null;
	let offTheme: (() => void) | undefined;
	let poll = 0;
	let disposed = false;

	const teardown = () => {
		poll = 0;
		engine?.destroy();
		engine = null;
		observer?.disconnect();
		observer = null;
		try {
			offTheme?.();
		} catch {
			/* A disposed theme service refusing an unsubscribe is not our problem. */
		}
		offTheme = undefined;
		canvas?.remove();
		canvas = null;
		host?.removeAttribute("data-ascii-ocean-host");
		host = null;
	};

	/**
	 * Build the engine for the host that is currently on screen.
	 *
	 * Rebuilt rather than patched on every remount: a hero that went away and came
	 * back deserves a fresh school, and a torn-down engine that kept its fish would
	 * put them wherever they were when the last conversation opened.
	 */
	const build = (next: HTMLElement) => {
		host = next;
		next.setAttribute("data-ascii-ocean-host", "");
		// Own stacking context and clipped corners: the canvas may not paint outside
		// the column, and it must not sit behind the column's own background.
		if (getComputedStyle(next).position === "static") next.style.position = "relative";
		next.style.isolation = "isolate";

		const element = document.createElement("canvas");
		element.setAttribute(CANVAS_ATTR, "");
		element.setAttribute("aria-hidden", "true");
		element.style.cssText = CANVAS_STYLE;
		next.insertBefore(element, next.firstChild);
		canvas = element;

		const config = configRef.current;
		// Resolved once, here: the roster is fixed for the life of this mount, so a
		// random pod does not reshuffle while the reader is looking at it.
		engine = new OceanEngine(element, {
			sharks: resolveRoster(config).map((kind, i) => ({ kind, size: 1 - i * 0.1 })),
		});
		// Whole-canvas transparency rather than per-layer alphas: the reader asked for
		// "a bit more transparent", which is a property of the water, not of the fish.
		engine.setOpacity(config.opacity);
		engine.setScheme(readScheme(), config.strength);
		engine.setPointerEnabled(config.interactive);
		syncClear();
	};

	/**
	 * Tell the sharks where the hero's text sits.
	 *
	 * Computed from the canvas's own size, not from a DOM query: the hero's text is
	 * centred in this column, and a fraction of the column is both stable across
	 * shell rebuilds and correct while the sidebar is being dragged. Slightly wider
	 * than the text block, because a shark drifting past the composer is more
	 * distracting than a shark drifting past the headline.
	 */
	const syncClear = () => {
		if (engine === null || canvas === null) return;
		const rect = canvas.getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) return;
		engine.setClearZone({
			x: rect.width / 2,
			y: rect.height * 0.52,
			width: Math.min(780, rect.width * 0.78),
			height: Math.min(560, rect.height * 0.62),
		});
	};

	const onScheme = () => engine?.setScheme(readScheme(), configRef.current.strength);

	/**
	 * Re-apply the canvas's whole-surface opacity.
	 *
	 * Cheap enough to call on the attach tick: it writes one style property, and it
	 * only does so when the value actually differs from what the element carries,
	 * because a per-tick style write would keep the compositor busy for nothing.
	 */
	const applyOpacity = () => {
		if (engine === null) return;
		// Read through the ref, never the closure: the closure holds whatever the
		// values were when mount() ran, so a slider drag would apply once and then
		// silently stop doing anything.
		const config = configRef.current;
		const wanted = String(config.opacity);
		if (canvas !== null && canvas.style.opacity === wanted) return;
		engine.setOpacity(config.opacity);
	};

	const attach = () => {
		if (disposed) return;

		const hero = document.querySelector<HTMLElement>(HERO);
		if (hero === null) {
			// No New Session on screen: a live conversation owns this column, and a
			// moving background under prose is a reading cost nobody asked for.
			if (engine !== null) teardown();
			return;
		}
		if (engine !== null && host === hero) return;
		if (engine !== null) teardown();

		build(hero);
		applyOpacity();

		observer = new MutationObserver(onScheme);
		if (document.body !== null) {
			observer.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
		}
		try {
			const theme = ctx?.get?.("theme");
			if (theme !== undefined && theme !== null && typeof ctx?.on === "function") {
				offTheme = ctx.on("theme/change", onScheme);
			}
		} catch {
			/* No theme service: the attribute observer still covers the switch. */
		}
	};

	attach();
	// ~4 Hz: fast enough that a resize or a sidebar drag re-centres within a frame
	// or two of the eye noticing, slow enough to be free next to a 60 Hz sim.
	const timer = window.setInterval(() => {
		poll += 1;
		attach();
		// Every few ticks, re-read the column rect: a sidebar drag changes it without
		// changing the hero's identity, and the clear zone has to follow.
		if (poll % 3 === 0) syncClear();
		applyOpacity();
		// The same tick keeps the pointer's influence current: turning scattering off
		// has to actually stop the fish reacting, not wait for the next remount.
		engine?.setPointerEnabled(configRef.current.interactive);
	}, 250);
	const onResize = () => syncClear();
	window.addEventListener("resize", onResize);

	return () => {
		disposed = true;
		window.clearInterval(timer);
		window.removeEventListener("resize", onResize);
		teardown();
	};
}

/**
 * The seat.
 *
 * Renders nothing visible: the anchor is zero-size and transparent, and the canvas
 * it manages lives inside the conversation column. Returning `null` while the
 * ocean is switched off is what unmounts the engine, because the effect's cleanup
 * is what tears it down.
 * @param props - Configuration plus the optional client context.
 * @returns An inert anchor, or null.
 */
export function OceanSeat({ store, ctx }: SeatProps) {
	const config: OceanConfig = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	// The engine lives across renders; this ref is how a slider drag reaches it.
	const configRef = useRef(config);
	configRef.current = config;

	useEffect(() => {
		if (!config.enabled) return;
		if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		// Only the roster and the density rebuild the engine — they change the
		// simulation itself. Opacity and the pointer toggle are applied to the live
		// engine by the mount's own tick, so dragging a slider no longer rebuilds it.
		return mount(configRef, ctx);
	}, [config.enabled, config.strength, config.sharks, config.randomSpecies, ctx]);

	if (!config.enabled) return null;
	// A 1x1 anchor rather than null: a null render would unmount the component and
	// skip the effect entirely, which is correct today but leaves no place to hang a
	// future on-by-default first frame.
	return (
		<div
			data-ascii-ocean-anchor=""
			aria-hidden="true"
			style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" }}
		/>
	);
}
