/**
 * PORTED CODE — see NOTICE.md and LICENSE before reuse.
 *
 * Derived from https://github.com/stackedlol/ascii-sharks, which had no license
 * file at the time of porting. Copyright in the upstream work remains with its
 * author(s); the MIT license in this repository does NOT cover this file.
 */
/**
 * Small numeric helpers shared by the simulation and the renderer.
 *
 * Everything here is pure: given the same inputs it answers the same value, so
 * the simulation stays deterministic per fixed step and the renderer's textures
 * never crawl between frames.
 * @module ascii-sharks/math
 */

export const TAU = Math.PI * 2;

/** Clamp `v` into `[lo, hi]`. */
export const clamp = (v: number, lo: number, hi: number) =>
	v < lo ? lo : v > hi ? hi : v;

/** A uniform random number in `[lo, hi)`. */
export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** A uniform random integer in `[lo, hi]`. */
export const randInt = (lo: number, hi: number) =>
	Math.floor(rand(lo, hi + 1));

/** Smooth Hermite interpolation of `x` across `[e0, e1]`. */
export function smoothstep(e0: number, e1: number, x: number) {
	const t = clamp((x - e0) / (e1 - e0), 0, 1);
	return t * t * (3 - 2 * t);
}

/** Shortest signed angle from a to b, in (-PI, PI]. */
export function angleDiff(a: number, b: number) {
	let d = (b - a) % TAU;
	if (d > Math.PI) d -= TAU;
	if (d < -Math.PI) d += TAU;
	return d;
}

/**
 * Cheap integer hash into [0, 1).
 *
 * Deterministic on purpose: the renderer keys every glyph and every dot twinkle
 * off this, so a cell keeps its character from frame to frame instead of
 * flickering through the ramp.
 */
export function hash3(x: number, y: number, z: number) {
	let h =
		Math.imul(x | 0, 374761393) ^
		Math.imul(y | 0, 668265263) ^
		Math.imul(z | 0, 1442695041);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

const K1 = 1 / 260;
const K2 = 1 / 310;
const K3 = 1 / 190;
const CURRENT_SCALE = 3400;

/**
 * A divergence-free ambient current: the curl of a slowly drifting stream
 * function psi(x, y, t).
 *
 * Divergence-free matters more than it looks. A plain sum of sine waves has
 * sources and sinks, and a school drifting into one piles up against an
 * invisible wall; because this field is a curl, it only ever circulates the
 * fish, so the population stays spread out across the whole canvas.
 *
 * @param x - Canvas x in CSS pixels.
 * @param y - Canvas y in CSS pixels.
 * @param t - Simulation time in seconds.
 * @param out - Receives the velocity; reused to avoid per-fish allocation.
 * @returns The same `out` object, for chaining.
 */
export function current(x: number, y: number, t: number, out: { x: number; y: number }) {
	const a = x * K1 + t * 0.07;
	const b = y * K2 - t * 0.05;
	const c = (x + y) * K3 + t * 0.11;
	// u = dpsi/dy, v = -dpsi/dx with psi = sin(a)cos(b) + 0.5 sin(c)
	out.x = (-K2 * Math.sin(a) * Math.sin(b) + 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;
	out.y = (-K1 * Math.cos(a) * Math.cos(b) - 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE;
	return out;
}
