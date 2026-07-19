# ARC mfers — mint site

```bash
npm install
npm run dev
```

→ [http://localhost:5174](http://localhost:5174)

## Cloudflare Pages

Build settings (dashboard or Git):

- Build command: `npm run build`
- Output directory: `dist`
- Root: `/` (this repo)

Deploy from your machine (after `npx wrangler login`):

```bash
npm run deploy
```

Env vars (Pages → Settings → Environment variables):

```
VITE_CONTRACT_ADDRESS=
VITE_MINT_PRICE=TBA
VITE_MAX_SUPPLY=5000
```

Custom domain: Pages → Custom domains → add `arcmfers.xyz` (and `www`).

## Art

`npm run sync:art` copies PNGs into `public/art/` before build. Large deploys may be slow; later you can move art to R2/IPFS.
