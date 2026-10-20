/**
 * `dsh-ascii-sharks` — registration only.
 *
 * Two contributions and nothing else:
 *
 *   - `shell.overlay` — the ocean canvas, behind the New Session hero;
 *   - `settings.general.item` — the row that turns it on, sets its density, and
 *     picks the roster.
 *
 * Both read one shared store, so the switch and the water can never disagree.
 * @module ascii-sharks/entry
 */

import { OceanSeat } from "./surface";
import { OceanSection, SettingsRow } from "./settings-row";
import { createConfigStore } from "./store";

/** Locale namespace owning this plugin's copy. */
const NS = "ascii-sharks";

/** Every string this plugin shows, so the shell's language switch covers it. */
const DICTS = {
	en: {
		title: "ASCII ocean",
		description: "An ASCII ocean behind the New Session screen.",
		show: "Show the ocean",
		opacity: "Transparency",
		strength: "Density",
		sharks: "Species of the pod",
		count: "How many",
		countHint: "1 to 5 whales in the water",
		random: "random",
		randomHint: "each whale rolls its own species, fresh every time the ocean comes back",
		interactive: "Scatter the fish with the pointer",
		reduced: "Idle: the OS asked for reduced motion",
		sectionTitle: "ASCII ocean",
		stateLabel: "Status",
		stateLive: "live behind New Session",
		stateIdle: "paused: no New Session on screen",
		stateOff: "switched off",
		stateReduced: "idle: the OS asked for reduced motion",
		stateUnknown: "checking…",
	},
	zh: {
		title: "ASCII 海洋",
		description: "新建会话页的背景里有一片 ASCII 海。",
		show: "显示海洋",
		opacity: "透明度",
		strength: "浓淡",
		sharks: "整群种类",
		count: "数量",
		countHint: "水里有几只（1–5）",
		random: "随机",
		randomHint: "每只各自抽，每次回到新建会话页重新抽过",
		interactive: "鼠标划过时驱散鱼群",
		reduced: "已静止：系统开启了减弱动效",
		sectionTitle: "ASCII 海洋",
		stateLabel: "状态",
		stateLive: "正在新建会话页后面运行",
		stateIdle: "已暂停：当前没有新建会话页",
		stateOff: "已关闭",
		stateReduced: "已静止：系统开启了减弱动效",
		stateUnknown: "检查中…",
	},
} as const;

/**
 * Wire the two seats.
 * @param ctx - The client context this package's half was given.
 */
export function apply(ctx: any) {
	const slots = ctx.get("slots");
	if (slots === undefined || slots === null) {
		// Unreachable while the `inject` below is declared, and deliberately loud if
		// it happens anyway: returning quietly here is how a contribution goes
		// missing for the life of the page with nothing in the console.
		const message = "dsh-ascii-sharks: the slots service is unavailable; nothing was registered";
		ctx.logger?.warn?.(message);
		console.warn(message);
		return;
	}

	/**
	 * Register the dictionaries *when the locale service is there*.
	 *
	 * `ctx.get("locale")` at apply time answers undefined on a cold page load — this
	 * bundle activates before the locale plugin does — and a one-shot `ctx.effect`
	 * that gives up at that point leaves the namespace unregistered for the life of
	 * the page. The symptom is subtle and ugly: every label renders as its own key.
	 * `ctx.inject` instead runs the registration the moment the service appears, and
	 * disposes it again if the service goes away.
	 */
	ctx.inject(["locale"], (localeCtx: any) => {
		const locale = localeCtx.get("locale");
		if (locale === undefined || locale === null) return;
		localeCtx.effect(() => {
			try {
				locale.register(NS, { zh: DICTS.zh, en: DICTS.en });
			} catch (error) {
				console.warn("dsh-ascii-sharks: could not register the dictionaries", error);
			}
		}, "ascii-sharks: locale dictionaries");
	});

	/** Copy, preferring the shell's live locale over this build's own dictionary. */
	const t = (key: string) => {
		try {
			const locale = ctx.get("locale");
			if (locale !== undefined && locale !== null) {
				const translated = locale.bind(NS)(key);
				// A missing namespace entry comes back as the key itself; fall back to
				// the bundled English rather than showing `strength` to the reader.
				if (translated !== key) return translated;
			}
		} catch {
			/* No locale service yet: the bundled dictionary is the whole answer. */
		}
		return (DICTS.en as Record<string, string>)[key] ?? key;
	};

	const store = createConfigStore();

	/**
	 * The shell-owned face both seats are handed.
	 *
	 * The configuration itself is *not* passed down as a prop: the slot renderer
	 * copies an injected face into plain props once, at render, so a value read here
	 * would be frozen at mount. Both seats read the live store through
	 * `useSyncExternalStore` instead, and this face only hands them the store.
	 */
	const face = () => ({ store, t, ctx });

	try {
		ctx.effect(
			() =>
				slots.inject("shell.overlay", () =>
					slots.register(
						{ name: "shell.overlay", id: "ascii-ocean", inject: face },
						OceanSeat,
					),
				),
			"ascii-sharks: ocean surface",
		);
	} catch (error) {
		console.warn(`dsh-ascii-sharks: could not register the ocean (${String(error)})`);
	}

	// The plugin's own page in the settings nav.
	//
	// Not a duplicate of the General row: the shell's Plugins page lists only its own
	// shipped bundles, so a third-party client plugin has no entry anywhere in that
	// list. This is the one place it can be found by name.
	try {
		ctx.effect(
			() =>
				slots.inject("settings.section", () =>
					slots.register(
						{
							name: "settings.section",
							id: "ascii-ocean",
							order: 55,
							label: () => t("sectionTitle"),
							locale: NS,
							inject: face,
						},
						OceanSection,
					),
				),
			"ascii-sharks: settings section",
		);
	} catch (error) {
		console.warn(`dsh-ascii-sharks: could not register the settings section (${String(error)})`);
	}

	try {
		ctx.effect(
			() =>
				slots.inject("settings.general.item", () =>
					slots.register(
						{
							name: "settings.general.item",
							id: "ascii-ocean",
							order: 30,
							locale: NS,
							inject: face,
						},
						SettingsRow,
					),
				),
			"ascii-sharks: settings row",
		);
	} catch (error) {
		console.warn(`dsh-ascii-sharks: could not register the settings row (${String(error)})`);
	}
}

/**
 * Required client services.
 *
 * The slots service owns the registry both seats register into, and on a cold page
 * load it activates *after* this bundle does. Declaring it parks the entry until
 * the service exists and applies it then.
 */
export const inject = ["slots"];
