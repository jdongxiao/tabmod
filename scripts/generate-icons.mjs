// ============================================================
// TabMod — Icon Generator
// Reads assets/icons/icon.svg and generates 16/48/128 PNG files.
//
// Usage: node scripts/generate-icons.mjs
// Requires: sharp (installed as devDependency)
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SVG_PATH = join(ROOT, 'assets', 'icons', 'icon.svg');
const OUTPUT_DIR = join(ROOT, 'assets', 'icons');

const SIZES = [16, 48, 128];

async function main() {
  if (!existsSync(SVG_PATH)) {
    console.error(`❌ SVG not found: ${SVG_PATH}`);
    process.exit(1);
  }

  const svgBuffer = readFileSync(SVG_PATH);

  // Try to load sharp — if not installed, skip with a clear message
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.log('⚠️  sharp not installed. Install it and re-run:');
    console.log('   npm install sharp --save-dev');
    console.log('   node scripts/generate-icons.mjs');
    console.log('');
    console.log('   Or generate PNGs manually from the SVG at:');
    console.log(`   ${SVG_PATH}`);
    process.exit(0);
  }

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  for (const size of SIZES) {
    const outputPath = join(OUTPUT_DIR, `icon${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`✅ Generated ${outputPath} (${size}×${size})`);
  }

  console.log('\n🎉 All icons generated!');
}

main().catch((err) => {
  console.error('❌ Icon generation failed:', err);
  process.exit(1);
});
