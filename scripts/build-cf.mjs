import { spawnSync } from "node:child_process";

// Cloudflare cannot upload ~900MB of PNGs — build with gallery samples only
process.env.SKIP_FULL_ART = "1";

const result = spawnSync("npm", ["run", "build"], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

process.exit(result.status ?? 1);
