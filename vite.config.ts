import { defineConfig } from 'vite'
import { readFileSync } from 'fs'
import replace from '@rollup/plugin-replace'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
    server: {
        open: '/demo/',
        port: 8000
    },
    resolve: {
        // echarts' CJS build reaches for tslib's helpers; without this alias
        // vite's dep optimizer hands the dev server a default-less interop
        // object and every demo page dies on `Cannot destructure property
        // '__extends'`. The other widget repos already carry it.
        alias: {
            tslib: 'tslib/tslib.es6.js'
        },
        conditions: ['browser']
    },
    define: {
        'process.env.NODE_ENV': JSON.stringify('production')
    },
    plugins: [
        replace({
            versionplaceholder: pkg.version,
            preventAssignment: true
        })
    ],
    build: {
        lib: {
            entry: 'src/widget-doughnut.ts',
            formats: ['es'],
            fileName: 'widget-doughnut'
        },
        sourcemap: true,
        rollupOptions: {
            external: [/^lit/, /^@lit/, /^echarts/],
            output: {
                banner: '/* @license Copyright (c) 2026 Record Evolution GmbH. All rights reserved.*/'
            }
        }
    }
})
