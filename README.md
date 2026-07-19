# ARC mfers — mint site

```bash
npm install
npm run dev
```

→ [http://localhost:5174](http://localhost:5174)

## Cloudflare

**Build command in dashboard:**
```bash
npm run build
```
(Cloudflare sets `CI=true`, so the build uses gallery samples only — not all 9k PNGs.)

**Or deploy from your PC:**
```bash
npm run cf:login
npm run deploy
```

Do **not** upload the full `public/art` set to Cloudflare — it’s ~900MB and breaks Workers deploys. Full art stays local / IPFS for mint later.
