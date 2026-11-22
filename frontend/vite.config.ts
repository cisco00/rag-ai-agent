import { defineConfig } from 'vite'
import path from 'path'
import fs from 'fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { buildSync } from 'esbuild'

// ---------------------------------------------------------------------------
// Pre-bundle recharts with esbuild to eliminate ESM circular-dep TDZ.
//
// recharts' modules have circular dependencies that cause Rollup to emit
// live-binding getter functions for exports that are still in the temporal
// dead zone (TDZ) on the first React render tick.  The exact module order
// — and therefore which builds fail — varies by Node.js version and OS,
// so the same source produces a working bundle on Node 22 / macOS and a
// crashing one on Node 18 / Alpine Linux (Railway).
//
// esbuild resolves circular refs without TDZ: it uses plain variable
// assignment, not `const`.  We pre-bundle recharts (and all its d3 deps)
// into a single flat ESM file at .prebundle/recharts.js and alias the
// 'recharts' import to that file so Rollup sees no circular deps at all.
// ---------------------------------------------------------------------------
const prebundleDir = path.resolve(__dirname, '.prebundle')
const rechartsBundlePath = path.join(prebundleDir, 'recharts.js')

fs.mkdirSync(prebundleDir, { recursive: true })
buildSync({
  // Use the ESM entry — esbuild handles its circular deps correctly.
  entryPoints: [path.resolve(__dirname, 'node_modules/recharts/es6/index.js')],
  bundle: true,
  format: 'esm',
  outfile: rechartsBundlePath,
  // Keep react + react-dom external so they come from Vite's own bundle.
  // Bundle everything else (d3-*, react-is, prop-types, …) into one file.
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  platform: 'browser',
  target: ['es2020'],
  logLevel: 'warning',
})

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
      // Point 'recharts' at the esbuild-pre-bundled file (TDZ-free).
      'recharts': rechartsBundlePath,
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
