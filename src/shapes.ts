/**
 * PORTED CODE — see NOTICE.md and LICENSE before reuse.
 *
 * Derived from https://github.com/stackedlol/ascii-sharks, which had no license
 * file at the time of porting. Copyright in the upstream work remains with its
 * author(s); the MIT license in this repository does NOT cover this file.
 */
/**
 * Shark silhouettes, described as mathematics rather than stored as pictures.
 *
 * Every entry is a top-down plan view of one species, expressed as fractions of
 * the shark's own length: a half-width profile along the body (`s` = 0 at the
 * snout, 1 at the tail tip), plus fin roots and reaches. Keeping it parametric
 * is what lets one renderer draw eight species at any length without a single
 * asset: the body wave, the banking fins, and the anti-aliased edge all follow
 * from these numbers.
 *
 * The proportions are drawn from the usual field-guide plan views
 * (Compagno, *Sharks of the World*): a pointed snout and crescent tail for the
 * requiem sharks, the wide cephalofoil for the hammerheads, a whip tail for the
 * thresher, and a flattened, blunt-headed body for the nurse shark.
 *
 * The orca is the one entry that is not a shark, and it is built on the same
 * machinery rather than beside it: `halfWidth` reproduces the body plus the wide
 * paired flukes, `pectoral` gives the rounded paddle flippers, and the white eye
 * patch and saddle are markings — the same `marked()` hook the tiger bars use.
 * @module ascii-sharks/shapes
 */

import { smoothstep } from "./math";
import type { SharkKind } from "./world";

export interface SharkShape {
	/** Half-width across the body at `s`, as a fraction of length. */
	readonly halfWidth: (s: number) => number;
	/** Pectoral fin: leading root, trailing root, tip position along the body, and reach. */
	readonly pectoral: readonly [number, number, number, number];
	/** Notched (falcate) trailing edge on the pectorals. */
	readonly falcate: boolean;
	/** Pelvic fins: leading root, trailing root, tip, reach. */
	readonly pelvic: readonly [number, number, number, number];
	/** Forked caudal fin reach, or 0 when the tail is a ribbon (zebra shark). */
	readonly caudal: number;
	readonly dorsal: readonly [number, number];
	readonly secondDorsal: readonly [number, number];
	/**
	 * A hammerhead's cephalofoil: half-span, how far its tips sweep back, its
	 * depth, and the notch in the middle of the front edge. All fractions of
	 * length; absent for every other shark.
	 */
	readonly head?: { readonly span: number; readonly sweep: number; readonly depth: number; readonly notch: number };
	/** null when the eyes sit somewhere else (hammerhead: on the cephalofoil tips). */
	readonly eye: readonly [number, number] | null;
	readonly gills: readonly [number, number];
	/**
	 * Pale markings that sit *on* the hide rather than cutting into it.
	 *
	 * Separate from the dark markings (`marked`) because these have to be drawn at a
	 * brightness above the skin, not below it: an orca's eye patch and saddle are the
	 * only reason the silhouette reads as an orca instead of as an unusually blunt
	 * shark. `s` is along the body, `across` is 0 at the spine and 1 at the edge.
	 */
	readonly patch?: (s: number, across: number, halfWidth: number) => boolean;
	/**
	 * The grey saddle behind the dorsal fin.
	 *
	 * Separate from `patch` because it is a different *colour*, not a different place:
	 * the flank rim is white belly-colour, the saddle is grey. Collapsing them into one
	 * flag forces the renderer to pick one ink for both, which is how the saddle ended
	 * up white.
	 */
	readonly saddle?: (s: number, across: number, halfWidth: number) => boolean;
	/**
	 * A flipper drawn as a swept, rounded paddle instead of a triangle.
	 *
	 * The triangle in `pectoral` can express a shark's stiff blade, but not an
	 * orca's rounded paddle: with only three points it either looks like a barb
	 * (thin and straight) or like a bar (wide and rectangular), and at 12px cells it
	 * reads as neither flipper nor fin. This hook takes `t` = how far out along the
	 * flipper (0 at the root, 1 at the tip) and answers the leading edge's position
	 * along the body plus the chord at that station, so the caller can shape a real
	 * paddle. When absent, the triangular `pectoral` path is used.
	 */
	readonly paddle?: (t: number) => { readonly leading: number; readonly chord: number };
	/**
	 * The tail flukes, as two explicit lobes behind the peduncle.
	 *
	 * `halfWidth` is measured from the spine, so every tail it can describe is solid
	 * across the middle: whatever it adds sticks out perpendicular to the body and
	 * rasterises as a crossbar. A forked tail is the one shape that cannot be built
	 * that way, which is why it needs its own geometry.
	 *
	 * All values are fractions of body length. The lobes are mirror images about the
	 * body axis and trail *behind* the tail tip, so `offset` is how far off the axis
	 * each lobe's centre sits, `span` its half-width across, `reach` how far aft it
	 * extends, and `thickness` the half-gap at the axis (i.e. the fork).
	 */
	readonly flukes?: {
		readonly offset: number;
		readonly span: number;
		readonly reach: number;
	};
	/**
	 * A cut *out* of the silhouette, in body coordinates.
	 *
	 * `halfWidth` returns the distance from the spine to the edge, so any profile it
	 * can express is solid all the way across the middle. A forked tail is exactly the
	 * opposite: two lobes with a gap between them. This hook is what makes that
	 * expressible — returning true means the point is *not* on the animal, so the
	 * anti-aliasing pass draws a real gap instead of a filled fan.
	 */
	readonly notch?: (s: number, across: number) => boolean;
	/** Skin colour multipliers (r, g, b). */
	readonly tint: readonly [number, number, number];
}

/** Classic top-down half-width at s in [0, 1] (snout to tail), as a fraction of length. */
function classicHalfWidth(s: number) {
	if (s < 0.13) return 0.09 * Math.pow(Math.sin(((s / 0.13) * Math.PI) / 2), 0.95);
	if (s < 0.3) return 0.09 + 0.016 * smoothstep(0.13, 0.3, s);
	if (s < 0.84) return 0.019 + 0.087 * Math.pow(1 - (s - 0.3) / 0.54, 1.25);
	const k = (s - 0.84) / 0.16;
	return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);
}

/**
 * Orca plan view: a blunt, rounded head; the widest point just behind it; a hard
 * taper to the tail stock; then the paired flukes, which spread wider than any
 * part of the body.
 *
 * The flukes are why this cannot reuse a shark profile. A shark's tail narrows
 * into a fin; an orca's widens into a horizontal fan with a notch at the centre,
 * and that fan is the single most recognisable thing about it from above.
 */
function orcaHalfWidth(s: number) {
	// Guard the endpoints: `Math.pow` of a negative base is NaN, and the renderer
	// samples s across every cell of the spine including both ends.
	if (s <= 0) return 0.075;
	if (s >= 1) return 0.004;

	// An orca is not merely a fat shark — from above it is *stout*, and that stoutness
	// is the only thing that survives at 33 cells long. At the sizes this background
	// actually renders, a shark profile is 7 cells wide and an orca at realistic
	// proportions is also 7 cells wide, which is why the first attempt read as "a
	// blunt shark". These widths are deliberately exaggerated past field-guide
	// proportions so the silhouette still says orca at a glance.
	if (s < 0.12) return 0.066 + 0.046 * Math.sqrt(s / 0.12);
	if (s < 0.3) return 0.112 + 0.010 * smoothstep(0.12, 0.3, s);
	// A hard taper to a narrow peduncle. Two grid cells is the floor: below that the
	// flukes detach into a floating blob of their own.
	if (s < 0.78) return 0.030 + 0.092 * Math.pow(1 - (s - 0.3) / 0.48, 1.35);

	// The peduncle, and nothing more: this profile ends where the flukes begin.
	// The lobes themselves are `flukes` below, because a symmetric half-width cannot
	// express a fork — anything it adds is solid across the spine.
	const k = (s - 0.78) / 0.22;
	return Math.max(0.012, 0.034 * (1 - k * 0.9));
}

export const SHAPES: Record<SharkKind, SharkShape> = {
	// The default requiem plan: tapered snout, broad back, crescent tail.
	classic: {
		halfWidth: classicHalfWidth,
		pectoral: [0.15, 0.43, 0.55, 0.26],
		falcate: true,
		pelvic: [0.57, 0.65, 0.69, 0.085],
		caudal: 0.085,
		dorsal: [0.33, 0.47],
		secondDorsal: [0.71, 0.76],
		eye: [0.1, 0.14],
		gills: [0.19, 0.29],
		tint: [0.92, 0.97, 1.05],
	},
	// Slim neck under a wide, swept-back cephalofoil (drawn in sampleShark),
	// tall first dorsal, long upper tail lobe. Bronze-olive grey.
	hammerhead: {
		halfWidth: (s) => {
			if (s < 0.06) return 0.045;
			if (s < 0.3) return 0.045 + 0.061 * smoothstep(0.06, 0.3, s);
			return classicHalfWidth(s) * 0.92;
		},
		head: { span: 0.17, sweep: 0.035, depth: 0.09, notch: 0 },
		pectoral: [0.17, 0.4, 0.5, 0.22],
		falcate: true,
		pelvic: [0.56, 0.63, 0.67, 0.075],
		caudal: 0.11,
		dorsal: [0.28, 0.44],
		secondDorsal: [0.7, 0.74],
		eye: null,
		gills: [0.16, 0.26],
		tint: [0.96, 0.98, 0.9],
	},
	// Blunt, square snout on a heavy body; barred back. Warm grey-brown.
	tiger: {
		halfWidth: (s) => {
			if (s < 0.13) return 0.1 * Math.pow(Math.sin(((s / 0.13) * Math.PI) / 2), 0.45);
			if (s < 0.3) return 0.1 + 0.014 * smoothstep(0.13, 0.3, s);
			if (s < 0.84) return 0.019 + 0.095 * Math.pow(1 - (s - 0.3) / 0.54, 1.2);
			const k = (s - 0.84) / 0.16;
			return 0.019 * (1 - k) + 0.012 * Math.sin(k * Math.PI);
		},
		pectoral: [0.15, 0.42, 0.53, 0.25],
		falcate: true,
		pelvic: [0.57, 0.65, 0.69, 0.085],
		caudal: 0.095,
		dorsal: [0.33, 0.46],
		secondDorsal: [0.71, 0.75],
		eye: [0.08, 0.12],
		gills: [0.19, 0.28],
		tint: [1.02, 0.95, 0.84],
	},
	// Short rounded head, body done by half-length, then a long ribbon of a
	// tail fin. Broad rounded pectorals, spotted sandy skin.
	zebra: {
		halfWidth: (s) => {
			if (s < 0.1) return 0.075 * Math.pow(Math.sin(((s / 0.1) * Math.PI) / 2), 0.7);
			if (s < 0.28) return 0.075 + 0.025 * smoothstep(0.1, 0.28, s);
			if (s < 0.55) return 0.022 + 0.078 * Math.pow(1 - (s - 0.28) / 0.27, 1.1);
			const k = (s - 0.55) / 0.45;
			return 0.022 * (1 - k * k) + 0.012 * Math.sin(k * Math.PI);
		},
		pectoral: [0.12, 0.3, 0.36, 0.19],
		falcate: false,
		pelvic: [0.42, 0.48, 0.51, 0.065],
		caudal: 0,
		dorsal: [0.36, 0.44],
		secondDorsal: [0.49, 0.53],
		eye: [0.06, 0.09],
		gills: [0.13, 0.2],
		tint: [1.08, 0.97, 0.74],
	},
	// Great hammerhead: a broader, nearly straight-edged cephalofoil with a notch
	// at the centre, a towering sickle first dorsal, and a cooler slate skin.
	greathammer: {
		halfWidth: (s) => {
			if (s < 0.05) return 0.04;
			if (s < 0.3) return 0.04 + 0.07 * smoothstep(0.05, 0.3, s);
			return classicHalfWidth(s) * 0.95;
		},
		head: { span: 0.21, sweep: 0.006, depth: 0.085, notch: 0.014 },
		pectoral: [0.16, 0.38, 0.49, 0.24],
		falcate: true,
		pelvic: [0.55, 0.62, 0.67, 0.085],
		caudal: 0.13,
		dorsal: [0.24, 0.45],
		secondDorsal: [0.68, 0.74],
		eye: null,
		gills: [0.15, 0.25],
		tint: [0.86, 0.93, 1.02],
	},
	// Shortfin mako: a long conical snout, a torpedo body that narrows hard to the
	// tail stalk, and a tall crescent tail. Metallic indigo back.
	mako: {
		halfWidth: (s) => {
			if (s < 0.17) return 0.088 * Math.pow(Math.sin(((s / 0.17) * Math.PI) / 2), 1.5);
			if (s < 0.32) return 0.088 + 0.012 * smoothstep(0.17, 0.32, s);
			if (s < 0.86) return 0.014 + 0.086 * Math.pow(1 - (s - 0.32) / 0.54, 1.45);
			const k = (s - 0.86) / 0.14;
			return 0.014 * (1 - k) + 0.01 * Math.sin(k * Math.PI);
		},
		pectoral: [0.18, 0.4, 0.5, 0.21],
		falcate: true,
		pelvic: [0.58, 0.64, 0.68, 0.06],
		caudal: 0.13,
		dorsal: [0.34, 0.45],
		secondDorsal: [0.76, 0.79],
		eye: [0.11, 0.15],
		gills: [0.2, 0.3],
		tint: [0.78, 0.9, 1.2],
	},
	// Thresher: a compact body over the front half, then the upper tail lobe as a
	// long whip that is as long as the shark itself. Big eyes, long sickle
	// pectorals, bronze-violet skin.
	thresher: {
		halfWidth: (s) => {
			if (s < 0.08) return 0.07 * Math.pow(Math.sin(((s / 0.08) * Math.PI) / 2), 0.75);
			if (s < 0.2) return 0.07 + 0.02 * smoothstep(0.08, 0.2, s);
			if (s < 0.48) return 0.012 + 0.078 * Math.pow(1 - (s - 0.2) / 0.28, 1.3);
			// The whip: thin, with a slight sickle swell before it tapers out.
			const k = (s - 0.48) / 0.52;
			return 0.012 * (1 - k) + 0.006 * Math.sin(k * Math.PI * 0.9) + 0.002;
		},
		pectoral: [0.12, 0.27, 0.36, 0.2],
		falcate: true,
		pelvic: [0.37, 0.41, 0.44, 0.045],
		caudal: 0,
		dorsal: [0.24, 0.32],
		secondDorsal: [0.45, 0.47],
		eye: [0.05, 0.1],
		gills: [0.11, 0.18],
		tint: [1.0, 0.9, 1.08],
	},
	// Nurse shark: a blunt, broad head, a heavy flattened body with both dorsals
	// set far back, rounded paddle pectorals, and a long low tail with no lower
	// lobe. Tawny brown.
	nurse: {
		halfWidth: (s) => {
			if (s < 0.08) return 0.085 * Math.pow(Math.sin(((s / 0.08) * Math.PI) / 2), 0.4);
			if (s < 0.3) return 0.085 + 0.02 * smoothstep(0.08, 0.3, s);
			if (s < 0.72) return 0.022 + 0.083 * Math.pow(1 - (s - 0.3) / 0.42, 1.1);
			const k = (s - 0.72) / 0.28;
			return 0.022 * (1 - k * k) + 0.014 * Math.sin(k * Math.PI);
		},
		pectoral: [0.16, 0.34, 0.4, 0.17],
		falcate: false,
		pelvic: [0.45, 0.52, 0.55, 0.075],
		caudal: 0,
		dorsal: [0.5, 0.58],
		secondDorsal: [0.63, 0.69],
		eye: [0.05, 0.075],
		gills: [0.14, 0.22],
		tint: [1.1, 0.96, 0.76],
	},
	// Orca: not a shark, and drawn from its own profile above. Deep slate back, a
	// tall forward dorsal fin, no gill slits, and the two things everyone actually
	// recognises — the white eye patch and the paired flukes.
	orca: {
		halfWidth: orcaHalfWidth,
		// Rounded paddle flippers, not the shark's sickle: falcate must stay false
		// or the concave trailing edge would cut the paddle into a blade.
		//
		// `reach` was 0.20L, which at the size this renders left the paddle protruding
		// only 2.3 cells past the body edge — present in the geometry, invisible on
		// screen. 0.30L puts about 5 cells of flipper outside the body on each side,
		// and the roots start further forward because an orca's flippers sit just
		// behind the eye, not amidships.
		pectoral: [0.12, 0.28, 0.33, 0.27],
		falcate: false,
		/**
		 * The flipper, as a rounded paddle.
		 *
		 * `t` runs from the shoulder (0) to the tip (1). An orca's flipper is a broad
		 * oval that sweeps *backward* as it goes out, so the leading edge marches aft
		 * and the chord swells in the middle. The reach is 0.30L, which puts about 5
		 * cells of flipper outside the body at the size this renders — enough to read
		 * as a flipper rather than a nick in the silhouette.
		 */
		paddle: (t) => ({
			// The leading edge sweeps aft as it goes out.
			leading: 0.125 + 0.115 * Math.pow(t, 0.9),
			// The chord has to stay wide most of the way out. A true ellipse tapers
			// smoothly to zero and the tip becomes a one-cell needle — at 12px cells
			// that is a spike, not a flipper. This is an ellipse with a floor: it keeps
			// two cells of width right to the rounded end.
			chord: 0.038 + 0.062 * Math.pow(Math.max(0, 1 - Math.pow(t, 2.2)), 0.45),
		}),
		// Orcas show no pelvic fins from above; the sliver keeps the geometry honest
		// without painting a fin nobody would see.
		pelvic: [0.6, 0.61, 0.62, 0.012],
		// The forked-fin path stays off: `caudal` draws a shark's vertical crescent,
		// while an orca's flukes fan out horizontally. The fork comes from `notch`.
		caudal: 0,
		dorsal: [0.26, 0.4],
		secondDorsal: [0.99, 1],
		eye: [0.09, 0.12],
		// No gill slits at all: an empty range renders nothing.
		gills: [0.99, 1],
		/**
		 * The fork: a wedge cut out of the centre of the flare.
		 *
		 * `across` is 0 on the spine and 1 at the edge. The wedge is narrow at its mouth
		 * (s = 0.86) and wide at the trailing edge, which is what makes the tail end in
		 * two points instead of one. It has to be at least two cells wide at the mouth
		 * to survive the anti-aliasing pass.
		 */
		/**
		 * The flukes: two lobes behind the peduncle with a fork between them.
		 *
		 * Measured against hero scale (a whale is ~40 cells long once the body size is
		 * raised). Each lobe is ~3.4 cells across and ~5.6 cells long, and their inner
		 * edges leave ~1.6 cells of open water on the axis. Those numbers are the
		 * smallest at which a lobe still rasterises as a lobe and the fork as a gap;
		 * anything tighter collapses into a solid paddle, which is the exact defect
		 * this replaces.
		 */
		// offset pushes each lobe off the centreline; span is its half-width; reach is
		// how far aft it trails. Tuned against a 40-cell whale: ~3 cells of lobe, and
		// ~2 cells of open water between the lobes, which is the smallest fork that
		// still rasterises as a fork.
		flukes: { offset: 0.048, span: 0.050, reach: 0.135 },
		/**
		 * The two markings a reader actually recognises: the pale chin, the eye patch,
		 * and the saddle behind the dorsal.
		 *
		 * The eye patch is deliberately oversized. At hero scale the whale is about 7
		 * cells wide, so a faithfully proportioned patch is 2 cells — it reads as noise,
		 * not as a marking. This one covers the outer flank over a fifth of the body,
		 * leaving the dark spine and the dark belly line intact, which is what the
		 * marking looks like from above: two pale patches with black between them.
		 */
		patch: (s, across, halfWidth) => {
			// The markings that make it read as an orca at 40 cells.
			//
			// This went through a detour worth recording. Chasing a scientifically exact
			// dorsal view — NOAA's notes are right that an orca is countershaded and that a
			// top-down animal is mostly black — I removed the eye patch and left only a
			// flank seam. The result was technically defensible and visually dead: at this
			// size the eye patch is the *only* feature that says "orca", and without it the
			// silhouette is just a dark blob with a dorsal fin.
			//
			// So the patch is back, sized for recognition rather than for scale, and the
			// saddle stays grey (which is what it is) instead of white.
			//
			// The pale chin: a sliver at the very front, on both sides.
			if (s < 0.05 && across > 0.35) return true;

			// The eye patch: an oval behind the head, leaned back along the body. At hero
			// scale the whale is ~7 cells across, so a patch drawn to true proportion would
			// be two cells of noise; this one takes the outer flank over a fifth of the
			// body, which is the smallest it can be and still be the thing you recognise.
			if (s > 0.13 && s < 0.33 && across > 0.42) {
				const u = (s - 0.13) / 0.2;
				const v = (across - 0.42) / 0.58;
				if (u * u * 0.9 + (v - 0.5) * (v - 0.5) * 3.2 < 0.95) return true;
			}
			return false;
		},
		/**
		 * The saddle: a grey swoosh between the dorsal fin and the peduncle.
		 *
		 * Grey, not white — that part of the correction was right, and it survives.
		 */
		saddle: (s, across, halfWidth) => {
			if (s <= 0.5 || s >= 0.63 || (1 - across) * halfWidth < 0.03) return false;
			const u = (s - 0.5) / 0.13;
			return Math.sin(u * Math.PI) > 0.3;
		},
		tint: [0.44, 0.5, 0.66],
	},
};

export const KINDS = Object.keys(SHAPES) as SharkKind[];

/** True when `(px, py)` lies inside the triangle `a`, `b`, `c` (either winding). */
export function inTriangle(
	px: number, py: number,
	ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
) {
	const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
	const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
	const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
	const neg = d1 < 0 || d2 < 0 || d3 < 0;
	const pos = d1 > 0 || d2 > 0 || d3 > 0;
	return !(neg && pos);
}
