/**
 * Wires the world and the renderer to a canvas: a fixed-timestep loop, resize,
 * pointer input, pausing when off-screen or hidden, and reduced motion.
 *
 * Two properties matter for embedding this in someone else's page:
 *
 *   - **It never owns the frame rate.** The loop is a plain rAF that stops the
 *     moment the canvas leaves the viewport, the tab is hidden, or the host calls
 *     {@link OceanEngine.pause}. A background animation that keeps running in a
 *     hidden window is a battery bug, and DSH's window lives open all day.
 *   - **It never assumes it is the only thing on screen.** The canvas is
 *     transparent and the cells are cheap, but the loop also caps the device pixel
 *     ratio at 2 and the fixed step at four catch-up steps, so a slow frame
 *     degrades into a skipped frame rather than a spiral of death.
 * @module ascii-sharks/engine
 */

import { AsciiRenderer, themeFor, type Theme } from "./renderer";
import { World, type SharkSpec } from "./world";

/** Fixed simulation step: 60 Hz, independent of the display refresh rate. */
const STEP = 1 / 60;
/** Never run more than this many catch-up steps in one frame. */
const MAX_STEPS = 4;

/** Keep the canvas just visible even if a stored value says otherwise. */
function clampOpacity(value: number) {
	return Number.isFinite(value) ? Math.min(1, Math.max(0.05, value)) : 1;
}

export interface EngineOptions {
	/** Which sharks to seed. Defaults to four classics at different depths. */
	readonly sharks?: readonly SharkSpec[];
	/** Overrides the area-based fish population. */
	readonly fishCount?: number;
	/** Called after every resize, with the new cell size. */
	readonly onResize?: (cellWidth: number, cellHeight: number) => void;
}

/**
 * The live ocean: one canvas, one world, one renderer.
 *
 * Construct it with a mounted canvas, then call {@link destroy} when the surface
 * goes away. Every listener and observer it installs is removed there; a caller
 * that forgets leaks an animation loop for the life of the page.
 */
export class OceanEngine {
	readonly world: World;
	/** Public so a harness can drive one frame without the loop (see `preview/lab.html`). */
	readonly renderer: AsciiRenderer;
	private raf = 0;
	private last = 0;
	private acc = 0;
	private visible = true;
	private paused = false;
	private pointerEnabled = true;
	private disposed = false;
	private scheme: "light" | "dark" = "dark";
	private readonly reducedMotion: MediaQueryList;
	private readonly resizeObserver: ResizeObserver;
	private readonly intersectionObserver: IntersectionObserver;
	private readonly options: EngineOptions;

	constructor(private readonly canvas: HTMLCanvasElement, options: EngineOptions = {}) {
		this.options = options;
		this.world = new World(options.sharks, options.fishCount);
		this.renderer = new AsciiRenderer(canvas);
		this.renderer.setFontFamily(getComputedStyle(canvas).fontFamily);
		this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(canvas);
		this.intersectionObserver = new IntersectionObserver(([entry]) => {
			this.visible = entry?.isIntersecting ?? true;
			this.schedule();
		});
		this.intersectionObserver.observe(canvas);

		this.reducedMotion.addEventListener("change", this.onMotionPreference);
		document.addEventListener("visibilitychange", this.onVisibility);
		window.addEventListener("pointermove", this.onPointerMove, { passive: true });
		window.addEventListener("pointerdown", this.onPointerDown, { passive: true });
		document.documentElement.addEventListener("pointerleave", this.onPointerLeave);
		window.addEventListener("blur", this.onPointerLeave);

		this.resize();
		// Canvas text cannot trigger a webfont load; once the mono face is in, redraw.
		document.fonts?.load(`600 16px ${getComputedStyle(canvas).fontFamily}`).then(() => {
			if (!this.disposed && this.reducedMotion.matches) this.drawStill();
		});
		this.schedule();
	}

	/** The canvas this engine paints onto. */
	get element() {
		return this.canvas;
	}

	/**
	 * Set the canvas's own opacity.
	 *
	 * Applied on the element rather than mixed into each colour: one compositor
	 * property costs nothing per frame, and it dims the grid, the wake, the fish and
	 * the whales by the same factor — which is what "more transparent" means for a
	 * background. Colours that were individually faded would drift apart, and the
	 * whales would stop sitting *in* the water and start floating in front of it.
	 * @param value - 0.05 to 1.
	 */
	setOpacity(value: number) {
		const clamped = clampOpacity(value);
		this.canvas.style.opacity = clamped === 1 ? "" : String(clamped);
	}

	/** Adopt a palette. The scheme is read from the shell on every change. */
	setScheme(scheme: "light" | "dark", strength = 1) {
		this.scheme = scheme;
		this.renderer.setTheme(themeFor(scheme, strength));
		if (this.reducedMotion.matches) this.drawStill();
	}

	/** Current palette, for hosts that want to mirror it. */
	get theme(): Theme {
		return themeFor(this.scheme);
	}

	/**
	 * Tell the sharks which part of the canvas to leave alone.
	 *
	 * Coordinates are canvas-local CSS pixels. Pass null to lift the restriction.
	 */
	setClearZone(zone: { x: number; y: number; width: number; height: number } | null) {
		this.world.clear = zone;
	}

	/**
	 * Turn the pointer's influence on the fish on or off.
	 *
	 * The listeners stay installed rather than being removed and re-added: tearing
	 * down a `window` listener mid-drag can drop the `pointerleave` that clears the
	 * cursor position, and a stale active pointer is a bug that never goes away.
	 * @param enabled - False to make the water ignore the cursor.
	 */
	setPointerEnabled(enabled: boolean) {
		this.pointerEnabled = enabled;
		if (!enabled) this.world.pointer.active = false;
	}

	/** Stop or resume the simulation. Resume keeps the current state. */
	pause(paused = true) {
		this.paused = paused;
		if (paused) cancelAnimationFrame(this.raf);
		else this.schedule();
	}

	/**
	 * Paint one frame immediately, advancing the simulation by `dt`.
	 *
	 * A harness entry point: the interactive loop is what the shell uses, but a
	 * still — a screenshot, a PNG export, a reduced-motion frame — needs the
	 * simulation advanced and drawn without a rAF in the middle.
	 * @param dt - Seconds to advance before drawing.
	 */
	renderOnce(dt = 1 / 60) {
		this.world.step(dt);
		this.renderer.render(this.world, dt);
	}

	/** Tear down every listener, observer, and loop this engine installed. */
	destroy() {
		this.disposed = true;
		cancelAnimationFrame(this.raf);
		this.resizeObserver.disconnect();
		this.intersectionObserver.disconnect();
		this.reducedMotion.removeEventListener("change", this.onMotionPreference);
		document.removeEventListener("visibilitychange", this.onVisibility);
		window.removeEventListener("pointermove", this.onPointerMove);
		window.removeEventListener("pointerdown", this.onPointerDown);
		document.documentElement.removeEventListener("pointerleave", this.onPointerLeave);
		window.removeEventListener("blur", this.onPointerLeave);
	}

	private resize() {
		const rect = this.canvas.getBoundingClientRect();
		if (rect.width < 1 || rect.height < 1) return;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		this.renderer.resize(rect.width, rect.height, dpr);
		this.world.resize(rect.width, rect.height, this.renderer.cellWidth, this.renderer.cellHeight);
		this.options.onResize?.(this.renderer.cellWidth, this.renderer.cellHeight);
		if (this.reducedMotion.matches) this.drawStill();
	}

	private schedule() {
		cancelAnimationFrame(this.raf);
		if (this.disposed || this.paused || !this.visible || document.hidden || this.reducedMotion.matches) return;
		this.last = performance.now();
		this.raf = requestAnimationFrame(this.frame);
	}

	private readonly frame = (now: number) => {
		if (this.disposed || this.paused) return;
		const dt = Math.min(0.1, (now - this.last) / 1000);
		this.last = now;
		this.acc += dt;
		let steps = 0;
		while (this.acc >= STEP && steps < MAX_STEPS) {
			this.world.step(STEP);
			this.acc -= STEP;
			steps++;
		}
		if (steps === MAX_STEPS) this.acc = 0;
		this.renderer.render(this.world, dt);
		this.raf = requestAnimationFrame(this.frame);
	};

	/** Reduced motion: let the ecosystem settle, then show a single frame. */
	private drawStill() {
		if (this.world.time < 4) {
			for (let i = 0; i < 240; i++) this.world.step(STEP);
		}
		this.renderer.render(this.world, STEP);
	}

	private readonly onMotionPreference = () => {
		if (this.reducedMotion.matches) {
			cancelAnimationFrame(this.raf);
			this.drawStill();
		} else {
			this.schedule();
		}
	};

	private readonly onVisibility = () => {
		if (document.hidden) cancelAnimationFrame(this.raf);
		else this.schedule();
	};

	private toLocal(e: PointerEvent) {
		const rect = this.canvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
		return { x, y, inside };
	}

	private readonly onPointerMove = (e: PointerEvent) => {
		if (this.disposed || !this.pointerEnabled) return;
		const { x, y, inside } = this.toLocal(e);
		const p = this.world.pointer;
		p.x = x;
		p.y = y;
		p.active = inside && e.pointerType !== "touch";
	};

	private readonly onPointerDown = (e: PointerEvent) => {
		if (this.disposed || this.paused || !this.pointerEnabled) return;
		if (this.reducedMotion.matches) return;
		const { x, y, inside } = this.toLocal(e);
		if (inside) this.world.splash(x, y);
	};

	private readonly onPointerLeave = () => {
		this.world.pointer.active = false;
	};
}
