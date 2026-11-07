import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// API_ALVO: para onde o /api do servidor de desenvolvimento aponta.
//   npm run dev      -> API real em http://localhost:3000 (padrão)
//   npm run dev:sim  -> simulador em http://localhost:3001 (Fase 2)
// O Portal sempre chama /api relativo: o mesmo build serve simulador, compose, kind e VM.
const apiAlvo = process.env.API_ALVO ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiAlvo,
        changeOrigin: true,
        rewrite: (caminho) => caminho.replace(/^\/api/, ''),
      },
    },
  },
});
