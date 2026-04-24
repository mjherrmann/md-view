import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    // GitHub project pages: VITE_BASE=/my-repo/ — user/org site: VITE_BASE=/
    base: env.VITE_BASE || '/',
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        devOptions: {
          enabled: true,
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,svg,woff,woff2}'],
        },
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'Markdown drop viewer',
          short_name: 'MD View',
          description: 'View and persist Markdown from drag-and-drop',
          theme_color: '#0f1419',
          background_color: '#0f1419',
          display: 'standalone',
          start_url: '.',
          scope: '.',
        },
      }),
    ],
  }
})
