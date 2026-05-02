#!/usr/bin/env node
/**
 * 生成 Network Analyzer 插件图标
 *
 * 使用纯 Node.js 生成最小有效 PNG 文件（无需 canvas 或第三方依赖）。
 * 图标设计：深蓝色背景 (#1a2b4a) 上的白色网络图标（简化的圆形节点 + 连线）。
 *
 * 生成的 PNG 使用 RGBA 像素数据，通过 zlib 压缩写入标准 PNG 格式。
 *
 * 用法：node scripts/generate-icons.js
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const iconsDir = join(__dirname, '..', 'icons');

// 确保 icons 目录存在
if (!existsSync(iconsDir)) {
  mkdirSync(iconsDir, { recursive: true });
}

// 颜色定义
const BG_COLOR = { r: 26, g: 43, b: 74, a: 255 };       // #1a2b4a
const FG_COLOR = { r: 255, g: 255, b: 255, a: 255 };     // 白色
const ACCENT_COLOR = { r: 100, g: 180, b: 255, a: 255 }; // 浅蓝色

/**
 * 创建 RGBA 像素缓冲区并绘制图标
 * @param {number} size - 图标尺寸（正方形边长）
 * @returns {Buffer} RGBA 像素数据
 */
function createIconPixels(size) {
  // 每个像素 4 字节 (RGBA)
  const pixels = Buffer.alloc(size * size * 4);

  // 辅助函数：设置像素颜色
  function setPixel(x, y, color) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = (y * size + x) * 4;
    pixels[idx] = color.r;
    pixels[idx + 1] = color.g;
    pixels[idx + 2] = color.b;
    pixels[idx + 3] = color.a;
  }

  // 辅助函数：混合像素（用于抗锯齿）
  function blendPixel(x, y, color, alpha) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = (y * size + x) * 4;
    const a = alpha / 255;
    pixels[idx] = Math.round(pixels[idx] * (1 - a) + color.r * a);
    pixels[idx + 1] = Math.round(pixels[idx + 1] * (1 - a) + color.g * a);
    pixels[idx + 2] = Math.round(pixels[idx + 2] * (1 - a) + color.b * a);
    pixels[idx + 3] = Math.max(pixels[idx + 3], color.a);
  }

  // 填充背景色（带圆角效果）
  const radius = Math.max(2, Math.floor(size * 0.15));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 圆角检测
      let inside = true;
      // 左上角
      if (x < radius && y < radius) {
        const dx = radius - x - 1;
        const dy = radius - y - 1;
        inside = (dx * dx + dy * dy) <= (radius * radius);
      }
      // 右上角
      if (x >= size - radius && y < radius) {
        const dx = x - (size - radius);
        const dy = radius - y - 1;
        inside = (dx * dx + dy * dy) <= (radius * radius);
      }
      // 左下角
      if (x < radius && y >= size - radius) {
        const dx = radius - x - 1;
        const dy = y - (size - radius);
        inside = (dx * dx + dy * dy) <= (radius * radius);
      }
      // 右下角
      if (x >= size - radius && y >= size - radius) {
        const dx = x - (size - radius);
        const dy = y - (size - radius);
        inside = (dx * dx + dy * dy) <= (radius * radius);
      }

      if (inside) {
        setPixel(x, y, BG_COLOR);
      }
    }
  }

  // 绘制网络图标：3 个节点 + 连线
  const cx = size / 2;
  const cy = size / 2;
  const nodeRadius = Math.max(1, Math.floor(size * 0.08));
  const spread = Math.floor(size * 0.25);

  // 节点位置（三角形排列）
  const nodes = [
    { x: Math.round(cx), y: Math.round(cy - spread) },           // 上
    { x: Math.round(cx - spread * 0.87), y: Math.round(cy + spread * 0.5) }, // 左下
    { x: Math.round(cx + spread * 0.87), y: Math.round(cy + spread * 0.5) }, // 右下
  ];

  // 绘制连线
  function drawLine(x0, y0, x1, y1, color, thickness) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy)) * 2;
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const px = Math.round(x0 + dx * t);
      const py = Math.round(y0 + dy * t);
      for (let tx = -thickness; tx <= thickness; tx++) {
        for (let ty = -thickness; ty <= thickness; ty++) {
          if (tx * tx + ty * ty <= thickness * thickness) {
            setPixel(px + tx, py + ty, color);
          }
        }
      }
    }
  }

  const lineThickness = Math.max(0, Math.floor(size * 0.03));

  // 连线：节点之间
  drawLine(nodes[0].x, nodes[0].y, nodes[1].x, nodes[1].y, ACCENT_COLOR, lineThickness);
  drawLine(nodes[1].x, nodes[1].y, nodes[2].x, nodes[2].y, ACCENT_COLOR, lineThickness);
  drawLine(nodes[2].x, nodes[2].y, nodes[0].x, nodes[0].y, ACCENT_COLOR, lineThickness);

  // 中心到各节点的连线
  drawLine(Math.round(cx), Math.round(cy), nodes[0].x, nodes[0].y, ACCENT_COLOR, lineThickness);
  drawLine(Math.round(cx), Math.round(cy), nodes[1].x, nodes[1].y, ACCENT_COLOR, lineThickness);
  drawLine(Math.round(cx), Math.round(cy), nodes[2].x, nodes[2].y, ACCENT_COLOR, lineThickness);

  // 绘制节点（实心圆）
  function drawCircle(centerX, centerY, r, color) {
    for (let y = centerY - r - 1; y <= centerY + r + 1; y++) {
      for (let x = centerX - r - 1; x <= centerX + r + 1; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= r) {
          setPixel(x, y, color);
        } else if (dist <= r + 1) {
          // 简单抗锯齿
          const alpha = Math.round((1 - (dist - r)) * 255);
          blendPixel(x, y, color, alpha);
        }
      }
    }
  }

  // 外围节点
  nodes.forEach((node) => {
    drawCircle(node.x, node.y, nodeRadius, FG_COLOR);
  });

  // 中心节点（稍大）
  drawCircle(Math.round(cx), Math.round(cy), Math.ceil(nodeRadius * 1.3), FG_COLOR);

  return pixels;
}

/**
 * 将 RGBA 像素数据编码为 PNG 格式
 * @param {Buffer} pixels - RGBA 像素数据
 * @param {number} width - 图像宽度
 * @param {number} height - 图像高度
 * @returns {Buffer} PNG 文件数据
 */
function encodePNG(pixels, width, height) {
  // PNG 签名
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = createChunk('IHDR', ihdrData);

  // IDAT chunk - 像素数据
  // 每行前加 filter byte (0 = None)
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    rawData[rowOffset] = 0; // filter: None
    pixels.copy(rawData, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = deflateSync(rawData);
  const idat = createChunk('IDAT', compressed);

  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

/**
 * 创建 PNG chunk
 * @param {string} type - chunk 类型（4 字符）
 * @param {Buffer} data - chunk 数据
 * @returns {Buffer} 完整的 chunk（length + type + data + CRC）
 */
function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcInput);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

/**
 * CRC32 计算（PNG 标准）
 * @param {Buffer} buf - 输入数据
 * @returns {number} CRC32 值
 */
function crc32(buf) {
  // 预计算 CRC 表
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table[n] = c;
  }

  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// 生成三种尺寸的图标
const sizes = [16, 48, 128];

sizes.forEach((size) => {
  const pixels = createIconPixels(size);
  const png = encodePNG(pixels, size, size);
  const filePath = join(iconsDir, `icon${size}.png`);
  writeFileSync(filePath, png);
  console.log(`✅ 已生成 ${filePath} (${size}x${size}, ${png.length} bytes)`);
});

console.log('\n🎉 所有图标生成完成！');
