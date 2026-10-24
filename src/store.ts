/**
 * Copyright (c) 2026 OG Hong — MIT. See LICENSE at the repository root.
 *
 * Persisted preferences for the ocean.
 *
 * A tiny external store with the exact shape `useSyncExternalStore` wants, plus a
 * second fan-out for the canvas surface, which is not a React subscriber. Both
 * read the same value, so the settings row and the background can never disagree
 * about what is switched on.
 *
 * The value lives in `localStorage` and not in the Host's settings document on
 * purpose: this is a per-window visual preference with no server-side meaning, and
 * a browser-scoped value survives a restart without a round trip.
 * @module ascii-sharks/store
 */

import type { SharkKind } from "./world";

export interface OceanConfig {
	/** Whether the ocean renders at all. */
	enabled: boolean;
	/** Opacity multiplier for every layer, 0.2 to 1. */
	strength: number;
	/** Whole-canvas opacity, 0.1 to 1. Lower is more transparent. */
	opacity: number;
	/** Which sharks to seed, biggest first. */
	sharks: SharkKind[];
	/** Whether the pointer scatters the fish. */
	interactive: boolean;
	/**
	 * Roll a new species every time the ocean mounts.
	 *
	 * A mode, not a species: the roster still has `sharks.length` whales, but their
	 * kind is drawn fresh each time the New Session screen comes up. Kept separate
	 * from `sharks` because the two answer different questions — "which animal" and
	 * "how many" — and folding the mode into the array would make a stored random pod
	 * indistinguishable from a deliberately chosen one.
	 */
	randomSpecies: boolean;
}

/** Versioned so a shape change cannot crash on a value written by an older build. */
/**
 * Storage key, versioned.
 *
 * v2 because the shipped default roster changed from four whales to three. Keeping
 * the v1 key would leave every existing profile on the old value with no visible
 * reason — the setting would look broken rather than reset. A version bump gives
 * the new default exactly once, and the reader's own later choices still persist
 * under the new key.
 */
export const STORAGE_KEY = "dsh-ascii-sharks:v2";

export const DEFAULTS: OceanConfig = {
	enabled: true,
	strength: 0.9,
	opacity: 0.72,
	sharks: ["orca", "orca", "orca"],
	interactive: true,
	randomSpecies: false,
};

/** Newest key in the picker order. */
const VALID_KINDS: readonly string[] = [
	"orca", "classic", "greathammer", "hammerhead", "mako",
	"nurse", "thresher", "tiger", "zebra",
];

/**
 * Read the stored configuration, falling back to {@link DEFAULTS} field by field.
 *
 * Each field is validated on its own: a corrupt `sharks` array must not discard a
 * perfectly good `enabled` flag. Storage itself can be unavailable — a sandboxed
 * frame, a reader who blocked site data — in which case the defaults are the only
 * answer, and they are returned rather than an error.
 * @returns A complete, valid configuration.
 */
export function readStored(): OceanConfig {
	let raw: string | null = null;
	try {
		raw = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
	} catch {
		raw = null;
	}
	if (raw === null) return { ...DEFAULTS, sharks: [...DEFAULTS.sharks] };

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ...DEFAULTS, sharks: [...DEFAULTS.sharks] };
	}
	if (parsed === null || typeof parsed !== "object") return { ...DEFAULTS, sharks: [...DEFAULTS.sharks] };

	const value = parsed as Record<string, unknown>;
	const enabled = typeof value.enabled === "boolean" ? value.enabled : DEFAULTS.enabled;
	const interactive = typeof value.interactive === "boolean" ? value.interactive : DEFAULTS.interactive;
	const strength =
		typeof value.strength === "number" && Number.isFinite(value.strength)
			? Math.min(1, Math.max(0.2, value.strength))
			: DEFAULTS.strength;
	const opacity =
		typeof value.opacity === "number" && Number.isFinite(value.opacity)
			? Math.min(1, Math.max(0.1, value.opacity))
			: DEFAULTS.opacity;
	const randomSpecies = typeof value.randomSpecies === "boolean" ? value.randomSpecies : DEFAULTS.randomSpecies;
	const sharks = Array.isArray(value.sharks)
		? value.sharks.filter((kind): kind is SharkKind => VALID_KINDS.includes(kind as string))
		: [];
	return {
		enabled,
		interactive,
		randomSpecies,
		strength,
		opacity,
		sharks: sharks.length > 0 ? sharks : [...DEFAULTS.sharks],
	};
}

/** Species the random mode can roll. Sharks and the whale, all eight kinds. */
const ROLLABLE: readonly SharkKind[] = [
	"orca", "classic", "greathammer", "hammerhead", "mako",
	"nurse", "thresher", "tiger", "zebra",
];

/**
 * The roster this mount should actually draw.
 *
 * Random mode is resolved here rather than in the store for one reason: the pod has
 * to stay the same for the life of a mount and change when the ocean comes back.
 * Rolling inside `getSnapshot` would give a different answer on every React render,
 * which re-runs the engine effect and reshuffles the whales mid-swim; rolling in
 * `set` would freeze the value at click time, so the same pod would return every
 * time the hero reopened. Resolving at mount is the only point with the right
 * lifetime.
 *
 * Each whale rolls its own species. Duplicates are allowed on purpose — with nine
 * kinds and a pod of three, repeats are the common case, and suppressing them would
 * quietly turn "random" into "a sample without replacement", which is a different
 * and more orderly thing than the reader asked for.
 * @param config - The stored configuration.
 * @param roll - A random source in [0, 1); injectable so a test can pin it.
 * @returns Kinds to seed, biggest first.
 */
export function resolveRoster(config: OceanConfig, roll: () => number = Math.random): SharkKind[] {
	const count = Math.max(1, config.sharks.length);
	if (!config.randomSpecies) return config.sharks.slice(0, count);
	const rollOne = () => ROLLABLE[Math.min(ROLLABLE.length - 1, Math.floor(roll() * ROLLABLE.length))]!;
	return Array.from({ length: count }, rollOne);
}

/** A minimal external store over {@link OceanConfig}. */
export interface ConfigStore {
	getSnapshot(): OceanConfig;
	subscribe(listener: () => void): () => void;
	set(next: OceanConfig): void;
}

/**
 * Build the shared store, seeded from storage.
 * @returns The store the row and the surface both read.
 */
export function createConfigStore(): ConfigStore {
	let value = readStored();
	const listeners = new Set<() => void>();
	return {
		getSnapshot: () => value,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		set: (next) => {
			value = next;
			try {
				globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
			} catch {
				/* Storage refused the write; the in-memory value still applies. */
			}
			for (const listener of listeners) listener();
		},
	};
}
