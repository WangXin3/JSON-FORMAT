import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/.toolchain/**', '**/.cache/**', '**/src-tauri/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'es2022', sourcemap: true,
    rollupOptions: { output: { manualChunks: (id) => {
      if (id.includes('node_modules/@codemirror') || id.includes('node_modules/@lezer')) return 'editor';
      if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react';
    } } },
  },
});
