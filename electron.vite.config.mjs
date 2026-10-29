import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import svgLoader from 'vite-svg-loader'
import { readFileSync } from 'node:fs'
import { loadEnv } from 'vite'
import { publicBuildEnvironment } from './scripts/public-build-env.mjs'

export default defineConfig(({ mode }) => {
  const publicEnv = publicBuildEnvironment(loadEnv(mode, process.cwd(), 'VITE_'))
  return {
  main: {
    ...publicEnv,
    plugins: [externalizeDepsPlugin(), {
      name: 'screenshot-overlay-assets',
      generateBundle() {
        for (const name of ['overlay.html', 'overlay.js']) this.emitFile({
          type: 'asset', fileName: `overlay/${name}`,
          source: readFileSync(resolve('src/main/ipc/image/extra', name), 'utf8')
        })
      }
    }]
  },
  preload: {
    ...publicEnv,
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
    plugins: []
  },
  renderer: {
    ...publicEnv,
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@views': resolve('src/renderer/src/views'),
        '@resources': resolve('resources')
      }
    },
    plugins: [
      vue({
        template: {
          compilerOptions: {
            isCustomElement: (tag) => tag === 'webview'
          }
        }
      }),
      svgLoader()
    ]
  }
  }
})

