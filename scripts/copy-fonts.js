// Copies the self-hosted Geist Mono font files into public/fonts so the app
// (and its offline PWA shell) never depends on a third-party font CDN.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "@fontsource", "geist-mono", "files");
const dest = join(root, "public", "fonts");

if (!existsSync(src)) {
  console.warn("[sprout] @fontsource/geist-mono not installed yet; skipping font copy.");
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const weight of [400, 500, 600, 700]) {
  for (const subset of ["latin", "latin-ext"]) {
    const file = `geist-mono-${subset}-${weight}-normal.woff2`;
    if (existsSync(join(src, file))) cpSync(join(src, file), join(dest, file));
  }
}
console.log("[sprout] Geist Mono fonts copied to public/fonts");
