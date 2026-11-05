/*
 * Generates the PWA icons from one SVG mark (shapes only, no fonts):
 *   public/icons/icon-192.png, icon-512.png    (purpose "any", rounded)
 *   public/icons/maskable-512.png              (full bleed, glyph inside the 80% safe zone)
 *   public/icons/badge-96.png                  (white on transparent: Android status-bar badge)
 *   app/apple-icon.png (180, opaque)  app/icon.svg (favicon)
 * Usage: node scripts/gen-icons.mts   (outputs are committed)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const NAVY = "#1d3557", AMBER = "#f4a261", WHITE = "#ffffff";

/** Container with ribs and an amber route arrow, drawn in a 100×100 box. */
const glyph = (fg: string, accent: string) => `
  <rect x="18" y="30" width="64" height="34" rx="3" fill="${fg}"/>
  ${[28, 38, 48, 58, 68].map((x) => `<rect x="${x}" y="35" width="4" height="24" rx="1" fill="${fg === WHITE ? NAVY : "#000"}" opacity="${fg === WHITE ? 0.35 : 0}"/>`).join("")}
  <path d="M18 74 H70" stroke="${accent}" stroke-width="6" stroke-linecap="round"/>
  <path d="M66 66 L78 74 L66 82 Z" fill="${accent}"/>`;

const svg = ({ size, bg, radius, scale }: { size: number; bg: string | null; radius: number; scale: number }) => {
  const offset = (100 - 100 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  ${bg ? `<rect width="100" height="100" rx="${radius}" fill="${bg}"/>` : ""}
  <g transform="translate(${offset} ${offset}) scale(${scale})">${glyph(WHITE, AMBER)}</g>
</svg>`;
};
const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 100 100">
  <g transform="translate(-4 -6) scale(1.08)">
    <rect x="18" y="30" width="64" height="34" rx="3" fill="${WHITE}"/>
    <path d="M18 74 H70" stroke="${WHITE}" stroke-width="6" stroke-linecap="round"/>
    <path d="M66 66 L78 74 L66 82 Z" fill="${WHITE}"/>
  </g>
</svg>`;

mkdirSync("public/icons", { recursive: true });
const png = (s: string, out: string) => sharp(Buffer.from(s)).png({ compressionLevel: 9 }).toFile(out);

await png(svg({ size: 192, bg: NAVY, radius: 22, scale: 1 }), "public/icons/icon-192.png");
await png(svg({ size: 512, bg: NAVY, radius: 22, scale: 1 }), "public/icons/icon-512.png");
await png(svg({ size: 512, bg: NAVY, radius: 0, scale: 0.72 }), "public/icons/maskable-512.png");
await png(badgeSvg, "public/icons/badge-96.png");
await sharp(Buffer.from(svg({ size: 180, bg: NAVY, radius: 0, scale: 0.86 }))).flatten({ background: NAVY }).png().toFile("app/apple-icon.png");
writeFileSync("app/icon.svg", svg({ size: 32, bg: NAVY, radius: 22, scale: 1 }).replace(/\n\s*/g, " ") + "\n");
console.log("Icons written to public/icons, app/apple-icon.png and app/icon.svg");
