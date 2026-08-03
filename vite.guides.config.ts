// Standalone Vite config for the static /guides content section — a plain
// multi-page build (real .html files in guides/, no React, no router of any
// kind). Deliberately separate from vite.config.ts, which drives the main
// SPA's `npm run build` and stays completely untouched by this file's
// existence. Only ever invoked via `npm run build:guides`, which the main
// `build` script never runs.
//
// root stays the DEFAULT project root (not guides/) specifically so guides
// pages can reference /src/index.css directly — the exact same compiled
// Tailwind/Inter tokens the main app uses, not a duplicated copy.
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss()],
  // NOT '/guides/' — outDir (dist/) is shared with the main app and is
  // itself served at the site root; only the individual HTML *pages* built
  // by this config happen to live under a guides/ subfolder of it (via
  // their own path in rollupOptions.input below). Vite's `base` describes
  // where outDir's contents are served from as a whole, which is '/' here
  // — asset URLs must stay root-relative (/assets/*) to match where the
  // hashed CSS/JS files actually land on disk.
  build: {
    // Shared with the main app's build output. emptyOutDir MUST stay false —
    // build:all always runs `npm run build` first (which fully rebuilds
    // dist/ from scratch), then this guides build second; emptying here
    // would wipe what the main build just produced.
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        guidesHub: path.resolve(__dirname, 'guides/index.html'),
        readingBoq: path.resolve(__dirname, 'guides/reading-a-tender-boq/index.html'),
      },
    },
  },
});
