/**
 * The settings surface, in two seats.
 *
 * `SettingsRow` is the block inside the General section — the quick switch most
 * readers want. `OceanSection` is this plugin's own page in the settings nav, which
 * exists for a different reason: the shell's Plugins page lists only its own shipped
 * bundles, so a third-party client plugin has no entry there at all. This page is
 * where it becomes *findable* — a named row in the settings nav, with the whole
 * control set and the live state of the engine.
 *
 * Both render the same controls from the same store, so no value can disagree
 * between the two seats.
 *
 * Sits in the shell's General section through `settings.general.item`, so it
 * inherits the page's own type scale, dividers, and theme tokens instead of
 * inventing a parallel look. Every control writes the shared store, which the
 * ocean surface is subscribed to — there is no second copy of the state anywhere.
 * @module ascii-sharks/settings-row
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ConfigStore, OceanConfig } from "./store";
import type { SharkKind } from "./world";

/** Species a pod can be made of. */
const KINDS: readonly SharkKind[] = [
	"orca", "classic", "greathammer", "hammerhead", "mako",
	"nurse", "thresher", "tiger", "zebra",
];

/** What the shell passes in, plus this plugin's own face. */
export interface RowProps {
	readonly store: ConfigStore;
	readonly t: (key: string) => string;
}

const ROW: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: 16,
	padding: "16px 0",
	borderBottom: "0.5px solid var(--dsw-alias-border-l1)",
};
const TITLE: React.CSSProperties = {
	fontSize: 14,
	lineHeight: "22px",
	color: "var(--dsw-alias-label-primary)",
};
const DESC: React.CSSProperties = {
	fontSize: 12,
	lineHeight: "18px",
	color: "var(--dsw-alias-label-caption)",
};

/**
 * A shell-shaped toggle.
 *
 * A real `<button role="switch">` rather than a checkbox: the shell's own switches
 * are buttons, and a checkbox here would pick up the browser's focus ring and
 * platform-style tick, which reads as a foreign control on this page.
 */
function Switch({ on, onChange }: { on: boolean; onChange: () => void }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={on}
			onClick={onChange}
			style={{
				position: "relative",
				flex: "none",
				width: 36,
				height: 20,
				borderRadius: 999,
				border: "none",
				cursor: "pointer",
				padding: 0,
				background: on ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-border-l4)",
				transition: "background 140ms ease",
			}}
		>
			<span
				style={{
					position: "absolute",
					top: 2,
					left: on ? 18 : 2,
					width: 16,
					height: 16,
					borderRadius: 999,
					background: on ? "var(--dsw-alias-bg-base)" : "var(--dsw-alias-bg-base)",
					boxShadow: "0 0 0 0.5px var(--dsw-alias-border-l3)",
					transition: "left 140ms ease",
				}}
			/>
		</button>
	);
}

/**
 * One species choice, as a pill.
 *
 * Extracted because there are now two kinds of entry in the same row — a named
 * species and the random mode — and they have to look like one control set while
 * still reading as different things.
 */
function Chip({ label, on, onClick, emphasis }: { label: string; on: boolean; onClick: () => void; emphasis?: boolean }) {
	return (
		<button
			type="button"
			aria-pressed={on}
			onClick={onClick}
			style={{
				font: `500 11px/18px var(--ds-font-family-code, ui-monospace, Menlo, monospace)`,
				padding: "2px 8px",
				borderRadius: 999,
				cursor: "pointer",
				border: `0.5px solid ${on ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-border-l4)"}`,
				background: on ? "var(--dsw-alias-state-business-tertiary)" : "transparent",
				color: on ? "var(--dsw-alias-label-primary-bluish)" : "var(--dsw-alias-label-secondary)",
				// The random chip sits slightly apart from the species list so the eye does
				// not read it as the tenth species.
				marginRight: emphasis === true ? 6 : 0,
			}}
		>
			{label}
		</button>
	);
}

/**
 * A small stepper button.
 *
 * A count is a number the reader nudges one at a time, and a slider is the wrong
 * control for it: at these values every pixel is a whole animal. Two buttons and a
 * readout keep the value discrete and legible.
 */
function StepButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={label === "+" ? "one more" : "one fewer"}
			style={{
				width: 26,
				height: 26,
				borderRadius: 6,
				cursor: disabled ? "default" : "pointer",
				opacity: disabled ? 0.4 : 1,
				border: "0.5px solid var(--dsw-alias-border-l4)",
				background: "transparent",
				color: "var(--dsw-alias-label-primary)",
				font: "500 14px/1 var(--ds-font-family-code, ui-monospace, Menlo, monospace)",
			}}
		>
			{label}
		</button>
	);
}

/** One setting row's label block. */
function Label({ title, hint }: { title: string; hint?: string }) {
	return (
		<span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
			<span style={TITLE}>{title}</span>
			{hint === undefined ? null : <span style={DESC}>{hint}</span>}
		</span>
	);
}

/**
 * Whether the reader asked the platform for reduced motion.
 *
 * Subscribed rather than read once: this row is the only place the shell can learn
 * that the ocean is deliberately still, and a stale answer there is worse than no
 * answer. The server snapshot returns false, because a Host render has no MQL.
 */
function useReducedMotion(): boolean {
	return useSyncExternalStore(
		(listener) => {
			if (typeof matchMedia !== "function") return () => undefined;
			const mq = matchMedia("(prefers-reduced-motion: reduce)");
			mq.addEventListener("change", listener);
			return () => mq.removeEventListener("change", listener);
		},
		() => (typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)").matches : false),
		() => false,
	);
}

/**
 * The General-section row.
 * @param props - The shared store and the bound copy function.
 * @returns The complete settings block.
 */
export function SettingsRow({ store, t }: RowProps) {
	const config: OceanConfig = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	const reduced = useReducedMotion();
	const patch = (next: Partial<OceanConfig>) => store.set({ ...config, ...next });

	return (
		<div data-ascii-sharks-row="" style={{ display: "flex", flexDirection: "column" }}>
			<div style={ROW}>
				<Label title={t("title")} hint={reduced ? t("reduced") : t("description")} />
				<Switch on={config.enabled} onChange={() => patch({ enabled: !config.enabled })} />
			</div>

			{config.enabled ? (
				<>
					<div style={{ ...ROW, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
						<Label title={t("opacity")} />
						<input
							type="range"
							min={0.1}
							max={1}
							step={0.05}
							value={config.opacity}
							aria-label={t("opacity")}
							onChange={(event) => patch({ opacity: Number(event.currentTarget.value) })}
							style={{ width: "100%", accentColor: "var(--dsw-alias-brand-primary)" }}
						/>
					</div>

					<div style={{ ...ROW, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
						<Label title={t("strength")} />
						<input
							type="range"
							min={0.2}
							max={1}
							step={0.05}
							value={config.strength}
							aria-label={t("strength")}
							onChange={(event) => patch({ strength: Number(event.currentTarget.value) })}
							style={{ width: "100%", accentColor: "var(--dsw-alias-brand-primary)" }}
						/>
					</div>

					<div style={{ ...ROW, alignItems: "center" }}>
						<Label title={t("count")} hint={t("countHint")} />
						<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
							<StepButton
								label="−"
								disabled={config.sharks.length <= 1}
								onClick={() => patch({ sharks: config.sharks.slice(0, config.sharks.length - 1) })}
							/>
							<span
								aria-live="polite"
								style={{
									minWidth: 22,
									textAlign: "center",
									font: "500 13px/20px var(--ds-font-family-code, ui-monospace, Menlo, monospace)",
									color: "var(--dsw-alias-label-primary)",
									fontVariantNumeric: "tabular-nums",
								}}
							>
								{config.sharks.length}
							</span>
							<StepButton
								label="+"
								// The cap is about the background staying a background: past five
								// the hero stops reading as water and starts reading as a scene.
								disabled={config.sharks.length >= 5}
								onClick={() => {
									// A new whale copies the last kind, so a mixed roster keeps its mix
									// as it grows instead of silently becoming all-orcas.
									const last = config.sharks[config.sharks.length - 1] ?? "orca";
									patch({ sharks: [...config.sharks, last] });
								}}
							/>
						</div>
					</div>

					<div style={{ ...ROW, flexDirection: "column", alignItems: "stretch", gap: 8 }}>
						<Label title={t("sharks")} hint={config.randomSpecies ? t("randomHint") : undefined} />
						<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
							{/*
							 * Random is a sibling of the species chips, not a separate row, because it
							 * answers the same question they do: which animal. Selecting it clears the
							 * explicit choice in the UI sense without touching the stored array, so
							 * switching back to a named species returns to what the reader last picked.
							 */}
							<Chip
								label={t("random")}
								on={config.randomSpecies}
								onClick={() => patch({ randomSpecies: !config.randomSpecies })}
								emphasis
							/>
							{KINDS.map((kind) => {
								// While random is on, no named chip is selected: leaving one lit would claim a
								// choice the ocean is not honouring.
								const on = !config.randomSpecies && config.sharks.includes(kind);
								return (
									<Chip
										key={kind}
										label={kind}
										on={on}
										onClick={() => {
											// A chip sets the species of *all* the whales: the count is chosen
											// separately, so per-whale species is a detail nobody asked to manage.
											// Pressing a chip also leaves random mode — an explicit choice should win.
											patch({
												randomSpecies: false,
												sharks: Array.from({ length: config.sharks.length }, () => kind),
											});
										}}
									/>
								);
							})}
						</div>
					</div>

					<div style={{ ...ROW, borderBottom: "none" }}>
						<Label title={t("interactive")} />
						<Switch on={config.interactive} onChange={() => patch({ interactive: !config.interactive })} />
					</div>
				</>
			) : null}
		</div>
	);
}

/**
 * This plugin's own settings page.
 *
 * The status line is not decoration: a background that silently fails to mount (no
 * New Session on screen, reduced motion requested, the ocean switched off) is the
 * hardest kind of bug to report, so the page says which of those is in effect.
 * @param props - The shared store and the bound copy function.
 * @returns The section body.
 */
export function OceanSection({ store, t }: RowProps) {
	const config: OceanConfig = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	const reduced = useReducedMotion();
	const [hero, setHero] = useState<boolean | null>(null);

	// Poll the shell for the phase that decides whether the ocean can draw at all.
	// A subscription would be tighter, but the phase lives on a DOM attribute written
	// by the conversation shell and there is no event for it.
	useEffect(() => {
		const read = () => setHero(document.querySelector("[data-phase=\"hero\"]") !== null);
		read();
		const timer = window.setInterval(read, 900);
		return () => window.clearInterval(timer);
	}, []);

	const state = !config.enabled
		? t("stateOff")
		: reduced
			? t("stateReduced")
			: hero === true
				? t("stateLive")
				: hero === null
					? t("stateUnknown")
					: t("stateIdle");

	return (
		<div data-ascii-sharks-section="" style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: 760 }}>
			<div style={{ display: "flex", alignItems: "baseline", gap: 8, paddingBottom: 4 }}>
				<span style={{ fontSize: 13, lineHeight: "20px", color: "var(--dsw-alias-label-tertiary)" }}>{t("stateLabel")}</span>
				<span
					style={{
						fontSize: 13,
						lineHeight: "20px",
						color: state === t("stateLive") ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-label-secondary)",
					}}
				>
					{state}
				</span>
			</div>
			<SettingsRow store={store} t={t} />
		</div>
	);
}
