import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'

import basicSsl from '@vitejs/plugin-basic-ssl'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'

/**
 * GitHub Pages has no rewrites, so a reload on `/project/...` asks for a file
 * that is not there. Pages answers a missing file with `404.html`, and a copy
 * of the app's own page boots the router at that path.
 */
function pagesFallback(): Plugin {
  let outDir = 'dist'
  return {
    name: 'pages-fallback',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      copyFileSync(resolve(outDir, 'index.html'), resolve(outDir, '404.html'))
    },
  }
}

export default defineConfig(({ mode }) => ({
  // GitHub Pages serves the production build from the repository's path.
  base: mode === 'production' ? '/baywright/' : '/',
  // The self-signed cert the plugin generates is what makes the dev host a
  // secure context, which is what `crypto.randomUUID`, `crypto.subtle` and
  // friends require. Browsers warn about the cert once per host — accept it.
  // Playwright runs on loopback, which browsers already treat as trustworthy.
  plugins: [vue(), pagesFallback(), ...(mode === 'playwright' ? [] : [basicSsl()])],
  server: {
    // Loopback only. Binding every interface publishes the dev server, and
    // everything it serves, to the whole network — opt into that per run with
    // `npm run dev:lan` when another device genuinely needs to reach it.
    host: 'localhost',
  },
  build: {
    // The 3D view's chunk is mostly three.js, about 570 kB, and loads only
    // when that view opens. The main bundle stays well under the default.
    chunkSizeWarningLimit: 600,
  },
}))
