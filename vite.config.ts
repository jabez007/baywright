import basicSsl from '@vitejs/plugin-basic-ssl'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  // The self-signed cert the plugin generates is what makes the dev host a
  // secure context, which is what `crypto.randomUUID`, `crypto.subtle` and
  // friends require. Browsers warn about the cert once per host — accept it.
  // Playwright runs on loopback, which browsers already treat as trustworthy.
  plugins: [vue(), ...(mode === 'playwright' ? [] : [basicSsl()])],
  server: {
    // Loopback only. Binding every interface publishes the dev server, and
    // everything it serves, to the whole network — opt into that per run with
    // `npm run dev:lan` when another device genuinely needs to reach it.
    host: 'localhost',
  },
}))
