import { html, css, LitElement, PropertyValueMap } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
// import * as echarts from "echarts";
import type { EChartsOption, PieSeriesOption } from 'echarts'
import { DoughnutChartConfiguration } from './definition-schema.js'
import * as echarts from 'echarts/core'
import {
    ParallelComponent,
    TooltipComponent,
    LegendComponent,
    GridComponent,
    TitleComponent
} from 'echarts/components'
import { PieChart } from 'echarts/charts'
import { LabelLayout } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
    TooltipComponent,
    LegendComponent,
    PieChart,
    CanvasRenderer,
    LabelLayout,
    GridComponent,
    TitleComponent
])

// echarts.use([GaugeChart, CanvasRenderer]);
type Dataseries = Exclude<DoughnutChartConfiguration['dataseries'], undefined>[number]
type Slice = { name?: unknown; value?: any; itemStyle?: { color?: unknown } } | null
// What one doughnut draws: its title, the settings of the dataseries it came from, and
// its rows of slices (after transformData, just the newest or averaged row).
type ChartData = { title: string; settings?: Dataseries['settings']; sections: Slice[][] }
type ChartCombination = {
    title: string
    echart?: echarts.ECharts
    data?: ChartData
    element?: HTMLDivElement
    doomed?: boolean
}
type Theme = {
    theme_name: string
    theme_object: any
}

const DEFAULT_ECHARTS_COLORS = [
    '#5470c6',
    '#91cc75',
    '#fac858',
    '#ee6666',
    '#73c0de',
    '#3ba272',
    '#fc8452',
    '#9a60b4',
    '#ea7ccc'
]
// Tooltip numbers: averaging (settings.averageLatest) produces means like
// 41.333333333333336, so show at most two decimals. Only the display is rounded;
// the slice angles use the exact value.
const formatTooltipValue = (value: unknown): string =>
    typeof value === 'number' && Number.isFinite(value)
        ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
        : String(value ?? '-')

// The pivot of a row: the first slice pivot that is set. The whole row goes to that
// value's doughnut, so a slice without its own pivot binding stays with its row, and a
// row with no pivot at all (a NULL column) goes to the label's unsplit doughnut ('').
const rowPivot = (row: any[]): unknown => {
    for (const slice of row) {
        const pivot = slice?.pivot
        if (pivot != null && String(pivot) !== '') return pivot
    }
    return ''
}

// The identity of a pivot value. Typed, so 1 and '1' do not share a doughnut.
const pivotKey = (pivot: unknown): string => (pivot === '' ? '' : `${typeof pivot}:${String(pivot)}`)

// Pivot values in natural order (2 before 10), the unsplit '' group first.
const comparePivots = (a: unknown, b: unknown): number => {
    if (a === '' || b === '') return a === b ? 0 : a === '' ? -1 : 1
    return (
        String(a).localeCompare(String(b), undefined, { numeric: true }) ||
        pivotKey(a).localeCompare(pivotKey(b))
    )
}

@customElement('widget-doughnut-versionplaceholder')
export class WidgetDoughnut extends LitElement {
    @property({ type: Object })
    inputData?: DoughnutChartConfiguration

    @property({ type: Object })
    theme?: Theme

    // Keyed by dataseries index and pivot value, in display order (see transformData).
    @state()
    private canvasList: Map<string, ChartCombination> = new Map()

    @query('.doughnut-container', true)
    private chartContainer?: HTMLDivElement

    @state() private themeTitleColor?: string
    @state() private themeSubtitleColor?: string

    private resizeObserver: ResizeObserver
    private dprQuery?: MediaQueryList
    // inputData or theme changed while detached, so the charts are not up to date
    private chartsStale = false
    boxes?: HTMLDivElement[]
    origWidth: number = 320
    origHeight: number = 200
    template: EChartsOption
    modifier: number = 1
    version: string = 'versionplaceholder'

    constructor() {
        super()
        this.resizeObserver = new ResizeObserver(() => {
            this.adjustSizes()
            this.applyData()
        })

        this.template = {
            // ECharts paints the registered theme's own canvas `backgroundColor`
            // (chalk = `rgba(41,52,65,1)`) as an opaque slab over the tile's
            // background. Keeping the canvas transparent lets the tile show
            // through. Set here rather than filtered out of registerTheme() —
            // theme registration is global by name, so another widget on the page
            // can re-register the same theme with it.
            backgroundColor: 'transparent',
            title: [
                {
                    text: 'Pie',
                    left: 'center',
                    top: 0,
                    textStyle: {
                        fontSize: 10
                    }
                }
            ],
            color: undefined,
            // toolbox: {
            //   show: true,
            //   feature: {
            //     mark: { show: true },
            //     saveAsImage: { show: true }
            //   }
            // },
            tooltip: {
                show: true,
                // keep it inside the chart: .doughnut-container clips what overflows
                confine: true
            },
            series: [
                {
                    type: 'pie',
                    radius: ['20%', '60%'],
                    center: ['50%', '50%'],
                    avoidLabelOverlap: true,
                    // a zero slice has no angle, so it gets no label either
                    minShowLabelAngle: 1,
                    itemStyle: {
                        borderRadius: 5
                    },
                    label: {
                        show: true,
                        position: 'outer', // place labels outside the slices
                        distance: 20, // increase space from doughnut edge (default ~5)
                        bleedMargin: 10 // extra margin to avoid clipping
                    },
                    labelLine: {
                        show: true,
                        length: 10, // length of connector line
                        length2: 5 // second segment length
                    }
                } as PieSeriesOption,
                {
                    type: 'pie',
                    avoidLabelOverlap: true,
                    radius: ['20%', '60%'],
                    center: ['50%', '50%'],
                    minShowLabelAngle: 1,
                    itemStyle: {
                        borderRadius: 5
                    },
                    label: { position: 'inside', formatter: '{d}%', fontSize: 18 },
                    percentPrecision: 0
                } as PieSeriesOption
            ]
        }
    }

    connectedCallback() {
        super.connectedCallback()
        this.resizeObserver.observe(this)
        this.watchDevicePixelRatio()
        // Reattached after disconnectedCallback disposed the charts, or after a change
        // that transformData skipped while detached: rebuild them.
        if (this.hasUpdated && (this.chartsStale || !this.canvasList.size)) this.rebuildCharts()
    }

    disconnectedCallback() {
        super.disconnectedCallback()
        this.resizeObserver.disconnect()
        this.dprQuery?.removeEventListener('change', this.onDevicePixelRatioChange)
        // ECharts keeps every instance in a global registry until dispose(), and each
        // one holds its canvases and, through its div, this whole element, so dispose
        // the charts once the element is really gone. A DOM move (studio's keyed tile
        // repeat) disconnects and reconnects within one task, so decide after it.
        setTimeout(() => {
            if (!this.isConnected) this.deleteCharts()
        })
    }

    update(changedProperties: Map<string, any>) {
        if (changedProperties.has('inputData')) {
            this.transformData()
        }

        super.update(changedProperties)
    }

    updated(changedProperties: Map<string, any>) {
        if (changedProperties.has('inputData')) {
            this.adjustSizes()
            this.applyData()
        }

        if (changedProperties.has('theme')) {
            this.registerTheme(this.theme)
            this.deleteCharts()
            this.transformData()
            this.adjustSizes()
            this.applyData()
        }

        super.updated(changedProperties)
    }

    protected firstUpdated(_changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
        this.registerTheme(this.theme)
        this.transformData()
        this.adjustSizes()
        this.applyData()
    }

    private rebuildCharts() {
        this.chartsStale = false
        this.deleteCharts()
        this.transformData()
        this.adjustSizes()
        this.applyData()
        this.requestUpdate()
    }

    // zrender keeps the device pixel ratio a chart was created with, so after a
    // browser zoom or a move to a HiDPI screen the canvases would stay blurry.
    // Rebuild the charts when the ratio changes, and watch for the next change.
    private onDevicePixelRatioChange = () => {
        this.watchDevicePixelRatio()
        this.rebuildCharts()
    }

    private watchDevicePixelRatio() {
        this.dprQuery?.removeEventListener('change', this.onDevicePixelRatioChange)
        this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
        this.dprQuery.addEventListener('change', this.onDevicePixelRatioChange)
    }

    /**
     * The dashboard's text colour for what ECharts paints: the chart titles and the
     * slice labels. A canvas cannot resolve the var() chain in themeTitleColor, so
     * read --re-text-color here, at the point of use and uncached, falling back to
     * the theme's title colour. A board style edit then reaches the next chart
     * update, and a per-tile one arrives with widget-item's requestUpdate('theme').
     * Setting it also fixes dark themes: with the canvas transparent, ECharts never
     * detects dark mode and would draw the labels #333 with a white halo.
     */
    private resolvedTextColor(): string | undefined {
        return (
            getComputedStyle(this).getPropertyValue('--re-text-color').trim() ||
            this.theme?.theme_object?.title?.textStyle?.color
        )
    }

    registerTheme(theme?: Theme) {
        this.themeTitleColor = `var(--re-text-color, ${this.theme?.theme_object?.title?.textStyle?.color || 'inherit'})`
        this.themeSubtitleColor = `var(--re-text-color, ${this.theme?.theme_object?.title?.subtextStyle?.color || this.theme?.theme_object?.title?.textStyle?.color || 'inherit'})`

        if (!theme || !theme.theme_object || !theme.theme_name) return

        // Filter out component keys that would trigger warnings about unregistered components
        const excludeKeys = ['parallel', 'geo', 'timeline', 'visualMap', 'markPoint', 'toolbox', 'dataZoom']
        const filteredTheme = Object.fromEntries(
            Object.entries(theme.theme_object).filter(([key]) => !excludeKeys.includes(key))
        )
        echarts.registerTheme(theme.theme_name, filteredTheme)
    }

    adjustSizes() {
        if (!this.chartContainer) return
        const userWidth = this.chartContainer.getBoundingClientRect().width
        const userHeight = this.chartContainer.getBoundingClientRect().height
        const count = this.canvasList.size ?? 0

        const width = this.origWidth
        const height = this.origHeight
        if (!userHeight || !userWidth || !width || !height) return
        const fits = []
        for (let c = 1; c <= count; c++) {
            const r = Math.ceil(count / c)
            const uwgap = userWidth - 12 * (c - 1)
            const uhgap = userHeight - 12 * (r - 1)
            const m = uwgap / width / c
            const size = m * m * width * height * count
            if (r * m * height <= uhgap) fits.push({ c, r, m, size, width, height, userWidth, userHeight })
        }

        for (let r = 1; r <= count; r++) {
            const c = Math.ceil(count / r)
            const uwgap = userWidth - 12 * (c - 1)
            const uhgap = userHeight - 12 * (r - 1)
            const m = uhgap / height / r
            const size = m * m * width * height * count
            if (c * m * width <= uwgap) fits.push({ c, r, m, size, width, height, userWidth, userHeight })
        }

        // Vertical Layout stacks the doughnuts in one column; otherwise the grid that
        // gives each doughnut the most area wins.
        const candidates = this.inputData?.columnLayout === true ? fits.filter((f) => f.c === 1) : fits
        const maxSize = candidates.reduce((p, c) => (c.size < p ? p : c.size), 0)
        const fit = candidates.find((f) => f.size === maxSize)
        if (!fit) return
        const modifier = fit.m ?? 0

        this.boxes = Array.from(this.chartContainer?.querySelectorAll('.chart') as NodeListOf<HTMLDivElement>)

        this.chartContainer.style.gridTemplateColumns = `repeat(${fit.c}, 1fr)`

        this.boxes?.forEach((box) =>
            box.setAttribute('style', `width:${modifier * width}px; height:${modifier * height}px`)
        )

        this.modifier = modifier

        this.canvasList.forEach((chartM) => {
            chartM.echart?.resize()
        })
    }

    transformData() {
        // Until the first render there is no container to draw into; firstUpdated runs this again.
        if (!this.chartContainer) return
        // Detached: make no charts. disconnectedCallback disposes the others, so new
        // ones would leak if the element never comes back; connectedCallback rebuilds
        // from the current inputData and theme if it does.
        if (!this.isConnected) {
            this.chartsStale = true
            return
        }

        // Every chart is doomed until this pass claims it again.
        this.canvasList.forEach((chart) => {
            chart.data = undefined
            chart.doomed = true
        })

        // A missing or emptied list still runs the passes below, so the old charts are
        // disposed and No Data shows instead of the last values.
        const list = this.inputData?.dataseries
        const dataseries: any[] = Array.isArray(list) ? list : []
        const order: string[] = []
        dataseries.forEach((ds, dsIndex) => {
            // A null list slot (studio keeps them; a stray '-' in a board template makes one).
            if (!ds || typeof ds !== 'object') return
            const label = ds.label == null ? '' : String(ds.label)

            // sections must be rows × slices, but malformed stored configs
            // (e.g. an object-shaped tableRef.format) deliver bare slice
            // objects in the outer array. Fold those into one extra row so
            // the data still renders instead of throwing below.
            const sections: any[] = Array.isArray(ds.sections) ? ds.sections : []
            const rows: any[][] = sections.filter(Array.isArray)
            const looseSlices = sections.filter((s) => s && typeof s === 'object' && !Array.isArray(s))
            if (looseSlices.length) rows.push(looseSlices)

            // One doughnut per pivot value, whole rows at a time.
            const groups = new Map<string, { pivot: unknown; rows: any[][] }>()
            for (const row of rows) {
                const pivot = rowPivot(row)
                const group = groups.get(pivotKey(pivot)) ?? { pivot, rows: [] }
                group.rows.push(row)
                groups.set(pivotKey(pivot), group)
            }

            for (const { pivot, rows: groupRows } of [...groups.values()].sort((a, b) =>
                comparePivots(a.pivot, b.pivot)
            )) {
                const title = [pivot === '' ? '' : String(pivot), label].filter((s) => s !== '').join(' - ')
                const sectionsOut: Slice[][] = groupRows.map((row) =>
                    row.map((s) => {
                        // An empty slot stays null: a hole ECharts leaves out, not a nameless slice.
                        if (s == null || (s.name == null && s.value == null)) return null
                        const color = s.color
                        if (color === '' || color == null) return { name: s.name, value: s.value }
                        return { name: s.name, value: s.value, itemStyle: { color } }
                    })
                )
                // Keyed by entry and pivot, never by the title: two entries with the
                // same or a blank label used to share one chart, and only the last was drawn.
                const key = `${dsIndex}\u0000${pivotKey(pivot)}`
                const chart = this.setupChart(key, title)
                if (!chart) continue
                // every chart pivoted out of this dataseries uses its settings
                chart.data = { title, settings: ds.settings, sections: sectionsOut }
                order.push(key)
            }
        })

        // filter latest values and calculate average
        this.canvasList.forEach(({ data: ds }) => {
            if (!ds) return
            // Average the newest `averageLatest` rows. Unset (a cleared field
            // arrives as a missing key), NaN or anything below 1 uses only the
            // latest row, without averaging; a fraction counts whole rows only.
            const n = ds.settings?.averageLatest
            const averageLatest = typeof n === 'number' && n >= 1 ? Math.floor(n) : 1
            const sections = ds.sections.slice(-averageLatest)
            const newSection: Slice[] = window.structuredClone(sections.slice(-1)[0]) ?? []
            // The slices are those of the latest row; older rows can be
            // longer or shorter (ragged). An empty slot in the latest row is null
            // and stays a hole, so ECharts draws nothing for it.
            for (let i = 0; i < newSection.length; i++) {
                const slice = newSection[i]
                if (!slice) continue
                // the i-th slice's numbers across the window. Missing, null,
                // blank and non-numeric values are left out of the mean, not
                // counted as 0. A slice with no value at all shows 0; one with
                // only non-numeric text is NaN, which ECharts leaves undrawn.
                const present = sections
                    .map((row) => row?.[i]?.value)
                    .filter((v) => v != null && String(v).trim() !== '')
                const valueCol = present.map(Number).filter(Number.isFinite)

                slice.value = valueCol.length
                    ? valueCol.reduce((p, c) => p + c, 0) / valueCol.length
                    : present.length
                      ? NaN
                      : 0
            }
            ds.sections = [newSection]
        })

        // remove all doomed charts
        this.canvasList.forEach((chart, key) => {
            if (!chart.doomed) return
            chart.echart?.dispose()
            chart.element?.remove()
            this.canvasList.delete(key)
        })

        // Keep the grid in configuration order (entries, then sorted pivot values). A
        // chart that appears later, or drops out for one update and comes back, would
        // otherwise be appended at the end. Moving a div keeps its ECharts instance.
        const ordered = order.flatMap((key) => {
            const chart = this.canvasList.get(key)
            return chart ? [[key, chart] as const] : []
        })
        this.canvasList.clear()
        for (const [key, chart] of ordered) {
            this.canvasList.set(key, chart)
            if (chart.element) this.chartContainer.appendChild(chart.element)
        }
    }

    applyData() {
        const modifier = this.modifier

        const palette =
            (Array.isArray(this.theme?.theme_object?.color) && this.theme?.theme_object?.color?.length
                ? this.theme?.theme_object?.color
                : DEFAULT_ECHARTS_COLORS) ?? DEFAULT_ECHARTS_COLORS
        const textColor = this.resolvedTextColor()

        this.canvasList.forEach((chartM) => {
            const ds = chartM.data
            if (!ds || !chartM.echart) return
            // Always build the option from the template — never from getOption().
            // Reading the rendered option back and handing it to setOption
            // deep-clones the whole stored option on every frame, and it returns
            // every component normalized to an array, so any future
            // `{ ...option.x }` here would spread an array into `{ '0': x }` and
            // ECharts would merge that back one level deeper each update until
            // zrender's recursive merge() overflowed the stack. Starting from the
            // template also drops the need to strip theme-merged defaults for
            // components we never register — the template only names components
            // registered in echarts.use above.
            const option: any = window.structuredClone(this.template)
            option.tooltip.valueFormatter = formatTooltipValue

            const series = option.series[0],
                series2 = option.series[1]

            // Title: no smaller than 10px, cut to the chart's width instead of off at
            // both canvas edges, in the dashboard's text colour.
            const title = option.title[0]
            title.text = ds.title
            title.top = 0
            title.textStyle.fontSize = Math.max(10, 14 * modifier)
            title.textStyle.width = this.origWidth * modifier * 0.94
            title.textStyle.overflow = 'truncate'
            if (textColor) title.textStyle.color = textColor
            // Room under a title, so the label of a slice near 12 o'clock does not run into it.
            const center = ds.title ? ['50%', '55%'] : ['50%', '50%']
            series.center = center
            series2.center = center

            const sliceData: any[] = ds.sections?.[0] ?? []
            // Check if ANY slice has an explicit color
            const hasAnyExplicitColor = sliceData.some(
                (d) => d?.itemStyle?.color != null && d?.itemStyle?.color !== ''
            )

            if (!hasAnyExplicitColor) {
                // No user-provided colors: use theme or default palette
                option.color = palette
            } else {
                // Some slices have explicit colors: fill in missing ones from palette
                sliceData.forEach((d, idx) => {
                    if (d && !d.itemStyle?.color) {
                        d.itemStyle = d.itemStyle ?? {}
                        d.itemStyle.color = palette[idx % palette.length]
                    }
                })
            }

            // settings.cutout is the hole in percent of the outer radius (60%),
            // clamped to 0–90 so a ring is always left: '0%' is a pie. Unset, blank
            // (how a cleared field arrives) or not a number keeps the 50% default.
            const cutout = parseFloat(String(ds.settings?.cutout ?? ''))
            const hole = Number.isFinite(cutout) ? Math.min(Math.max(cutout, 0), 90) : 50
            series.radius[0] = String(hole * 0.6) + '%'
            series.itemStyle.borderRadius = 5 * modifier
            series2.radius[0] = String(hole * 0.6) + '%'
            series2.itemStyle.borderRadius = 5 * modifier

            // A doughnut whose slices add up to nothing gets ECharts' empty grey ring:
            // with a zero sum ECharts would split it evenly, which reads as equal shares.
            const hasShare = sliceData.some((d) => d && Number.isFinite(d.value) && d.value > 0)
            series.data = hasShare ? sliceData : []
            series2.data = hasShare ? sliceData : []

            // Outside labels: no smaller than 9px, and left out when the chart is too
            // small to hold them; the percentages and the tooltip remain.
            series.label.fontSize = Math.max(9, 11 * modifier)
            series.label.show = series.labelLine.show = modifier >= 0.45
            series.labelLine.length = Math.max(6, 10 * modifier)
            series.labelLine.length2 = Math.max(3, 5 * modifier)
            if (textColor) {
                series.label.color = textColor
                series.label.textBorderWidth = 0
                series.labelLine.lineStyle = { color: textColor }
            }

            // Inside percentage labels fit the ring band: the chart is 200 * modifier
            // tall and the outer radius is 60% of its half, so the band is
            // 0.6 * modifier * (100 - hole) px. A label needs about 0.4 of it; the
            // size is at least 7px, and the labels are left out when the band cannot
            // hold even that, or above a 75% hole.
            const band = 0.6 * modifier * (100 - hole)
            const fit = 0.4 * band
            series2.label.fontSize = Math.max(7, Math.min(10 * modifier, fit))
            series2.label.show = hole <= 75 && fit >= 6

            // Apply
            chartM.echart.setOption(option)
        })
    }

    deleteCharts() {
        this.canvasList.forEach((chart, key) => {
            chart.echart?.dispose()
            chart.element?.remove()
            this.canvasList.delete(key)
        })
    }

    setupChart(key: string, title: string) {
        const existingChart = this.canvasList.get(key)

        if (existingChart) {
            delete existingChart.doomed
            existingChart.title = title
            existingChart.element?.setAttribute('name', title)
            return existingChart
        }

        if (!this.chartContainer) {
            console.warn('Chart container not found')
            return
        }
        const newContainer = document.createElement('div')
        newContainer.setAttribute('name', title)
        newContainer.setAttribute('class', 'chart')
        this.chartContainer.appendChild(newContainer)

        const theme =
            this.theme?.theme_name === '---' || !this.theme?.theme_name ? 'light' : this.theme?.theme_name
        // Pass the ratio explicitly: zrender's own is captured once, when the module loads.
        const newChart = echarts.init(newContainer, theme, { devicePixelRatio: window.devicePixelRatio })
        const chart: ChartCombination = {
            title,
            echart: newChart,
            element: newContainer
        }
        this.canvasList.set(key, chart)
        return chart
    }

    static styles = css`
        :host {
            display: block;
            font-family: sans-serif;
            box-sizing: border-box;
            position: relative;
            margin: auto;
            container-type: size;
        }

        .paging:not([active]) {
            display: none !important;
        }

        .wrapper {
            display: flex;
            flex-direction: column;
            height: 100%;
            width: 100%;
            padding: 2cqh 2cqw;
            box-sizing: border-box;
            gap: 12px;
        }
        .doughnut-container {
            display: grid;
            flex: 1;
            overflow: hidden;
            position: relative;
            gap: 12px;
            /* Each chart keeps a 320x200 box (adjustSizes), so centre the boxes in
               their cells and the rows in the tile instead of leaving them in the
               top left corner of a wide or tall tile. */
            justify-items: center;
            align-content: center;
        }

        header {
            display: flex;
            flex-direction: column;
        }
        /* no title and no subtitle: no header, and no gap for it */
        header[hidden] {
            display: none;
        }
        h3 {
            margin: 0;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        p {
            margin: 10px 0 0 0;
            max-width: 100%;
            font-size: 14px;
            line-height: 17px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .chart {
            width: 450px; /* will be overriden by adjustSizes */
            height: 300px;
        }
        .no-data {
            font-size: 20px;
            display: flex;
            height: 100%;
            width: 100%;
            text-align: center;
            align-items: center;
            justify-content: center;
        }
    `

    render() {
        return html`
            <div class="wrapper" style="color: ${this.themeTitleColor}">
                <header ?hidden=${!this.inputData?.title && !this.inputData?.subTitle}>
                    <h3 class="paging" ?active=${this.inputData?.title}>${this.inputData?.title}</h3>
                    <p
                        class="paging"
                        ?active=${this.inputData?.subTitle}
                        style="color: ${this.themeSubtitleColor}"
                    >
                        ${this.inputData?.subTitle}
                    </p>
                </header>
                <div class="paging no-data" ?active=${!this.canvasList.size}>No Data</div>
                <div class="doughnut-container"></div>
            </div>
        `
    }
}
