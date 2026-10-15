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
type ChartCombination = {
    echart?: echarts.ECharts
    dataSets: Dataseries[]
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

@customElement('widget-doughnut-versionplaceholder')
export class WidgetDoughnut extends LitElement {
    @property({ type: Object })
    inputData?: DoughnutChartConfiguration

    @property({ type: Object })
    theme?: Theme

    @state()
    private canvasList: Map<string, ChartCombination> = new Map()

    @query('.doughnut-container', true)
    private chartContainer?: HTMLDivElement

    @state() private themeTitleColor?: string
    @state() private themeSubtitleColor?: string

    private resizeObserver: ResizeObserver
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
        this.resizeObserver.observe(this)

        this.template = {
            // ECharts paints the registered theme's own canvas `backgroundColor`
            // (chalk = `rgba(41,52,65,1)`) as an opaque slab over the wrapper's
            // background, so the tile shows the theme colour behind the chart and
            // the host's `--re-tile-background-color` everywhere else. Keeping the
            // canvas transparent lets the wrapper show through; it already falls
            // back to the theme's colour when nothing overrides it, so no theme
            // loses its background. Set here rather than filtered out of
            // registerTheme() — theme registration is global by name, so another
            // widget on the page can re-register the same theme with it.
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
                show: true
            },
            series: [
                {
                    type: 'pie',
                    radius: ['20%', '60%'],
                    center: ['50%', '50%'],
                    avoidLabelOverlap: true,
                    itemStyle: {
                        borderRadius: 5
                    },
                    label2: {
                        // formatter: (d: any) => d.value?.toFixed(),
                        //position: 'inside'
                        fontSize: 12,
                        alignTo: 'none'
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
                    itemStyle: {
                        borderRadius: 5
                    },
                    label: { position: 'inside', formatter: '{d}%', fontSize: 18 },
                    percentPrecision: 0
                } as PieSeriesOption
            ]
        }
    }

    disconnectedCallback() {
        super.disconnectedCallback()
        if (this.resizeObserver) {
            this.resizeObserver.disconnect()
        }
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

        const maxSize = fits.reduce((p, c) => (c.size < p ? p : c.size), 0)
        const fit = fits.find((f) => f.size === maxSize)
        if (!fit) return
        const modifier = fit.m ?? 0

        this.boxes = Array.from(this.chartContainer?.querySelectorAll('.chart') as NodeListOf<HTMLDivElement>)
        // console.log(
        //     'FITS count',
        //     count,
        //     userWidth,
        //     userHeight,
        //     'modifier',
        //     modifier,
        //     'cols',
        //     fit?.c,
        //     'rows',
        //     fit?.r,
        //     'new size',
        //     fit?.size.toFixed(0),
        //     'total space',
        //     (userWidth * userHeight).toFixed(0)
        // )

        this.chartContainer.style.gridTemplateColumns = `repeat(${fit.c}, 1fr)`

        this.boxes?.forEach((box) =>
            box.setAttribute('style', `width:${modifier * width}px; height:${modifier * height}px`)
        )

        this.modifier = modifier

        this.canvasList.forEach((chartM) => {
            chartM.echart?.resize()
        })
    }

    async transformData() {
        if (!this?.inputData?.dataseries?.length) return
        // reset all existing chart dataseries
        this.canvasList.forEach((chartM) => {
            chartM.dataSets = []
            chartM.doomed = true
        })
        this.inputData.dataseries.forEach((ds) => {
            ds.label = ds.label ?? ''

            // sections must be rows × slices, but malformed stored configs
            // (e.g. an object-shaped tableRef.format) deliver bare slice
            // objects in the outer array. Fold those into one extra row so
            // the data still renders instead of throwing on row.filter below.
            const sections: any[] = Array.isArray(ds.sections) ? ds.sections : []
            const rows: any[][] = sections.filter(Array.isArray)
            const looseSlices = sections.filter((s) => s && typeof s === 'object' && !Array.isArray(s))
            if (looseSlices.length) rows.push(looseSlices)

            // pivot data
            const distincts = [...new Set(rows.flat().map((d) => d?.pivot ?? ''))].sort()
            // const derivedBgColors = tinycolor(ds.backgroundColors).monochromatic(distincts.length).map((c: any) => c.toHexString())
            distincts.forEach((piv, i) => {
                const prefix = piv ?? ''
                const label = ds.label ?? ''
                const name = prefix + (!!prefix && !!label ? ' - ' : '') + label
                const data = rows
                    .map((row) => (distincts.length === 1 ? row : row.filter((s) => s?.pivot === piv)))
                    .filter((row) => row.length)
                const data2 = data.map((row) =>
                    row.map((s) => {
                        if (s == null || (s.name == null && s.value == null)) return null
                        const color = s?.color
                        if (color === '' || color == null) {
                            return { name: s?.name, value: s?.value }
                        }
                        return { name: s?.name, value: s?.value, itemStyle: { color } }
                    })
                )

                const pds: any = {
                    label: name,
                    // every chart pivoted out of this dataseries uses its settings
                    settings: ds.settings,
                    sections: data2
                }
                const chart = this.setupChart(name)
                chart?.dataSets.push(pds)
            })
        })

        // filter latest values and calculate average
        this.canvasList.forEach(({ echart, dataSets }) => {
            dataSets.forEach((ds) => {
                const data: any[] = []
                ds.backgroundColor = ds.sections?.[0]?.map((d: any) => d?.itemStyle?.color) ?? []
                // Average the newest `averageLatest` rows. Unset (a cleared field
                // arrives as a missing key), NaN or anything below 1 uses only the
                // latest row, without averaging; a fraction counts whole rows only.
                const n = ds.settings?.averageLatest
                const averageLatest = typeof n === 'number' && n >= 1 ? Math.floor(n) : 1
                const sections = ds?.sections?.slice(-averageLatest) ?? []
                const newSection = window.structuredClone(sections.slice(-1)[0]) ?? []
                // The slices are those of the latest row; older rows can be
                // longer or shorter (ragged). An empty slot in the latest row is null
                // (see data2) and stays a hole, so ECharts draws nothing for it.
                for (let i = 0; i < newSection.length; i++) {
                    if (!newSection[i]) continue
                    // the i-th slice's numbers across the window. Missing, null,
                    // blank and non-numeric values are left out of the mean, not
                    // counted as 0. A slice with no value at all shows 0; one with
                    // only non-numeric text is NaN, which ECharts leaves undrawn.
                    const present = sections
                        .map((row) => row?.[i]?.value)
                        .filter((v) => v != null && String(v).trim() !== '')
                    const valueCol = present.map(Number).filter(Number.isFinite)

                    newSection[i].value = valueCol.length
                        ? valueCol.reduce((p, c) => p + c, 0) / valueCol.length
                        : present.length
                          ? NaN
                          : 0
                }
                ds.sections = [newSection]

                // If the user didn't provide any per-slice colors, rely on theme/default palette.
                // (We intentionally do not force itemStyle colors here so ECharts theme palettes work.)

                ds.datalabels = {
                    color: '#FFF',
                    formatter: (d: number) => d.toFixed()
                }
            })
        })

        const doomedCharts: string[] = []
        // remove all doomed charts
        this.canvasList.forEach((chart, label) => {
            if (!chart.doomed) return
            chart.echart?.dispose()
            chart.element?.remove()
            doomedCharts.push(label)
        })

        doomedCharts.forEach((label) => this.canvasList.delete(label))
    }

    async applyData() {
        const modifier = this.modifier

        const palette =
            (Array.isArray(this.theme?.theme_object?.color) && this.theme?.theme_object?.color?.length
                ? this.theme?.theme_object?.color
                : DEFAULT_ECHARTS_COLORS) ?? DEFAULT_ECHARTS_COLORS

        this.canvasList.forEach((chartM, label) => {
            for (const ds of chartM.dataSets) {
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

                // Title
                option.title[0].text = ds.label
                option.title[0].top = 0 * modifier
                option.title[0].textStyle.fontSize = 14 * modifier

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
                const cutout = parseFloat(ds.settings?.cutout ?? '')
                const hole = Number.isFinite(cutout) ? Math.min(Math.max(cutout, 0), 90) : 50
                series.radius[0] = String(hole * 0.6) + '%'
                series.itemStyle.borderRadius = 5 * modifier
                series2.radius[0] = String(hole * 0.6) + '%'
                series2.itemStyle.borderRadius = 5 * modifier
                // Sections
                // series.data[0].name = ds.unit
                series.data = ds.sections?.[0]
                series2.data = ds.sections?.[0]

                // Labels
                series.label.fontSize = 11 * modifier // outside text labels
                // Inside percentage labels fit the ring band: the chart is 200 * modifier
                // tall and the outer radius is 60% of its half, so the band is
                // 0.6 * modifier * (100 - hole) px. At the default 50% hole that leaves
                // the 10 * modifier size unchanged; a thinner ring gets smaller labels,
                // and none once the band is too thin to hold them (a hole above 75%).
                const band = 0.6 * modifier * (100 - hole)
                series2.label.fontSize = Math.min(10 * modifier, 0.4 * band)
                series2.label.show = hole <= 75

                // Apply
                chartM.echart?.setOption(option)
            }
        })
    }

    deleteCharts() {
        this.canvasList.forEach((chart, label) => {
            chart.echart?.dispose()
            chart.element?.remove()
            this.canvasList.delete(label)
        })
    }

    setupChart(label: string) {
        const existingChart = this.canvasList.get(label)

        if (existingChart) {
            delete existingChart.doomed
            return existingChart
        }

        if (!this.chartContainer) {
            console.warn('Chart container not found')
            return
        }
        const newContainer = document.createElement('div')
        newContainer.setAttribute('name', label)
        newContainer.setAttribute('class', 'chart')
        this.chartContainer.appendChild(newContainer)

        const theme =
            this.theme?.theme_name === '---' || !this.theme?.theme_name ? 'light' : this.theme?.theme_name
        const newChart = echarts.init(newContainer, theme)
        const chart = {
            echart: newChart,
            dataSets: [] as Dataseries[],
            element: newContainer
        }
        this.canvasList.set(label, chart)
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
        }

        header {
            display: flex;
            flex-direction: column;
        }
        h3 {
            margin: 0;
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        p {
            margin: 10px 0 0 0;
            max-width: 300px;
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
                <header>
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
