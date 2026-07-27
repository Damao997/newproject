/**
 * 从 logo.png 生成各种尺寸的 favicon 和图标文件
 * 运行: node scripts/generate-icons.mjs
 */
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const logoPath = join(__dirname, '..', 'logo.png');

async function generateIcons() {
  const logo = sharp(logoPath);
  const metadata = await logo.metadata();
  console.log(`源文件: ${logoPath} (${metadata.width}x${metadata.height})`);

  // 生成 PNG 图标 - 各种尺寸
  const pngSizes = [16, 32, 48, 180, 192, 512];
  for (const size of pngSizes) {
    const outputPath = join(publicDir, `favicon-${size}x${size}.png`);
    await sharp(logoPath)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(outputPath);
    console.log(`✓ favicon-${size}x${size}.png`);
  }

  // apple-touch-icon (180x180)
  await sharp(logoPath)
    .resize(180, 180, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toFile(join(publicDir, 'apple-touch-icon.png'));
  console.log('✓ apple-touch-icon.png (180x180)');

  // 生成 favicon.ico (包含 16x16 和 32x32)
  const icon16 = await sharp(logoPath)
    .resize(16, 16, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();

  const icon32 = await sharp(logoPath)
    .resize(32, 32, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();

  const icon48 = await sharp(logoPath)
    .resize(48, 48, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();

  // 手动构建 ICO 文件 (PNG 编码的 ICO)
  const icoBuffer = createIco([icon16, icon32, icon48], [16, 32, 48]);
  const { writeFileSync } = await import('fs');
  writeFileSync(join(publicDir, 'favicon.ico'), icoBuffer);
  console.log('✓ favicon.ico (16x16 + 32x32 + 48x48)');

  console.log('\n所有图标文件生成完成！');
}

/**
 * 将多个 PNG buffer 打包为 ICO 格式
 */
function createIco(pngBuffers, sizes) {
  const numImages = pngBuffers.length;
  // ICO header: 6 bytes
  // ICO directory entry: 16 bytes per image
  const headerSize = 6 + numImages * 16;
  let offset = headerSize;

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type: 1 = ICO
  header.writeUInt16LE(numImages, 4); // Number of images

  const entries = [];
  for (let i = 0; i < numImages; i++) {
    const entry = Buffer.alloc(16);
    const size = sizes[i];
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // Width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // Height (0 = 256)
    entry.writeUInt8(0, 2);  // Color palette
    entry.writeUInt8(0, 3);  // Reserved
    entry.writeUInt16LE(1, 4);  // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(pngBuffers[i].length, 8); // Image data size
    entry.writeUInt32LE(offset, 12); // Offset to image data
    offset += pngBuffers[i].length;
    entries.push(entry);
  }

  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

generateIcons().catch(console.error);
