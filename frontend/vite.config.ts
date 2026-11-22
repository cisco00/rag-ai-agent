import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

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
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  build: {
    /**
     * recharts and its d3 internals ship as mixed ESM/CJS with circular
     * references.  Telling Rollup's commonjs plugin to process them
     * (transformMixedEsModules: true) prevents the TDZ "Cannot access 'X'
     * before initialization" crash that otherwise fires via React Scheduler's
     * MessagePort callback in production builds.
     *
     * We intentionally do NOT use manualChunks here: splitting React into its
     * own chunk creates a circular chunk dependency (vendor ↔ react-core)
     * that causes React to be undefined when vendor modules call
     * React.forwardRef at init time.  Rollup's default single-chunk output
     * resolves module order correctly.
     */
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
})
