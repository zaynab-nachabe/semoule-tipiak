// En développement (npm run dev), Vite relaie /api et /socket.io vers l'API locale, comme nginx en production :
// l'application parle toujours à sa propre origine.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const API = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, rewrite: (path) => path.replace(/^\/api/, '') },
      '/socket.io': { target: API, ws: true },
    },
  },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
