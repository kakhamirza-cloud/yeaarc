# ARC mfers — mint site

```bash
npm install
npm run dev
```

→ [http://localhost:5174](http://localhost:5174)

## Images on Netlify

Locally, art lives in `../ARC Mfers/output/mfers`. Netlify does **not** have that folder, so images must ship inside this project.

`npm run sync:art` (also runs before `dev` / `build`) copies them into `public/art/`.

**To deploy with images:**

1. Run `npm run sync:art` on your machine  
2. Commit and push `public/art/` (or upload a folder that includes it)  
3. Netlify build publishes `dist`, which includes `/art/*.png`

If Netlify only has this repo (no sibling `ARC Mfers`), keep `public/art` in git so the build always has the images.

Set `VITE_CONTRACT_ADDRESS` (and optionally `VITE_MINT_PRICE`) in Netlify env when the contract is ready.
