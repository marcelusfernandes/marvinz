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

## Notes

- The screenshot section currently renders a neutral placeholder frame. Drop a real product screenshot into the `ScreenshotSpread` component when one is available.
- Brand source of truth: `docs/specs/website-landing.md` (tokens, copy, voice rules).

### Pre-production pending

- **Inter self-hosting.** Geist and Geist Mono are bundled locally via the `geist` package. Inter is currently loaded through `next/font/google`, which fetches and self-hosts the font files at build time (no runtime request to Google). For a fully offline/air-gapped build, vendor the Inter `.woff2` files locally and switch to `next/font/local`. All three families are SIL OFL, so local bundling carries no licensing risk.

## Credits

Geist · Geist Mono · Inter (SIL OFL) · Codicons © Microsoft (CC-BY-4.0)
