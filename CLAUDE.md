# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm start` — Vite dev server on port 8000, opens `/demo/`, with watch-mode build running in parallel.
- `npm run build` — Production library build via Vite/Rollup. Outputs `dist/widget-doughnut.js` (ES module).
- `npm run watch` — `vite build --watch` only (no dev server).
- `npm run types` — Regenerate `src/definition-schema.d.ts` from `src/definition-schema.json` using `json2ts`. Run this after editing the JSON schema.
- `npm run analyze` — Generate Custom Elements Manifest (`cem analyze --litelement`).
- `npm run release` — `npm version patch`: preflight guards (on `main`, clean tree, not behind `origin/main`, generated files current, build passes), then the bump and a `dist/` rebuild (the `version` hook, so the local build registers the new tag), then commit, bare-semver tag, `git push --follow-tags`, then waits on the CI run and fails if the npm publish fails. `npm run release:minor` / `release:major` for other bumps.
- `npm run link` / `npm run unlink` — Symlink this package into a sibling `../RESWARM/frontend` checkout for local integration testing.

No test runner or lint script is wired up despite README mentioning `npm run lint`/`npm run format` — those scripts do not exist in `package.json`. ESLint/Prettier configs are present (`.prettierrc`, eslint deps) but invocation is manual.

Node `>=24.9.0`, npm `>=10.0.2` required (see `engines`).

## Architecture

This repo publishes `@ironflock/widget-doughnut`, a single Lit web component consumed by the IronFlock/RESWARM platform frontend as a dashboard widget.

### Entry point and integration

- `src/widget-doughnut.ts` defines the Lit element. The custom element tag is `widget-doughnut-versionplaceholder` — the literal string `versionplaceholder` is replaced at build time by `@rollup/plugin-replace` (see `vite.config.ts`) with `pkg.version`. This versioned tag name lets multiple widget versions coexist on the same page (the host app reads the version from `package.json` and constructs the tag dynamically — see `demo/index.html`).
- The host platform passes data via two reactive properties: `inputData: DoughnutChartConfiguration` (data + per-series settings) and `theme: { theme_name, theme_object }` (an ECharts theme). Theme can also be supplied via CSS custom properties `--re-text-color` and `--re-tile-background-color`. These are not snapshotted: `registerTheme()` stores a `var(--re-…, <theme value>)` chain, so a change to the host property repaints the tile live without the widget being told.
- `echarts` is declared as a `peerDependency` and marked `external` in the Rollup config, so the host app provides the ECharts runtime. Inside the component, ECharts is imported from `echarts/core` with explicit `echarts.use([...])` registration of only the needed components (Tooltip, Legend, PieChart, CanvasRenderer, LabelLayout, Grid, Title) to keep the consumer bundle minimal.

### Data schema

- `src/definition-schema.json` is the source of truth for the input shape. It is consumed both as runtime documentation by the platform's widget configuration UI (note the `order`, `dataDrivenDisabled`, and rich `description` fields, which are platform-specific extensions read by the IronFlock dashboard editor) and compiled to `src/definition-schema.d.ts` via `npm run types`. The component imports `DoughnutChartConfiguration` from the generated `.d.ts`.
- `src/types.ts` exists but is not the active type source — `definition-schema.d.ts` is what `widget-doughnut.ts` imports.
- `src/default-data.json` is sample data used by the demo.

### Rendering pipeline (inside `widget-doughnut.ts`)

1. `transformData()` — runs on `inputData` change. Pivots `dataseries[].sections` by the optional `pivot` field to auto-split one series into multiple charts; applies `averageLatest` smoothing (averages the last N rows of section values); marks unused charts as `doomed` for disposal.
2. `setupChart(label)` — lazily creates a `<div class="chart">` per pivoted series, calls `echarts.init` with the registered theme name (or `'light'` fallback when theme name is `'---'` or missing), and stores the instance in `canvasList: Map<label, ChartCombination>`.
3. `adjustSizes()` — driven by a `ResizeObserver` on the host. Computes a grid layout (cols x rows) that maximizes per-chart area against the container's box, sets `gridTemplateColumns`, scales each `.chart` div, and records a `modifier` used to scale font sizes and border radii. Origin chart size is `320x200`.
4. `applyData()` — merges live data into the cached ECharts option (two stacked pie series: outer labels + inner percent labels). Per-slice colors come from `sections[*].color`; if none provided, the theme palette or `DEFAULT_ECHARTS_COLORS` is used. The inner radius is computed from `settings.cutout` (e.g. `"50%"`) — note `0%` makes it a pie chart.

### Build pipeline

`vite.config.ts` configures a library build:
- Single ES-module output (`dist/widget-doughnut.js`) with sourcemaps and a license banner.
- `echarts` (and any subpath) is externalized.
- `@rollup/plugin-replace` substitutes `versionplaceholder` → current `package.json` version (affects the custom element tag name and the `version` class field).
- `process.env.NODE_ENV` is hardcoded to `'production'`.

### Release flow

Tags pushed to GitHub trigger `.github/workflows/build-publish.yml` which runs `npm ci`, `npm run build`, then `npm publish --access public` via npm trusted publishing (OIDC — no `NPM_TOKEN`) and creates a GitHub Release. `npm run release` is the canonical local command. The bare-semver tag (e.g. `1.5.19`, not `v1.5.19`) comes from `tag-version-prefix=""` in `.npmrc`, so every `npm version` invocation gets it, not just the release script.

## `aiSelection` in `src/definition-schema.json`

The schema root carries an `aiSelection` block next to `title` and `description`. It is **not** JSON Schema and describes no config field — it exists so the IronFlock AI's Widget Builder can pick the right widget for a given shape of data, using knowledge only the widget author has:

```jsonc
"aiSelection": {
  "dataShape": "…what columns this widget consumes and what each one means…",
  "useWhen":   ["…a situation, naming the properties that express it…"],
  "notFor":    ["…a situation this widget is wrong for, naming the widget to use instead…"]
}
```

It is inert everywhere else, and must stay that way: `json2ts` ignores it (the generated `.d.ts` is byte-identical with and without it), the dashboard config editor renders only `schema.properties`, and the AI service's `validate_widget` validates *configs* against the schema, skipping unknown Draft-7 keywords.

When maintaining it:

- `notFor` is the high-value half and the part plain descriptions always omit. Every entry must name the widget that *should* be used, or it rejects without routing.
- Write for an LLM with no other documentation: describe the visible result and the user's intent, not the implementation.
- Prefer entries that discriminate against a *neighbouring* widget. Generic rejections are cheap; the ones that pay are those an author could plausibly get wrong.
- The `notFor` lists are a set across all `widget-*` repos and are meant to be reciprocal — if this widget routes to another for some case, that widget should usually route back for the converse. Changing one side is a cue to check the other.
- Update it whenever a property changes what this widget can *do*, not just how it looks.
