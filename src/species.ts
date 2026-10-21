/**
 * PORTED CODE — see NOTICE.md and LICENSE before reuse.
 *
 * Derived from https://github.com/stackedlol/ascii-sharks, which had no license
 * file at the time of porting. Copyright in the upstream work remains with its
 * author(s); the MIT license in this repository does NOT cover this file.
 */
/**
 * The five schooling species, as parameter tables.
 *
 * Each row is a *behaviour mix*, not art: the same boids solver produces a
 * rotating bait ball, a polarised ribbon, or a loose swarm purely from how much
 * alignment, cohesion, and tangential pull a species carries. The numbers follow
 * the observed ranges in Couzin et al. (2002), "Collective memory and spatial
 * sorting in animal groups", scaled to canvas pixels.
 * @module ascii-sharks/species
 */

export interface Species {
	readonly name: string;
	/** Preferred cruise speed in px/s. */
	readonly cruise: number;
	readonly maxSpeed: number;
	readonly minSpeed: number;
	/** Relative odds of a new school being this species. */
	readonly weight: number;
	/** Inclusive school size range. */
	readonly schoolSize: readonly [number, number];
	/** Personal space in grid cells (x, y), so every fish gets its own glyph. */
	readonly spacing: readonly [number, number];
	/** Velocity matching: high values polarise a school into ribbons. */
	readonly align: number;
	/** Pull toward the local centre of mass. */
	readonly cohesion: number;
	/** Individual restlessness added to the steering force each step. */
	readonly jitter: number;
	/** Tangential pull around the local centre: > 0 makes a rotating bait ball. */
	readonly mill: number;
	/** Damps vertical speed; real fish mostly cruise level. */
	readonly verticalDrag: number;
}

export const SPECIES: readonly Species[] = [
	{
		name: "sardine",
		cruise: 36, maxSpeed: 64, minSpeed: 18, weight: 3,
		schoolSize: [18, 28], spacing: [1.8, 1.1],
		align: 1.6, cohesion: 1.6, jitter: 40, mill: 70, verticalDrag: 0.5,
	},
	{
		name: "anchovy",
		cruise: 46, maxSpeed: 78, minSpeed: 22, weight: 3,
		schoolSize: [20, 32], spacing: [1.5, 1],
		align: 3.2, cohesion: 0.45, jitter: 30, mill: 0, verticalDrag: 1.4,
	},
	{
		name: "silverside",
		cruise: 40, maxSpeed: 70, minSpeed: 20, weight: 3,
		schoolSize: [12, 20], spacing: [2, 1.1],
		align: 2.4, cohesion: 1.1, jitter: 35, mill: 0, verticalDrag: 1.6,
	},
	{
		name: "mackerel",
		cruise: 32, maxSpeed: 60, minSpeed: 16, weight: 2,
		schoolSize: [5, 9], spacing: [2.6, 1.3],
		align: 2, cohesion: 0.9, jitter: 25, mill: 0, verticalDrag: 2,
	},
	{
		name: "goby",
		cruise: 26, maxSpeed: 56, minSpeed: 10, weight: 1,
		schoolSize: [8, 12], spacing: [1.4, 1.1],
		align: 0.35, cohesion: 1.4, jitter: 110, mill: 0, verticalDrag: 0.3,
	},
];

const TOTAL_WEIGHT = SPECIES.reduce((sum, s) => sum + s.weight, 0);

/**
 * Pick a species index with probability proportional to its weight.
 * @returns An index into {@link SPECIES}.
 */
export function pickSpecies() {
	let r = Math.random() * TOTAL_WEIGHT;
	for (let i = 0; i < SPECIES.length; i++) {
		r -= SPECIES[i]!.weight;
		if (r <= 0) return i;
	}
	return 0;
}
