import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const BACKEND_ORIGIN = 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    proxy: {
      '/api': { target: BACKEND_ORIGIN },
    },
  },
});
