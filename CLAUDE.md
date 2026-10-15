# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm start` — Vite dev server on port 8000, opens `/demo/`, with watch-mode build running in parallel.
- `npm run build` — Production library build via Vite/Rollup. Outputs `dist/widget-doughnut.js` (ES module).
- `npm run watch` — `vite build --watch` only (no dev server).
- `npm run types` — Regenerate `src/definition-schema.d.ts` from `src/definition-schema.json` using `json2ts`. Run this after editing the JSON schema.
- `npm run release` — `npm version patch`: preflight guards (on `main`, clean tree, not behind `origin/main`, generated files current, build passes), then the bump and a `dist/` rebuild (the `version` hook, so the local build registers the new tag), then commit, bare-semver tag, `git push --follow-tags`, then waits on the CI run and fails if the npm publish fails. `npm run release:minor` / `release:major` for other bumps.
- `npm run link` / `npm run unlink` — Build and `npm link` this package into the studio checkout at `../../studio` (the host app, `~/git/ironflock/studio`), or put the published package back there. Only studio's appliance build (`build:appliance`) reads the widget from `node_modules`: its dev server (`npm run dev`) already aliases `widget-doughnut` to this checkout's `dist/` and serves its `src/*.json`, so `npm run watch` here is enough for dev. Studio tracks both `package-lock.json` and `bun.lock` (its Dockerfile runs `bun install --frozen-lockfile`), and `unlink` reinstalls with npm only: run `bun install` in studio as well if that moved the version.

No test runner or lint script is wired up (there is no `npm run lint` or `npm run format`). ESLint/Prettier configs are present (`.prettierrc`, eslint deps) but invocation is manual.

Node `>=24.9.0`, npm `>=10.0.2` required (see `engines`).

## Architecture

This repo publishes `@ironflock/widget-doughnut`, a single Lit web component consumed by the IronFlock platform frontend (studio) as a dashboard widget.

### Entry point and integration

- `src/widget-doughnut.ts` defines the Lit element. The custom element tag is `widget-doughnut-versionplaceholder` — the literal string `versionplaceholder` is replaced at build time by `@rollup/plugin-replace` (see `vite.config.ts`) with `pkg.version`. This versioned tag name lets multiple widget versions coexist on the same page (the host app reads the version from `package.json` and constructs the tag dynamically — see `demo/index.html`).
- The host platform passes data via two reactive properties: `inputData: DoughnutChartConfiguration` (data + per-series settings) and `theme: { theme_name, theme_object }` (an ECharts theme). The text colour can also be supplied via the CSS custom property `--re-text-color`. It is not snapshotted: `registerTheme()` stores a `var(--re-text-color, <theme value>)` chain, so a change to the host property repaints the HTML header live without the widget being told. The widget paints no background of its own: studio's `widget-item` already paints `--re-tile-background-color` on the tile, and painting it again here composited a translucent tile colour twice. A canvas cannot resolve `var()`, so the text ECharts paints (doughnut titles, slice labels and their lines) gets `resolvedTextColor()`: the computed `--re-text-color`, else the theme's title colour, read in every `applyData()` and never cached, so a board style edit lands on the next chart update. Setting it also keeps dark themes legible: with the canvas transparent, ECharts never detects dark mode and would draw the labels `#333` with a white halo.
- `echarts` is declared as a `peerDependency` and marked `external` in the Rollup config, so the host app provides the ECharts runtime. Inside the component, ECharts is imported from `echarts/core` with explicit `echarts.use([...])` registration of only the needed components (Tooltip, Legend, PieChart, CanvasRenderer, LabelLayout, Grid, Title) to keep the consumer bundle minimal.

### Data schema

- `src/definition-schema.json` is the source of truth for the input shape. It is consumed both as runtime documentation by the platform's widget configuration UI (note the `order`, `dataDrivenDisabled`, and rich `description` fields, which are platform-specific extensions read by the IronFlock dashboard editor) and compiled to `src/definition-schema.d.ts` via `npm run types`. The component imports `DoughnutChartConfiguration` from the generated `.d.ts`.
- `src/default-data.json` is the widget's default config, not just demo data: studio fetches it (from the CDN at the tile's version, or from this checkout in dev) as `default_config`, which seeds a freshly dropped tile and the style-preview demos, and the AI service's `get_widget_schema` shows it to the Widget Builder next to the schema. The demo renders it too. Keep it a valid config that shows the intended shape.

### Rendering pipeline (inside `widget-doughnut.ts`)

1. `transformData()` — runs on every `inputData` change (and on a theme change or rebuild). Skips null `dataseries` slots; each entry's `sections` is rows × slices (bare slice objects from a malformed object-shaped format are folded into one extra row). Rows are grouped whole by `rowPivot()`, the first non-empty `pivot` among a row's slices; rows without one form the unsplit group, titled with the plain label. Pivot keys are typed (`1` and `'1'` are separate doughnuts), and the groups sort naturally (`comparePivots`: `localeCompare` with `numeric: true`, 2 before 10, the unsplit group first). A chart is keyed by entry index + pivot key (`` `${dsIndex}\u0000${pivotKey(pivot)}` ``), never by its title (`'<pivot> - <label>'`), so blank or duplicate labels no longer share one chart. Each chart gets its entry's `settings`; `averageLatest` then makes each slice of the newest row the mean of that slice (by position) over the newest N rows, leaving out missing, null, blank and non-numeric values (a slice with no value at all shows 0, one with only non-numeric text is NaN, which ECharts does not draw). An empty slot (null, or no name and no value) stays null, a hole ECharts leaves out. Charts no group claimed (`doomed`) are disposed, and the chart divs are re-appended in configuration order (entries, then sorted pivots); moving a div keeps its ECharts instance.
2. `setupChart(key, title)` — lazily creates a `<div class="chart">` per key and calls `echarts.init` with the registered theme name (or `'light'` when the name is `'---'` or missing) and an explicit `devicePixelRatio` (zrender captures its own once, at module load). Instances live in `canvasList: Map<key, ChartCombination>`, in display order.
3. `adjustSizes()` — driven by a `ResizeObserver` on the host. Computes the grid (cols x rows) that maximizes per-chart area in the container; `columnLayout: true` allows only one-column layouts. Sets `gridTemplateColumns`, scales each `.chart` div from the origin size `320x200` (the container centres them), and records a `modifier` used to scale font sizes and border radii.
4. `applyData()` — builds a fresh option from `structuredClone(this.template)` on every call and hands it to `setOption`; it never reads `getOption()` back (the comment there explains the stack overflow it caused). Two stacked pie series: outer name labels + inner percent labels. Per-slice colors come from `sections[*].color`; if none provided, the theme palette or `DEFAULT_ECHARTS_COLORS` is used. The inner radius is `settings.cutout` (e.g. `"50%"`) of the outer radius, clamped to 0–90 so a ring is always left; unset, blank or unparseable keeps 50% — note `0%` makes it a pie chart. When no slice is above 0 the series get no data, so ECharts draws its empty grey ring instead of an even split; `minShowLabelAngle` drops the labels of zero slices. Font sizes scale with `modifier` but are clamped: the title is at least 10px and truncated to the chart width, outside labels at least 9px and hidden with their lines below a `modifier` of 0.45, inside percentages 7px up to `10 * modifier`, sized to the ring band and hidden above a 75% hole or when the band is too thin. The tooltip is `confine`d to the chart (`.doughnut-container` clips overflow) and shows at most two decimals (`formatTooltipValue`, attached after the clone because `structuredClone` cannot copy functions). Canvas text takes `resolvedTextColor()` (see above).
5. Lifecycle — `connectedCallback()` observes the size and the device pixel ratio. `disconnectedCallback()` disposes every chart a `setTimeout` later if the element is still detached (ECharts keeps instances in a global registry until `dispose()`; studio's keyed tile repeat moves a tile with a disconnect and reconnect in one task), and a later reconnect rebuilds them (`rebuildCharts()`). While detached, `transformData()` creates no charts (they would leak if the element never came back) and sets `chartsStale`, so the reconnect also rebuilds from the current `inputData` and theme. A `matchMedia('(resolution: <dpr>dppx)')` listener rebuilds the charts when the ratio changes (browser zoom, another screen), since a chart keeps the ratio it was created with.

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
