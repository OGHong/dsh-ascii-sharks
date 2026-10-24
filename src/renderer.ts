/**
 * PORTED CODE — NOT covered by any license grant from this repository.
 *
 * Derived from https://github.com/stackedlol/ascii-sharks, which had no license
 * file at the time of porting. Copyright remains with that project's author(s).
 *
 * This repository grants you no rights to this file. See NOTICE.md.
 */
/**
 * Draws the world as a grid of ASCII cells.
 *
 * Four layers, painted in order over a transparent canvas:
 *
 *   1. the ambient dot field, a faint lattice that twinkles on per-cell clocks
 *   2. a wake field that diffuses where things swim and lights its cells
 *   3. fish, one minimal glyph per cell, glinting on hard turns
 *   4. sharks, rasterised cell by cell with supersampled edges: a filled skin
 *      block shaded by an implied light, a dense glyph riding on top, and
 *      occasional accents that flip colour as the hide shimmers
 *
 * Everything is theme-driven. In the dark scheme a shark's skin is a bright
 * block with a dark glyph punched out of it; in the light scheme the ink is
 * inverted so the same silhouette reads as a dark engraving. Nothing here draws
 * a background: the canvas is transparent, and the shell's own surface shows
 * through wherever there is no ink.
 * @module ascii-sharks/renderer
 */

import { clamp, hash3, smoothstep } from "./math";
import { KINDS, SHAPES, inTriangle, type SharkShape } from "./shapes";
import { SHARK_NODES, type Shark, type World } from "./world";

const ALPHA_LEVELS = 6;
const FISH_ALPHAS = [0.36, 0.5, 0.62, 0.76, 0.9];

/** Ink ramp: sparse glyphs on bright skin, dense glyphs in shadow. */
const SKIN_RAMP = ":;t%SX8#@";
const FIN_GLYPHS = "%;tS:";
const RIDGE_GLYPHS = "@8%";
const EDGE_HEAVY = ":;";
const EDGE_LIGHT = ".',`";
const MARK_GLYPHS = "#%@";

const FLAG_BODY = 1;
const FLAG_EDGE = 2;
const FLAG_FIN = 3;
const FLAG_RIDGE = 4;
const FLAG_EYE = 5;
/** Dark skin markings: tiger bars, zebra-shark spots. */
const FLAG_MARK = 6;
/**
 * Pale markings drawn *above* the hide: the orca's eye patch and saddle.
 *
 * A separate flag rather than a negative shade, because the shading model only
 * ever darkens toward the flanks — there is no brightness a `shade` value can
 * reach that would paint white on a dark hide.
 */
const FLAG_PALE = 7;
/**
 * The orca's grey saddle, drawn as a mid-tone between the black back and the pale rim.
 *
 * Its own flag because it is its own colour. Folding it into FLAG_PALE is what made it
 * white, and white is the one thing the saddle is not — see `shapes.ts`.
 */
const FLAG_SADDLE = 8;

/** Sub-cell sample offsets for anti-aliased silhouettes. */
const SUBSAMPLES = [0.5, 0.5, 0.16, 0.2, 0.84, 0.2, 0.16, 0.8];

/** The palette one scheme resolves to. */
export interface Theme {
	readonly isDark: boolean;
	/** Ambient dot colour. */
	readonly dot: readonly [number, number, number];
	/** Colour the wake field lights cells with. */
	readonly wake: readonly [number, number, number];
	/** Fish glyph colour. */
	readonly fish: readonly [number, number, number];
	/** Accent colours that flash across a shark's hide. */
	readonly accent: readonly string[];
	/** Overall density multiplier, so a translucent shell stays legible. */
	readonly strength: number;
}

const DARK_THEME: Theme = {
	isDark: true,
	dot: [96, 124, 168],
	wake: [110, 230, 255],
	fish: [230, 238, 255],
	accent: ["#e0892c", "#e03a32", "#b44ae0", "#33c8cc", "#3cb54a", "#3150e8", "#d9c14a"],
	strength: 1,
};

const LIGHT_THEME: Theme = {
	isDark: false,
	dot: [104, 118, 138],
	wake: [24, 104, 138],
	fish: [30, 44, 62],
	accent: ["#b3541e", "#b02a24", "#7730a8", "#1b8b91", "#2b7a37", "#2643b0", "#9a8420"],
	strength: 1,
};

/**
 * Resolve the palette for one scheme.
 * @param scheme - The scheme the shell is showing.
 * @param strength - Optional density multiplier (0..1).
 * @returns The theme the renderer paints with.
 */
export function themeFor(scheme: "light" | "dark", strength = 1): Theme {
	const base = scheme === "dark" ? DARK_THEME : LIGHT_THEME;
	return strength === 1 ? base : { ...base, strength };
}

export class AsciiRenderer {
	private readonly ctx: CanvasRenderingContext2D;
	private dpr = 1;
	private width = 0;
	private height = 0;
	private cw = 12;
	private ch = 18;
	private cols = 0;
	private rows = 0;
	private fontFamily = "ui-monospace, Menlo, monospace";
	private theme: Theme = DARK_THEME;

	private dotPhase = new Float32Array(0);
	private dotFreq = new Float32Array(0);
	private energy = new Float32Array(0);
	private energyTmp = new Float32Array(0);
	private heat = new Float32Array(0);
	private bucketOf = new Uint8Array(0);
	private bucketOrder = new Int32Array(0);
	private bucketCounts = new Int32Array(ALPHA_LEVELS + 1);
	/** The grid, pre-stroked; blitted every frame instead of re-stroked. */
	private bg: HTMLCanvasElement | null = null;

	private sharkFlag = new Uint8Array(0);
	private sharkShade = new Float32Array(0);
	private sharkKey = new Uint32Array(0);
	private sharkDepth = new Float32Array(0);
	private sharkKind = new Uint8Array(0);
	/** Cells a shark's shadow falls on. */
	private sharkShadow = new Uint8Array(0);
	private readonly spine = new Float32Array(SHARK_NODES * 2);
	private readonly arc = new Float32Array(SHARK_NODES);
	private arcTotal = 1;
	private shape: SharkShape = SHAPES.classic;
	private sharkId = 0;
	/**
	 * The tail's own frame, refreshed once per whale per frame.
	 *
	 * The flukes cannot use the body axis: that line is the average of the whole body,
	 * so a whale whose spine is undulating would swing its flukes in a straight line
	 * and they would look bolted on. A real fluke pair rides the *last* spine segment
	 * and beats up and down; from above that beat reads as the span opening and closing
	 * slightly, plus a small lash left and right as the stock swings.
	 */
	private tailX = 0;
	private tailY = 0;
	/** Unit vector pointing aft, taken from the last spine segment. */
	private tailAx = 1;
	private tailAy = 0;
	/** Span multiplier: the flukes open on the downstroke and close on the up. */
	private tailSpan = 1;
	/**
	 * Fore-and-aft travel of the flukes, in body lengths.
	 *
	 * This is what a whale's tail beat *looks like from above*, and it is the detail
	 * that separates a whale from a fish. Fish sweep their tails side to side, so a
	 * top-down view shows a lateral swing. Whales beat up and down, so a top-down
	 * view shows the flukes pulling in and pushing out along the body axis while
	 * their apparent span opens and folds. Animating a lateral swing here — which is
	 * what the first version of this did — reads as a fish's tail on a whale's body,
	 * and as "stiff" because the motion fights the animal's shape.
	 */
	private tailBeat = 0;
	private finTipLeft = 0;
	private finTipRight = 0;
	// Scratch outputs of sampleShark(), to avoid allocating per sample.
	private hitFlag = 0;
	private hitShade = 0;
	private hitS = 0;
	private hitV = 0;
	private hitDist = 0;

	/** Cells holding a fish this frame (frame stamp); dots skip them. */
	private fishStamp = new Uint32Array(0);
	private frameId = 0;
	/** Fish cells bucketed by brightness, so each bucket is one fillStyle. */
	private readonly fishBuckets: number[][] = FISH_ALPHAS.map(() => []);
	private fishStyles: string[] = [];
	private accentIdx: Int32Array = new Int32Array(0);

	constructor(private readonly canvas: HTMLCanvasElement) {
		const ctx = canvas.getContext("2d", { alpha: true });
		if (!ctx) throw new Error("2D canvas unavailable");
		this.ctx = ctx;
		this.setTheme(DARK_THEME);
	}

	/** Swap the palette; call before the next {@link render}. */
	setTheme(theme: Theme) {
		this.theme = theme;
		const fish = theme.fish;
		this.fishStyles = FISH_ALPHAS.map(
			(a) => `rgba(${fish[0]},${fish[1]},${fish[2]},${(a * theme.strength).toFixed(3)})`,
		);
		// The grid's own colour is part of the palette, so a scheme switch has to
		// repaint it rather than just recolour the ink drawn on top.
		if (this.width > 0) this.paintGrid();
	}

	get cellWidth() {
		return this.cw;
	}

	get cellHeight() {
		return this.ch;
	}

	setFontFamily(family: string) {
		if (family) this.fontFamily = family;
	}

	/**
	 * Adopt a new canvas size.
	 *
	 * The cell size follows the width in a coarse ladder rather than a formula:
	 * between 8 and 13 pixels of column width the character grid keeps roughly the
	 * same *count* of columns, so a wide window gets bigger glyphs instead of an
	 * unreadable dust of tiny ones.
	 *
	 * Per-cell fields are reallocated **only when the grid changes shape**; see the
	 * comment on the guard below for why that distinction matters.
	 */
	resize(width: number, height: number, dpr: number) {
		const prevCols = this.cols;
		const prevRows = this.rows;
		this.width = width;
		this.height = height;
		this.dpr = dpr;
		this.cw = clamp(Math.round(width / 124), 8, 13);
		this.ch = Math.round(this.cw * 1.45);
		this.cols = Math.ceil(width / this.cw);
		this.rows = Math.ceil(height / this.ch);

		this.canvas.width = Math.max(1, Math.round(width * dpr));
		this.canvas.height = Math.max(1, Math.round(height * dpr));

		const n = this.cols * this.rows;
		// Reallocate only when the grid actually changed shape. A resize that keeps
		// the same cols/rows (dragging a window edge by a few pixels, a DPR flip
		// that rounds back to the same cell count) would otherwise wipe every trail
		// field, and the wake behind the pod would vanish on every pointer-up.
		// Ported from upstream `1c3a384 resize fix` (PR #3).
		if (this.cols !== prevCols || this.rows !== prevRows) {
			this.dotPhase = new Float32Array(n);
			this.dotFreq = new Float32Array(n);
			this.energy = new Float32Array(n);
			this.energyTmp = new Float32Array(n);
			this.heat = new Float32Array(n);
			this.bucketOf = new Uint8Array(n);
			this.bucketOrder = new Int32Array(n);
			this.sharkFlag = new Uint8Array(n);
			this.sharkShade = new Float32Array(n);
			this.sharkKey = new Uint32Array(n);
			this.sharkDepth = new Float32Array(n);
			this.sharkKind = new Uint8Array(n);
			this.sharkShadow = new Uint8Array(n);
			this.fishStamp = new Uint32Array(n);
			this.accentIdx = new Int32Array(n);
		}
		this.bucketCounts = new Int32Array(ALPHA_LEVELS + 1);

		for (let i = 0; i < n; i++) {
			const col = i % this.cols;
			const row = (i / this.cols) | 0;
			this.dotPhase[i] = hash3(col, row, 23) * Math.PI * 2;
			this.dotFreq[i] = 0.3 + hash3(col, row, 37) * 1.1;
			this.accentIdx[i] = (hash3(col, row, 91) * 7) | 0;
		}
		this.paintGrid();
	}

	/** Paint one frame of the world. */
	render(world: World, dt: number) {
		const { ctx, dpr, cols, ch } = this;
		if (cols === 0) return;
		const t = world.time;

		this.consumeEvents(world);
		this.rasterizeSharks(world.sharks, t);
		this.depositWake(world);
		this.diffuse(dt);

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		this.markFish(world);
		this.drawDots(t);

		ctx.font = `600 ${Math.round(ch * 0.74)}px ${this.fontFamily}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";

		this.drawHeat();
		this.drawFish();
		this.drawSharks(t);
	}

	// ── simulation to field ────────────────────────────────────────────

	private cellIndex(x: number, y: number) {
		const c = Math.floor(x / this.cw);
		const r = Math.floor(y / this.ch);
		if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
		return r * this.cols + c;
	}

	private stamp(field: Float32Array, x: number, y: number, radius: number, amount: number) {
		const c0 = Math.floor(x / this.cw);
		const r0 = Math.floor(y / this.ch);
		for (let r = r0 - radius; r <= r0 + radius; r++) {
			for (let c = c0 - radius; c <= c0 + radius; c++) {
				if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
				const d = Math.hypot(c - c0, (r - r0) * 1.4);
				if (d > radius + 0.5) continue;
				const i = r * this.cols + c;
				field[i] = Math.min(1.6, field[i]! + amount * (1 - d / (radius + 1)));
			}
		}
	}

	private consumeEvents(world: World) {
		for (const e of world.events) {
			if (e.kind === "eat") {
				this.stamp(this.heat, e.x, e.y, 2, 1);
				this.stamp(this.energy, e.x, e.y, 3, 0.9);
			} else {
				this.stamp(this.energy, e.x, e.y, 6, 1.4);
			}
		}
		world.events.length = 0;
	}

	private depositWake(world: World) {
		const { energy } = this;
		for (const f of world.fish) {
			if (!f.alive) continue;
			const i = this.cellIndex(f.x, f.y);
			if (i >= 0) energy[i] = Math.min(1.6, energy[i]! + 0.012 + f.alarm * 0.03);
		}
		for (const sh of world.sharks) {
			// The tail sweeps the most water.
			for (let k = SHARK_NODES - 6; k < SHARK_NODES; k++) {
				const i = this.cellIndex(sh.nodes[k * 2]!, sh.nodes[k * 2 + 1]!);
				if (i >= 0) energy[i] = Math.min(1.6, energy[i]! + 0.05 + sh.speed * 0.0012);
			}
		}
		if (world.pointer.active) {
			this.stamp(energy, world.pointer.x, world.pointer.y, 1, 0.08);
		}
	}

	/** Blur + decay so wakes spread out like ripples and fade. */
	private diffuse(dt: number) {
		const { cols, rows, energy, energyTmp: tmp, heat } = this;
		const decay = Math.exp(-dt * 1.5);
		for (let r = 0; r < rows; r++) {
			for (let c = 0; c < cols; c++) {
				const i = r * cols + c;
				const l = c > 0 ? energy[i - 1]! : energy[i]!;
				const rt = c < cols - 1 ? energy[i + 1]! : energy[i]!;
				const u = r > 0 ? energy[i - cols]! : energy[i]!;
				const d = r < rows - 1 ? energy[i + cols]! : energy[i]!;
				tmp[i] = (energy[i]! * 4 + l + rt + u + d) * 0.125 * decay;
			}
		}
		this.energy = tmp;
		this.energyTmp = energy;
		const heatDecay = Math.exp(-dt * 2.2);
		for (let i = 0; i < heat.length; i++) heat[i]! *= heatDecay;
	}

	// ── sharks ─────────────────────────────────────────────────────────

	/**
	 * Classify one point against the current shark (spine and arc already built).
	 *
	 * Body coordinates: `s` along the spine (0 snout to 1 tail), `v` across it.
	 * Writes the hit* fields and returns whether the point is on the shark at all.
	 */
	private sampleShark(px: number, py: number, L: number) {
		const { spine, arc } = this;
		const N = SHARK_NODES;
		let best = Infinity;
		let bestS = 0;
		let bestSign = 1;
		let bestNx = 0;
		let bestNy = 0;
		for (let k = 0; k < N - 1; k++) {
			const ax = spine[k * 2]!;
			const ay = spine[k * 2 + 1]!;
			const sx = spine[(k + 1) * 2]! - ax;
			const sy = spine[(k + 1) * 2 + 1]! - ay;
			const len2 = sx * sx + sy * sy || 1;
			const u = clamp(((px - ax) * sx + (py - ay) * sy) / len2, 0, 1);
			const qx = ax + sx * u;
			const qy = ay + sy * u;
			const d2 = (px - qx) ** 2 + (py - qy) ** 2;
			if (d2 < best) {
				best = d2;
				const len = Math.sqrt(len2);
				bestS = (arc[k]! + u * len) / this.arcTotal;
				bestSign = sx * (py - ay) - sy * (px - ax) >= 0 ? 1 : -1;
				bestNx = (-sy / len) * bestSign;
				bestNy = (sx / len) * bestSign;
			}
		}

		const a = Math.sqrt(best);
		const s = bestS;
		const u = s * L;
		const shape = this.shape;
		const w = shape.halfWidth(s) * L;
		this.hitDist = a;
		this.hitS = s;
		this.hitV = a * bestSign;

		// The flukes are the one part of any silhouette that cannot come from
		// `halfWidth`. That function measures out from the spine, so the tail it
		// describes is solid across the middle by construction — the opposite of a
		// fork. The two lobes are therefore tested here, in the tail's own frame:
		// origin at the tail tip, `aft` along the body away from the head, `off` across.
		if (shape.flukes !== undefined) {
			const { offset, span, reach } = shape.flukes;
			// The tail's own frame, computed once per whale per frame above. It rides the
			// last spine segment, so the flukes inherit the body wave instead of hanging
			// off a straight line while the body swims underneath them.
			const ax = this.tailAx;
			const ay = this.tailAy;
			const dx = px - this.tailX;
			const dy = py - this.tailY;
			// The pair travels fore and aft along the stock, and the lobes open and fold.
			// Deliberately *no* lateral term: a sideways lash is a fish's tail beat, and
			// putting one on a whale is what made the first version read as stiff.
			const aft = dx * ax + dy * ay - this.tailBeat;
			const off = Math.abs(-dx * ay + dy * ax);
			const spanNow = span * this.tailSpan;
			const offsetNow = offset * this.tailSpan;
			// One lobe: an ellipse centred `offset` off the axis, `reach` long and
			// `span` wide. Its inner edge begins at `offset - span`, and that is where
			// the fork comes from: the mirror lobe begins at the same distance on the
			// other side, so the pair never meet at the centreline.
			if (aft >= 0 && aft <= L * reach) {
				const c = (off - L * offsetNow) / (L * spanNow);
				const k = aft / (L * reach);
				if (c * c + k * k <= 1) {
					this.hitFlag = FLAG_FIN;
					this.hitShade = 0.3 + 0.42 * k;
					return true;
				}
			}
		}

		// A cut-out overrides every other classification: this point is water however
		// well it fits the body or a fin.
		if (shape.notch !== undefined && w > 1e-6 && shape.notch(s, a / w)) {
			this.hitFlag = 0;
			this.hitShade = 0;
			return false;
		}

		const head = shape.head;
		if (head && u < L * (head.sweep + head.depth + head.notch)) {
			// Cephalofoil: a wide wing across the snout, its tips swept back toward
			// the eyes, and on a great hammerhead a shallow notch in the middle.
			const span = L * head.span;
			const r = a / span;
			const front = L * head.sweep * r * r + L * head.notch * Math.max(0, 1 - r / 0.14);
			const depth = L * head.depth * (1 - 0.2 * r * r * r * r);
			if (r <= 1 && u >= front && u <= front + depth) {
				this.hitFlag = r > 0.84 ? FLAG_EYE : FLAG_BODY;
				this.hitShade = r > 0.84 ? 0 : 0.62 - 0.2 * r + (u < front + L * 0.012 ? 0.1 : 0);
				return true;
			}
		}

		if (a <= w) {
			const across = a / (w || 1);
			// A rounded back lit from the upper left: the spine catches the light, the
			// flank on the far side falls into shadow, and the near flank keeps a
			// little bounce. The falloff is what gives the silhouette its volume; with
			// a flat block fill there is nothing else to read as a form.
			const facing = (bestNx * -0.6 + bestNy * -0.8) * across;
			let shade = 0.66 - across * across * 0.62 + facing * 0.34;
			let flag = FLAG_BODY;
			if (s > shape.dorsal[0] && s < shape.dorsal[1] && across < 0.3) {
				// First dorsal fin, catching the light.
				flag = FLAG_RIDGE;
				shade = 1;
			} else if (s > shape.secondDorsal[0] && s < shape.secondDorsal[1] && across < 0.4) {
				shade = Math.max(shade, 0.82);
			} else if (shape.eye && s > shape.eye[0] && s < shape.eye[1] && across > 0.6) {
				flag = FLAG_EYE;
				shade = 0;
			} else if (s > shape.gills[0] && s < shape.gills[1] && across > 0.58) {
				// Five gill slits.
				if (Math.floor(((s - shape.gills[0]) / (shape.gills[1] - shape.gills[0])) * 5) % 2 === 0) shade *= 0.45;
			} else if (s < 0.05) {
				// Pale snout tip.
				shade = Math.max(shade, 0.7);
			} else if (shape === SHAPES.zebra && s > 0.08 && s < 0.55 && (across < 0.1 || Math.abs(across - 0.6) < 0.08)) {
				// Zebra sharks carry pale ridges down the back.
				shade = Math.max(shade, 0.8);
			} else if (shape.patch !== undefined && shape.patch(s, across, shape.halfWidth(s))) {
				// The pale rim: the belly colour showing over the edge of the back. This is
				// the only cell class in the renderer that paints lighter than the hide.
				flag = FLAG_PALE;
				shade = 1;
			} else if (shape.saddle !== undefined && shape.saddle(s, across, shape.halfWidth(s))) {
				// The grey swoosh behind the dorsal: lighter than the back, darker than the
				// rim. Drawn as its own flag so it cannot inherit the rim's ink.
				flag = FLAG_SADDLE;
				shade = 0.62;
			} else if (this.marked(s, a * bestSign, L, across)) {
				flag = FLAG_MARK;
			}
			this.hitFlag = flag;
			this.hitShade = shade;
			return true;
		}

		const tip = bestSign > 0 ? this.finTipRight : this.finTipLeft;

		// A species with a `paddle` gets a swept, rounded flipper; everything else
		// falls through to the triangular blade below.
		//
		// The paddle is evaluated in polar-ish terms: `t` runs 0 at the body edge to 1
		// at the tip, and at each station the flipper occupies a chord of body length
		// starting at `leading`. That is what produces a rounded tip and a swept
		// leading edge — a triangle cannot, because it has only three vertices and its
		// outer edge is a straight line by construction.
		// `a <= tip` is not a detail. Clamping `a / tip` to 1 without it turns every
		// cell anywhere along the fin's chord into "the fin tip", no matter how far
		// above or below the body it sits — which renders as a spike running off the
		// animal to the edge of the canvas.
		if (shape.paddle !== undefined && tip > 1e-6 && a > 1e-6 && a <= tip) {
			const t = a / tip;
			const { leading, chord } = shape.paddle(t);
			if (u >= L * leading && u <= L * (leading + chord)) {
				this.hitFlag = FLAG_FIN;
				// Brighter toward the tip, so the flipper separates from the body even in
				// a monochrome render.
				this.hitShade = 0.34 + 0.3 * t;
				return true;
			}
		}

		const [p0, p1, p2] = shape.pectoral;
		if (
			shape.paddle === undefined &&
			inTriangle(u, a, L * p0, 0, L * p1, 0, L * p2, tip) &&
			// Falcate (sickle) fins get a concave trailing edge.
			!(shape.falcate && inTriangle(u, a, L * p1, 0, L * (p1 + (p2 - p1) * 0.33), tip * 0.55, L * p2, tip))
		) {
			this.hitFlag = this.marked(s, a * bestSign, L, 0) ? FLAG_MARK : FLAG_FIN;
			this.hitShade = 0.38 + 0.22 * (1 - clamp(a / tip, 0, 1));
			return true;
		}
		const [v0, v1, v2, vr] = shape.pelvic;
		if (
			inTriangle(u, a, L * v0, 0, L * v1, 0, L * v2, L * vr) ||
			// Forked caudal fin.
			(shape.caudal > 0 && inTriangle(u, a, L * 0.86, 0, L * 0.95, 0, L, L * shape.caudal))
		) {
			this.hitFlag = FLAG_FIN;
			this.hitShade = 0.36;
			return true;
		}
		return false;
	}

	/** Whether a body point (s along, v across) falls on a dark marking. */
	private marked(s: number, v: number, L: number, across: number) {
		if (this.shape === SHAPES.tiger) {
			// Wavy vertical bars over the back half, fading out toward the head.
			if (s < 0.2 || s > 0.9 || across > 0.85) return false;
			const wobble = 0.35 * Math.sin((v / L) * 25 + s * 5);
			const bar = Math.sin(s * Math.PI * 2 * 9 + wobble);
			return bar > 0.65 - 0.5 * smoothstep(0.2, 0.42, s) + 0.4 * smoothstep(0.8, 0.9, s);
		}
		if (this.shape === SHAPES.zebra) {
			// Leopard spots on a jittered grid, so they ride along with the skin.
			if (s < 0.07) return false;
			const gu = (s * L) / (L * 0.06);
			const gv = v / (L * 0.045);
			const cu = Math.floor(gu);
			const cv = Math.floor(gv);
			const jx = hash3(cu, cv, this.sharkId) * 0.5 + 0.25;
			const jy = hash3(cu, cv, this.sharkId + 11) * 0.5 + 0.25;
			return (gu - cu - jx) ** 2 + (gv - cv - jy) ** 2 < 0.08;
		}
		return false;
	}

	/**
	 * Build a smooth, undulating render spine from the simulation spine, then
	 * supersample every cell in the shark's bounding box against the shape.
	 * Fully covered cells become solid skin; partial cells become edge glyphs.
	 */
	private rasterizeSharks(sharks: readonly Shark[], t: number) {
		const { sharkFlag, sharkShade, sharkKey, sharkDepth, sharkKind, sharkShadow, spine, arc, cw, ch, cols, rows } = this;
		sharkFlag.fill(0);
		sharkShadow.fill(0);

		for (const sh of sharks) {
			const L = sh.length;
			const N = SHARK_NODES;
			const n = sh.nodes;
			const swim = clamp(sh.speed / 60, 0.4, 1.4);
			this.shape = SHAPES[sh.kind];
			this.sharkId = sh.id;
			const kindIndex = KINDS.indexOf(sh.kind);

			// Travelling body wave, growing toward the tail.
			for (let k = 0; k < N; k++) {
				const s = k / (N - 1);
				const a = Math.max(0, k - 1);
				const b = Math.min(N - 1, k + 1);
				let tx = n[a * 2]! - n[b * 2]!;
				let ty = n[a * 2 + 1]! - n[b * 2 + 1]!;
				const tl = Math.hypot(tx, ty) || 1;
				tx /= tl;
				ty /= tl;
				// Amplitude grows sharply toward the tail (a whale drives with the rear
				// third and holds the head still), and the flukes inherit the same
				// `sh.phase`, so the tail beat and the body wave stay one motion. A larger
				// amplitude than the original 0.05 is deliberate: at 0.05 the last node
				// moved about a cell, which is invisible at 12px cells — the tail looked
				// rigid because it effectively was.
				const amp = L * 0.075 * (0.06 + 0.94 * Math.pow(s, 2.1)) * swim;
				const off = amp * Math.sin(sh.phase - s * 4.4);
				spine[k * 2] = n[k * 2]! - ty * off;
				spine[k * 2 + 1] = n[k * 2 + 1]! + tx * off;
			}
			arc[0] = 0;
			for (let k = 1; k < N; k++) {
				arc[k] =
					arc[k - 1]! +
					Math.hypot(spine[k * 2]! - spine[(k - 1) * 2]!, spine[k * 2 + 1]! - spine[(k - 1) * 2 + 1]!);
			}
			this.arcTotal = arc[N - 1] || 1;

			// The fluke frame, from the last spine segment rather than the body axis.
			//
			// `spine` already carries the travelling body wave, and its amplitude grows
			// toward the tail, so this segment is the liveliest part of the animal. Using
			// it means the flukes inherit that motion instead of sitting still.
			const lastX = spine[(N - 1) * 2]!;
			const lastY = spine[(N - 1) * 2 + 1]!;
			const prevX = spine[(N - 2) * 2]!;
			const prevY = spine[(N - 2) * 2 + 1]!;
			let tax = lastX - prevX;
			let tay = lastY - prevY;
			const tal = Math.hypot(tax, tay) || 1;
			this.tailX = lastX;
			this.tailY = lastY;
			this.tailAx = tax / tal;
			this.tailAy = tay / tal;
			// The beat. Both terms are driven by the same `sh.phase` the body wave uses,
			// so the flukes stay part of one motion rather than pulsing on their own
			// clock.
			//
			// `tailSpan`: the flukes are widest mid-stroke and fold edge-on at the ends
			// of it, which from above is a slow opening and closing.
			this.tailSpan = 1 + 0.19 * Math.sin(sh.phase - 4.4);
			// `tailBeat`: the pair travels fore and aft as it beats — out on the
			// downstroke, in on the recovery. A quarter-cycle behind the span, so the
			// two never peak together; a stroke that opens and travels at the same
			// instant reads as a mechanical pulse.
			this.tailBeat = L * 0.045 * Math.sin(sh.phase - 4.4 + Math.PI / 2) * swim;

			// Bank into turns: the inside fin foreshortens, the outside one spreads.
			const bank = clamp(sh.turn * 0.45, -0.35, 0.35);
			const flex = 1 + 0.06 * Math.sin(sh.phase * 0.5);
			const reachFin = this.shape.pectoral[3];
			this.finTipRight = L * reachFin * flex * (1 - bank);
			this.finTipLeft = L * reachFin * flex * (1 + bank);

			let minX = Infinity;
			let minY = Infinity;
			let maxX = -Infinity;
			let maxY = -Infinity;
			for (let k = 0; k < N; k++) {
				minX = Math.min(minX, spine[k * 2]!);
				maxX = Math.max(maxX, spine[k * 2]!);
				minY = Math.min(minY, spine[k * 2 + 1]!);
				maxY = Math.max(maxY, spine[k * 2 + 1]!);
			}
			const reach = L * 0.36;
			const c0 = Math.max(0, Math.floor((minX - reach) / cw));
			const c1 = Math.min(cols - 1, Math.floor((maxX + reach) / cw));
			const r0 = Math.max(0, Math.floor((minY - reach) / ch));
			const r1 = Math.min(rows - 1, Math.floor((maxY + reach) / ch));
			if (c0 > c1 || r0 > r1) continue;

			const skipBeyond = reach + Math.hypot(cw, ch);
			const shadowDc = Math.round((L * 0.035) / cw) + 1;
			const shadowDr = Math.round((L * 0.02) / ch) + 1;

			for (let r = r0; r <= r1; r++) {
				for (let c = c0; c <= c1; c++) {
					const x = c * cw;
					const y = r * ch;
					const centerHit = this.sampleShark(x + cw / 2, y + ch / 2, L);
					if (!centerHit && this.hitDist > skipBeyond) continue;
					const flag = this.hitFlag;
					const shade = this.hitShade;
					const s = this.hitS;
					const v = this.hitV;

					let hits = centerHit ? 1 : 0;
					for (let k = 0; k < SUBSAMPLES.length; k += 2) {
						if (this.sampleShark(x + SUBSAMPLES[k]! * cw, y + SUBSAMPLES[k + 1]! * ch, L)) hits++;
					}
					if (hits === 0) continue;
					const coverage = hits / 5;

					const i = r * cols + c;
					// Body-anchored key so each glyph rides along with the skin.
					const key = (hash3(Math.round(s * 52), Math.round(v / (cw * 0.9)), sh.id) * 4294967295) >>> 0;
					sharkKey[i] = key;
					sharkDepth[i] = sh.depth;
					sharkKind[i] = kindIndex;

					if (centerHit && coverage >= 0.6) {
						sharkFlag[i] = flag;
						sharkShade[i] = clamp(shade, 0, 1);
						const sc = c + shadowDc;
						const sr = r + shadowDr;
						if (sc < cols && sr < rows) sharkShadow[sr * cols + sc] = 1;
					} else {
						sharkFlag[i] = FLAG_EDGE;
						sharkShade[i] = coverage;
					}
				}
			}
		}
	}

	private drawSharks(t: number) {
		const { ctx, cols, rows, cw, ch, sharkFlag, sharkShade, sharkKey, sharkDepth, sharkKind, theme } = this;
		const n = cols * rows;
		// In the dark scheme a shark is a lit block with dark glyphs cut out of it;
		// in the light scheme the same silhouette is inked in.
		const glyphOnSkin = theme.isDark ? "#0e0f13" : "#f2f6ff";
		const glyphOnShade = theme.isDark ? "#1b1d24" : "#dde6f5";
		// A crest of light on the hide — one step up from the skin glyph, nowhere near
		// white. In the dark scheme the glyphs are dark on a lit block, so the highlight
		// goes *darker* than the normal glyph; that reads as a glint without punching a
		// hole in the animal.
		const glyphHighlight = theme.isDark ? "#4a5262" : "#8fa0bb";
		for (let i = 0; i < n; i++) {
			const flag = sharkFlag[i]!;
			if (!flag) continue;
			const col = i % cols;
			const row = (i / cols) | 0;
			const x = col * cw;
			const y = row * ch;
			const key = sharkKey[i]!;
			const shade = sharkShade[i]!;
			const dim = (0.7 + 0.3 * sharkDepth[i]!) * theme.strength;
			const [tr, tg, tb] = SHAPES[KINDS[sharkKind[i]!]!]!.tint;

			// Colours re-roll on a staggered clock so the hide shimmers.
			const tick = Math.floor(t * 2.4 + (key % 997) / 97);
			const roll = hash3(key, tick, 7);

			if (flag === FLAG_EDGE) {
				// Soft outline: no block, just a light glyph.
				const set = shade >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT;
				const g = theme.isDark ? 70 + shade * 80 : 96 + (1 - shade) * 92;
				ctx.fillStyle =
					roll < 0.07
						? theme.accent[this.accentIdx[i]! % theme.accent.length]!
						: `rgb(${Math.round(g * tr)},${Math.round(g * tg)},${Math.round(g * tb)})`;
				ctx.globalAlpha = theme.strength;
				ctx.fillText(set[(key >>> 8) % set.length]!, x + cw / 2, y + ch / 2 + 1);
				ctx.globalAlpha = 1;
				continue;
			}

			// A slow shimmer travels down the body. It has to be a wave, not a per-cell
			// random: the block fill is flat, so any high-frequency variation reads as
			// static rather than as skin catching the light.
			// Powered up so the crest is a thin band rather than a wide plateau. A raw
			// sine spends a surprising amount of its cycle near its extremes, which is
			// why the highlight covered a third of the body even at a 0.985 threshold.
			const shimmer = Math.pow(0.5 + 0.5 * Math.sin(shade * 7 + t * 1.7), 6);

			let level: number;
			let glyph: string;
			if (flag === FLAG_SADDLE) {
				// A mid grey block: brighter than the hide, nowhere near the pale rim.
				level = theme.isDark ? 92 : 208;
				glyph = SKIN_RAMP[(key >>> 8) % SKIN_RAMP.length]!;
			} else if (flag === FLAG_PALE) {
				// Near-white and almost glyph-free. The patch is 3-4 cells across at the
				// size this renders, so any glyph variety inside it breaks it into a
				// dotted texture; a single sparse mark per cell keeps it reading as one
				// solid slab of white, which is the whole point of the marking.
				level = theme.isDark ? 250 : 252;
				glyph = ".";
			} else if (flag === FLAG_RIDGE) {
				level = 226;
				glyph = RIDGE_GLYPHS[(key >>> 8) % RIDGE_GLYPHS.length]!;
			} else if (flag === FLAG_EYE) {
				level = 12;
				glyph = "o";
			} else if (flag === FLAG_MARK) {
				level = 24 + shade * 22;
				glyph = MARK_GLYPHS[(key >>> 8) % MARK_GLYPHS.length]!;
			} else if (flag === FLAG_FIN) {
				level = 40 + shade * 120;
				glyph = FIN_GLYPHS[(key >>> 8) % FIN_GLYPHS.length]!;
			} else {
				level = 46 + shade * 160;
				// The ramp step is driven by shade alone. A per-cell offset here is what
				// turned the back into confetti before.
				glyph = SKIN_RAMP[clamp(Math.floor((1 - shade) * 8.99), 0, SKIN_RAMP.length - 1)]!;
			}
			// The light scheme mirrors the ramp, so a bright level becomes dark ink.
			const lit = level * dim;
			// Light scheme: the same silhouette as dark ink on paper. The hide sits in a
			// narrow band of pale greys so the punched-out glyphs carry the shape; a wide
			// band would turn every shark into a slab of mid-grey.
			const ink = theme.isDark ? lit : 236 - (level / 255) * 92;
			// The species tint multiplies the hide — except for the pale markings, which
			// are meant to read as white against it. Multiplying those by an orca's
			// blue-grey tint is exactly what made the eye patch invisible: 244 * 0.44 is
			// a mid grey, which is the same value the surrounding hide already had.
			const pale = flag === FLAG_PALE;
			const tintR = pale ? 1 : tr;
			const tintG = pale ? 1 : tg;
			const tintB = pale ? 1 : tb;
			ctx.globalAlpha = theme.isDark ? 1 : 0.92;
			ctx.fillStyle = `rgb(${Math.min(255, Math.round(ink * tintR))},${Math.min(255, Math.round(ink * tintG))},${Math.min(255, Math.round(ink * tintB))})`;
			ctx.fillRect(x + 1, y + 1, Math.max(1, cw - 1), Math.max(1, ch - 1));

			// Accents travel as one band down the body rather than lighting up single
			// cells. Per-cell noise here reads as broken pixels, not as a fish.
			const band = Math.sin(key / 4294967295 * 12 + t * 1.3);
			const patch = band > 0.93;
			let color: string;
			if (flag === FLAG_SADDLE) color = theme.isDark ? "#5b6472" : "#9aa6b8";
			else if (flag === FLAG_PALE) color = theme.isDark ? "#8e97a6" : "#b9c2d0";
			else if (flag === FLAG_EYE) color = theme.isDark ? "#9aa0ad" : "#c9d3e2";
			else if (flag === FLAG_MARK) color = `rgb(${Math.round(70 * tr)},${Math.round(70 * tg)},${Math.round(70 * tb)})`;
			else if (patch) color = theme.accent[this.accentIdx[i]! % theme.accent.length]!;
			// The highlight used to be pure #ffffff, and that was a bug the eye caught
			// before the profiler did: the wave sweeps in 3.7s, so for about a second it
			// painted up to half the body in white glyphs — the whale visibly flashed
			// white. A highlight should lift the ink a little, not invert the animal.
			// The threshold is also much tighter (0.985 vs 0.93), so only the crest of
			// the wave grazes it, for a few cells at a time.
			else if (shimmer > 0.985) color = glyphHighlight;
			else color = shade > 0.55 ? glyphOnSkin : glyphOnShade;
			ctx.fillStyle = color;
			ctx.globalAlpha = theme.isDark ? 1 : 0.92;
			ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
			ctx.globalAlpha = 1;
		}
	}

	// ── fish, dots, heat ──────────────────────────────────────────────

	/**
	 * Snap each fish to a cell and bucket it by brightness: far fish are dim,
	 * near fish brighter, and turning or panicking fish glint. Nearer fish claim a
	 * cell first when two land in the same one.
	 */
	private markFish(world: World) {
		const { fishStamp, fishBuckets, sharkFlag } = this;
		const frame = ++this.frameId;
		for (const bucket of fishBuckets) bucket.length = 0;
		for (let pass = 0; pass < 2; pass++) {
			for (const f of world.fish) {
				if (!f.alive || (f.depth > 0.78 ? 0 : 1) !== pass) continue;
				const i = this.cellIndex(f.x, f.y);
				if (i < 0 || fishStamp[i] === frame || sharkFlag[i]) continue;
				fishStamp[i] = frame;
				const glint = clamp(Math.abs(f.turn) / 3.5, 0, 1);
				const v = 0.3 + (0.4 * (f.depth - 0.55)) / 0.45 + 0.3 * Math.max(glint, f.alarm);
				fishBuckets[clamp(Math.floor(v * FISH_ALPHAS.length), 0, FISH_ALPHAS.length - 1)]!.push(i);
			}
		}
	}

	private drawFish() {
		const { ctx, cw, ch, cols, fishBuckets } = this;
		for (let b = 0; b < fishBuckets.length; b++) {
			const bucket = fishBuckets[b]!;
			if (!bucket.length) continue;
			ctx.fillStyle = this.fishStyles[b]!;
			for (const i of bucket) {
				ctx.fillText("-", (i % cols) * cw + cw / 2, ((i / cols) | 0) * ch + ch / 2 + 1);
			}
		}
	}

	private drawHeat() {
		const { ctx, heat, cols, cw, ch, theme } = this;
		for (let i = 0; i < heat.length; i++) {
			const h = heat[i]!;
			if (h < 0.08) continue;
			const col = i % cols;
			const row = (i / cols) | 0;
			const alpha = Math.min(0.85, h) * theme.strength;
			ctx.fillStyle = theme.isDark
				? h > 0.5
					? `rgba(255,130,70,${alpha.toFixed(2)})`
					: `rgba(225,60,50,${(alpha * 1.4).toFixed(2)})`
				: h > 0.5
					? `rgba(176,58,24,${alpha.toFixed(2)})`
					: `rgba(150,32,28,${(alpha * 1.3).toFixed(2)})`;
			ctx.fillText(h > 0.6 ? "*" : "·", col * cw + cw / 2, row * ch + ch / 2 + 1);
		}
	}

	/**
	 * Draw the water: the cell grid, then the wake.
	 *
	 * The grid is the ASCII-ness of the whole thing. It is stroked once into an
	 * offscreen canvas on every resize and blitted per frame — stroking a few
	 * hundred paths at 60 Hz would cost more than the entire simulation.
	 *
	 * The wake is the only thing that moves under the fish: disturbed cells light up
	 * and fade, and nothing else is drawn at all. That restraint is what keeps a
	 * field of ~10k cells from turning into visual noise behind a headline.
	 * @param t - Simulation time, seconds.
	 */
	private drawDots(t: number) {
		const { ctx, cols, cw, ch, energy, sharkFlag, fishStamp, frameId, theme, bg } = this;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		if (bg !== null) ctx.drawImage(bg, 0, 0);
		ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

		const n = cols * this.rows;
		const size = Math.max(1.5, Math.round(cw * 0.16));
		const ox = cw * 0.62 - size / 2;
		const oy = ch * 0.62 - size / 2;
		const { bucketOf, bucketOrder, bucketCounts } = this;
		const SKIP = bucketCounts.length - 1;
		bucketCounts.fill(0);
		for (let i = 0; i < n; i++) {
			const e = energy[i]!;
			if (sharkFlag[i] || fishStamp[i] === frameId || e < 0.5) {
				bucketOf[i] = SKIP;
				continue;
			}
			const level = clamp(Math.floor((e - 0.5) * 5), 0, ALPHA_LEVELS - 1);
			bucketOf[i] = level;
			bucketCounts[level]!++;
		}
		const starts = new Int32Array(bucketCounts.length);
		for (let b = 1; b < bucketCounts.length; b++) starts[b] = starts[b - 1]! + bucketCounts[b - 1]!;
		const cursor = starts.slice();
		for (let i = 0; i < n; i++) {
			const b = bucketOf[i]!;
			if (b !== SKIP) bucketOrder[cursor[b]!++] = i;
		}
		const wake = theme.wake;
		for (let b = 0; b < SKIP; b++) {
			const count = bucketCounts[b]!;
			if (!count) continue;
			const alpha = ((b + 1) / ALPHA_LEVELS) * 0.8 * theme.strength;
			ctx.fillStyle = `rgba(${wake[0]},${wake[1]},${wake[2]},${alpha.toFixed(3)})`;
			const start = starts[b]!;
			for (let k = start; k < start + count; k++) {
				const i = bucketOrder[k]!;
				ctx.fillRect(Math.round((i % cols) * cw + ox), Math.round(((i / cols) | 0) * ch + oy), size, size);
			}
		}
		void t;
	}

	/**
	 * Stroke the cell grid into the offscreen canvas, snapped to device pixels.
	 *
	 * A half-pixel offset is what keeps a 1px line from being drawn as two grey ones;
	 * at 5% alpha that difference is the whole difference between "a grid" and "a
	 * smudge".
	 */
	private paintGrid() {
		const { width: W, height: H, dpr, cw, ch } = this;
		if (this.bg === null) this.bg = document.createElement("canvas");
		const bg = this.bg;
		bg.width = this.canvas.width;
		bg.height = this.canvas.height;
		const g = bg.getContext("2d");
		if (g === null) return;
		g.setTransform(1, 0, 0, 1, 0, 0);
		g.clearRect(0, 0, bg.width, bg.height);
		const dark = this.theme.isDark;
		g.strokeStyle = dark ? "rgba(255,255,255,0.042)" : "rgba(15,17,21,0.028)";
		g.lineWidth = 1;
		g.beginPath();
		for (let c = 0; c <= Math.ceil(W / cw); c++) {
			const x = Math.round(c * cw * dpr) + 0.5;
			g.moveTo(x, 0);
			g.lineTo(x, bg.height);
		}
		for (let r = 0; r <= Math.ceil(H / ch); r++) {
			const y = Math.round(r * ch * dpr) + 0.5;
			g.moveTo(0, y);
			g.lineTo(bg.width, y);
		}
		g.stroke();
	}
}
