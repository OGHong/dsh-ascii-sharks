# dsh-ascii-sharks

An ASCII ocean behind the New Session screen of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Schools of fish that actually flee orcas, and orcas that actually hunt them. Adapts to the shell's light/dark theme, renders at partial opacity, stops when off-screen, and scatters the fish when the pointer passes through.

> ## 📄 MIT, since 2026-10-24
>
> The simulation is ported from [**stackedlol/ascii-sharks**](https://github.com/stackedlol/ascii-sharks). That project had no license file; on 2026-10-24 it added **MIT** ([`add MIT license`](https://github.com/stackedlol/ascii-sharks/commit/a0074c16a106f0abc665fe9712ca445f8f98ad8e), and the author answered "Added MIT license" on [issue #1](https://github.com/stackedlol/ascii-sharks/issues/1)).
> **This repository is MIT too.** `LICENSE` carries two copyright lines side by side: drewdi (the engine) and OG Hong (orca, DSH wiring, theme, lifecycle). Use it, change it, ship it commercially, redistribute it — keep LICENSE with it. Details in [NOTICE.md](NOTICE.md).

![An ASCII ocean behind the New Session screen](docs/hero-dark.png)

![The ASCII ocean settings page](docs/settings.png)

<p>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue">
  <img alt="dsh" src="https://img.shields.io/badge/DSH-0.2.1--rc.2-lightgrey">
  <img alt="deps" src="https://img.shields.io/badge/runtime%20deps-none-brightgreen">
</p>

## What it does

- **Only on the New Session screen.** Once a conversation owns the column, moving pixels behind prose become a reading cost, so the ocean mounts with the `hero` phase and unmounts when a session activates.
- **Real artificial life, not a looping animation.** Fish are Reynolds boids in Couzin zones with a 127° blind spot behind each one; alarm travels hop by hop through the school, so a whole school bolts even when only its edge can see the predator. Whales are a 20-node spine with follow-the-leader steering: the turning circle grows with speed, hunger builds and only drops on a catch, and stragglers get picked before fish buried in a dense school.
- **Forks, flippers and fins are geometry, not sprites.** Nine kinds, zero assets — each is a half-width profile plus fin roots, rasterised to character cells at draw time.
- **Whale tail motion, not fish tail motion.** Fish sweep side to side; whales beat up and down, which from above reads as the flukes travelling fore-and-aft while their span opens and folds. Both terms run off the same phase as the body wave.
- **Follows the shell's palette.** Lit blocks with dark glyphs on dark; pale ink on light. Switching the theme recolours the water immediately, no reload.
- **Never leaves a loop running for nothing.** Off-screen, hidden tab and `prefers-reduced-motion` all stop it; DPR capped at 2; fixed 1/60 step with at most 4 catch-up steps.

## Install

```sh
git clone git@github.com:OGHong/dsh-ascii-sharks.git
cd dsh-ascii-sharks
sh scripts/install.sh              # installs into the desktop profile
sh scripts/install.sh --profile=web
```

Then **restart DeepSeek Harness** — the host scans the plugin manifest only at startup.

After restart:

- the New Session screen has an ASCII ocean behind it;
- **Settings → ASCII ocean** (a page in the settings nav) has the whole control set and a live status line: opacity, density, how many whales (1–5), species or random, pointer scatter.

Preferences live in `localStorage` under `dsh-ascii-sharks:v2` — per-window visual taste, not account settings, so they never sync across machines.

Remove with `sh scripts/install.sh --uninstall`.

## Settings

| Control | What it does |
|---|---|
| Opacity | Whole-canvas alpha, 0.1–1. Applied on the compositor, not per colour |
| Density | Per-layer strength multiplier |
| How many | 1–5 whales, stepped one at a time |
| Species | Sets the kind for the whole pod |
| Random | Each whale rolls its own kind, re-rolled every time the ocean comes back |
| Pointer | Whether the cursor scatters the fish |

## Development

```sh
npm install
npm run verify     # typecheck + build host half + build browser half

npm run preview    # builds preview/harness.js
open preview/index.html    # mock shell with sidebar / hero / composer
open preview/lab.html      # silhouette lab: all nine kinds, side by side
open preview/parity.html   # same conditions as the upstream demo
```

`preview/` is development-only and is not shipped.

### Layout

```
src/
  index.ts           Host half — publishes defaults, nothing else
  entry.ts           Browser half entry: registers two seats, no rendering logic
  surface.tsx        The ocean seat: mounts the canvas inside the conversation column
  settings-row.tsx   Settings row + this plugin's own settings page
  store.ts           Shared config store (localStorage-backed), roster resolution
  engine.ts          Fixed-step loop, resize, pointer, opacity, off-screen pause
  world.ts           Fish schools and whale behaviour
  renderer.ts        Cell-by-cell character rasteriser
  shapes.ts          Nine silhouettes, expressed as maths
  species.ts         Five fish behaviour tables
  math.ts            clamp / angleDiff / hash / divergence-free current
```

### Three constraints worth knowing

1. **The browser half must be one self-contained `window.__ModuleLoader__.load()` call.** The loader's `require` resolves only what the shell already seeded (`react`, `react/jsx-runtime`), never local paths. `scripts/build-client.mjs` bundles the engine to CommonJS and wraps it. React must stay external — a second copy gets a different hook dispatcher and every hook throws.

2. **The canvas mounts inside the conversation column, not on `shell.overlay`.** That overlay is a frame-wide layer at `z-index: 20`, above every column; painting a backdrop there covers the content. Mounting into the column with `z-index: -1` and `isolation: isolate` puts it above the column's own fill and below all its content.

3. **Locale dictionaries register inside `ctx.inject(["locale"], …)`.** On a cold load this bundle activates before the locale plugin, so a one-shot `ctx.get("locale")` gets `undefined` and the namespace never registers — every label then renders as its own key.

## Compatibility

Built and verified against DSH `0.2.1-rc.2`. It depends on three internal details (the `[data-phase="hero"]` marker, `body[data-ds-dark-theme]`, and the client loader envelope). These are commented at their use sites; see [NOTICE.md](NOTICE.md) for what breaks if they change.

## Credits

Simulation, behaviour tuning and the shark silhouettes: [stackedlol/ascii-sharks](https://github.com/stackedlol/ascii-sharks), Copyright (c) 2026 drewdi, MIT.
Orca geometry, DSH plugin wiring, theme adaptation, opacity and the whale tail beat: this repository, Copyright (c) 2026 OG Hong, MIT.

Orca markings were checked against [NOAA's killer whale anatomy notes](https://oceantoday.noaa.gov/killerwhaleanatomy/welcome.html) and [Ocean Wise](https://help.ocean.org/en/articles/9859506-killer-whale) — the animal is countershaded (black above, white below) and the saddle patch is grey, not white. The eye patch is drawn larger than true proportion on purpose: at roughly 40 cells long it is the only feature that still says "orca", and a faithful 2-cell patch reads as noise.

## License

**MIT.** See [LICENSE](LICENSE). Two copyright lines, side by side: drewdi (upstream engine) and OG Hong (the original parts of this repository). Keep the copyright banner at the top of `lib/client.js` when you redistribute the bundle.
