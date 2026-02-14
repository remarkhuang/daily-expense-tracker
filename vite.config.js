import { defineConfig } from 'vite';

export default defineConfig({
    root: '.',
    build: {
        outDir: 'dist',
    },
    server: {
        host: true,
        port: 5178,
        strictPort: true,
        open: true,
    },
});
