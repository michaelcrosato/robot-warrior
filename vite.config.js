// vitest/config re-exports Vite's defineConfig with the `test` block typed.
import { defineConfig } from 'vitest/config';

// GitHub Pages serves the project from a sub-path. The Pages workflow sets
// PUBLIC_BASE=/robot-warrior/; local dev, preview and the e2e suite use "/".
const base = process.env.PUBLIC_BASE || '/';

export default defineConfig({
  base,

  // Audio ships as real files rather than inline base64. Serving `assets/` as the
  // public directory keeps the repository layout readable: `assets/audio/voice/x.ogg`
  // is served at `<base>audio/voice/x.ogg`. Code builds those URLs from
  // import.meta.env.BASE_URL so the same source works at "/" and at "/robot-warrior/".
  publicDir: 'assets',

  // Bind to the loopback IPv4 address explicitly. Vite's default `localhost` can
  // resolve to ::1 only, which makes a 127.0.0.1 health check (and the e2e suite)
  // fail against a server that is in fact running.
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
  },

  preview: {
    host: '127.0.0.1',
    port: 4180,
    strictPort: true,
  },

  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    sourcemap: true,
    rollupOptions: {
      output: {
        // One bundle. The game is a single interlocked simulation; splitting it
        // into chunks only adds request latency before the first frame.
        manualChunks: undefined,
      },
    },
  },

  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      // Modules that own WebGL, canvas, audio or network state are exercised by the
      // end-to-end suite in a real browser; unit coverage targets the pure layers.
      exclude: ['src/main.js', 'src/**/*.d.ts'],
      reportsDirectory: 'coverage',
      reporter: ['text', 'html', 'lcov'],
    },
  },
});
