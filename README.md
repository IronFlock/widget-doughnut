# @ironflock/widget-doughnut

A [Lit](https://lit.dev) web component that draws doughnut and pie charts for IronFlock dashboards. Each `dataseries` entry is one doughnut, or one doughnut per distinct value of a pivot column. The doughnuts are separate charts, arranged automatically in a grid that uses the available space best.

## Installation

```bash
npm i @ironflock/widget-doughnut
```

`echarts` (^6) is a peer dependency: the host app provides it.

## Usage

The package version is part of the tag name (`widget-doughnut-<version>`, e.g. `widget-doughnut-1.5.31`), so several versions can be registered on one page. Build the tag from the version of the package you installed, as `demo/index.html` does from `package.json`, and set the data and the theme as properties:

```js
import '@ironflock/widget-doughnut'
import pkg from '@ironflock/widget-doughnut/package.json' with { type: 'json' }

const doughnut = document.createElement(`widget-doughnut-${pkg.version}`)
doughnut.inputData = { title: 'Parts', dataseries: [ ... ] }
doughnut.theme = { theme_name: 'light', theme_object: lightTheme }
document.body.append(doughnut)
```

## inputData

`src/definition-schema.json` describes every field. The `DoughnutChartConfiguration` type in `src/definition-schema.d.ts` is generated from it.

```ts
{
    title?: string
    subTitle?: string
    columnLayout?: boolean // true: one column of doughnuts; otherwise an automatic grid
    dataseries?: {
        label?: string // the title above this doughnut
        settings?: {
            cutout?: string // hole size, '0%' (pie) to '90%'; default '50%'
            averageLatest?: number // average each slice over the newest N rows
        }
        sections?: {
            name?: string // shown next to the slice and in its tooltip
            value?: number
            color?: string // CSS colour; slices without one use the theme palette
            pivot?: string // one doughnut per distinct value
        }[][] // rows of slices; only the newest (last) row is drawn
    }[]
}
```

Example (`src/default-data.json`, which is also the config a new dashboard tile starts with):

```json
{
    "dataseries": [
        {
            "label": "Device States",
            "sections": [
                [
                    { "name": "Devices Online", "value": 36 },
                    { "name": "Devices Offline", "value": 13 },
                    { "name": "Devices Unknown", "value": 4 }
                ]
            ]
        }
    ]
}
```

- `sections` is a list of rows, and each row is a list of slices. On a dashboard it is usually bound to a table: each row of the result is one whole doughnut, and the newest row is drawn. With `settings.averageLatest: N`, each slice is the mean of that slice over the newest N rows.
- `pivot`: bind the same column on every slice to get one doughnut per distinct value, titled `<pivot value> - <label>`.
- When every slice is 0 or missing, the doughnut shows an empty grey ring.

## Theming

- `theme`: `{ theme_name, theme_object }`, an ECharts theme that the widget registers under `theme_name`. Without a name (or with `'---'`), ECharts' built-in `light` theme is used.
- `--re-text-color`: when this CSS custom property is set on the widget or an ancestor, it colours all text (the header, the doughnut titles and the slice labels) instead of the theme's title colour.

The widget paints no background of its own, so the host's tile shows through.

## Development

| Command | What it does |
| --- | --- |
| `npm start` | Dev server on port 8000 with the demo in `demo/index.html`, plus a watch build |
| `npm run build` | Library build to `dist/widget-doughnut.js` |
| `npm run types` | Regenerate `src/definition-schema.d.ts` after editing `src/definition-schema.json` |
| `npm run release` | Bump the patch version, build, tag and push; CI publishes to npm |
