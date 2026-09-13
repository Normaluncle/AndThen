import { defineConfig } from 'vite';
const api = process.env.API_PROXY_TARGET || 'http://127.0.0.1:8080';
export default defineConfig({
  server: {port: 5173, proxy: {'/api': api}},
  preview: {port: 4173, host: '127.0.0.1', proxy: {'/api': api}},
});
