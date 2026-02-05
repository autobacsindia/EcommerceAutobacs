const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const rootDir = path.resolve(__dirname, '..');
const imagesDir = path.join(rootDir, 'public', 'images');

async function convertFile(inputPath, outputPath) {
  try {
    await sharp(inputPath).webp({ quality: 80 }).toFile(outputPath);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
        const outputPath = fullPath.replace(ext, '.webp');
        if (fs.existsSync(outputPath)) continue;
        await convertFile(fullPath, outputPath);
      }
    }
  }
}

async function main() {
  await walk(imagesDir);
}

main();
