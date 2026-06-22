import sharp from "sharp";
import { readFileSync } from "node:fs";

const standard = readFileSync("public/favicon.svg");
const maskable = readFileSync("public/maskable-icon.svg");

const tasks = [
  ["public/apple-touch-icon.png", standard, 180],
  ["public/pwa-192x192.png", standard, 192],
  ["public/pwa-512x512.png", standard, 512],
  ["public/maskable-512x512.png", maskable, 512]
];

for (const [out, buf, size] of tasks) {
  await sharp(buf, { density: 384 }).resize(size, size).png().toFile(out);
  console.log("wrote", out);
}
