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
      /**
       * Force recharts to use its CommonJS build (lib/) instead of the ESM
       * build (es6/).  recharts' ESM modules have circular dependencies that
       * cause Rollup to emit code where a `const` is accessed before its
       * initializer runs (TDZ: "Cannot access 'X' before initialization").
       * The CJS build uses require() so @rollup/plugin-commonjs can resolve
       * the circular refs safely using partial module objects — no TDZ.
       */
      'recharts': path.resolve(__dirname, 'node_modules/recharts/lib/index.js'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  build: {
    commonjsOptions: {
      // Required so the commonjs plugin also processes recharts' CJS build
      // and the d3 packages it requires (which may also be CJS).
      include: [/recharts/, /node_modules/],
      transformMixedEsModules: true,
    },
  },
})
