# Marvinz — Marketing Website

The public landing page for **Marvinz.**, the visual workspace for Claude Code. This is a self-contained [Next.js](https://nextjs.org/) (App Router) project that lives in `/website` and does not touch the Electron app.

## Stack

- **Next.js 14** (App Router, React Server Components)
- **TypeScript**
- **next/font** — Geist (headings) and Geist Mono (mono) via the `geist` package, Inter (body) via `next/font/google`. All three are SIL OFL.
- **CSS Modules** + design tokens in `app/globals.css` (light in `:root`, dark in `[data-theme="dark"]`).

## Getting started

From inside the `website/` directory:

```bash
npm install
npm run dev
```

The dev server runs at [http://localhost:3000](http://localhost:3000) (it picks the next free port if 3000 is taken).

## Build

```bash
npm run build   # production build
npm run start   # serve the production build
```

## Theme

Light and dark themes are driven by a `data-theme` attribute on `<html>`. On first load the page respects the visitor's `prefers-color-scheme`; the theme toggle in the top bar overrides it and persists the choice in `localStorage` under the key `theme`. A small inline script in `app/layout.tsx` resolves the theme before paint to avoid a flash of the wrong theme.

## Structure

```
website/
├── app/
│   ├── globals.css     # design tokens + base styles
│   ├── layout.tsx      # fonts, metadata, pre-hydration theme script
│   ├── page.tsx        # landing page composition
│   └── icon.svg        # favicon (brand mark)
└── components/         # section components, each with a co-located CSS module
```

## Live demo

The product frames (hero + "See it" spread, on both `/` and `/v2`) embed a live,
in-browser instance of the real Marvinz renderer via `DemoFrame`. The static
`ProductMockup` is the loading fallback; the iframe (`/demo/index.html`) mounts
lazily when it nears the viewport and fades in once loaded. The iframe is
sandboxed read-only (`allow-scripts allow-same-origin` only — no popups,
top-navigation, modals, or forms), and the demo's `window.marvin` mock makes
every write an in-memory no-op, so nothing the visitor does touches a disk or
opens a dialog.

Build the demo bundle (from the **repo root**, not `/website`):

```bash
npm run build:demo   # vite build --config vite.demo.config.ts
```

This bundles the real renderer + the mock (`src/demo/`) into
`website/public/demo/`, served by Next.js at `/demo/`. The output is a build
artifact (gitignored) — rebuild it whenever the app UI or the mock changes.
Bundle size: ~12 MB on disk (~656 kB gzipped for the main app chunk, plus
lazily-loaded diagram libraries); it does not affect the landing's initial load
because the iframe is `loading="lazy"`.

## Notes

- Brand source of truth: `docs/specs/website-landing.md` (tokens, copy, voice rules).

### Pre-production pending

- **Inter self-hosting.** Geist and Geist Mono are bundled locally via the `geist` package. Inter is currently loaded through `next/font/google`, which fetches and self-hosts the font files at build time (no runtime request to Google). For a fully offline/air-gapped build, vendor the Inter `.woff2` files locally and switch to `next/font/local`. All three families are SIL OFL, so local bundling carries no licensing risk.

## Credits

Geist · Geist Mono · Inter (SIL OFL) · Codicons © Microsoft (CC-BY-4.0)
