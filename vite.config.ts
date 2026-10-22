import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// Versión de este build: la app la lleva adentro y también se publica en version.json.
// Una pestaña abierta compara las dos y, si el sitio tiene una más nueva, avisa (ver AvisoActualizacion).
const VERSION = new Date().toISOString()

function versionJson(): Plugin {
  return {
    name: 'version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: VERSION }) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/Produccion/',
  plugins: [react(), versionJson()],
  define: {
    __VERSION__: JSON.stringify(VERSION),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
