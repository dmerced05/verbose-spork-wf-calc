import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // relative asset paths so the build works both locally and under /verbose-spork-wf-calc/ on GitHub Pages
  base: './',
  build: {
    // the weapon/mod/arcane/enemy JSON + incarnon perks are bundled in (~160KB gzipped), so I bumped this past the default warning
    chunkSizeWarningLimit: 1500,
  },
})
