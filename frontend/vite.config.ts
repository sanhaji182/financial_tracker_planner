import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts') || id.includes('d3-')) {
            return 'vendor-charts';
          }
          if (id.includes('lucide-react')) {
            return 'vendor-icons';
          }
          if (id.includes('@tanstack/react-query')) {
            return 'vendor-query';
          }
          if (id.includes('react-router-dom') || id.includes('@remix-run/router')) {
            return 'vendor-router';
          }
          if (id.includes('/react/') || id.includes('/react-dom/')) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
})
