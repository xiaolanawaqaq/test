"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const RES = path.resolve(__dirname, "..", "android", "app", "src", "main", "res");

// ---------- 极简 PNG 编码器 ----------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function makeSplash(w, h) {
  const px = Buffer.alloc(w * h * 4);
  function set(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  }
  function fillRect(x0, y0, x1, y1, r, g, b) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, r, g, b, 255);
  }
  function fillCircle(cx, cy, rad, r, g, b) {
    for (let y = cy - rad; y <= cy + rad; y++)
      for (let x = cx - rad; x <= cx + rad; x++)
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= rad * rad) set(x, y, r, g, b, 255);
  }
  function ring(cx, cy, rad, widthPx, r, g, b) {
    for (let y = cy - rad - widthPx; y <= cy + rad + widthPx; y++)
      for (let x = cx - rad - widthPx; x <= cx + rad + widthPx; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d >= rad - widthPx && d <= rad + widthPx) set(x, y, r, g, b, 255);
      }
  }

  // 背景：深军事绿渐变
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const r = Math.round(8 + t * 6);
    const g = Math.round(20 + t * 14);
    const b = Math.round(10 + t * 6);
    for (let x = 0; x < w; x++) set(x, y, r, g, b, 255);
  }

  const cx = w / 2;
  // 底座
  fillRect(cx - 110, h * 0.72, cx + 110, h * 0.72 + 34, 58, 90, 42);
  // 塔身
  fillRect(cx - 86, h * 0.46, cx + 86, h * 0.72, 47, 84, 34);
  // 塔顶
  fillRect(cx - 62, h * 0.34, cx + 62, h * 0.46, 74, 122, 58);
  // 炮管
  fillRect(cx + 8, h * 0.37, cx + 132, h * 0.37 + 20, 106, 154, 74);
  // 顶部十字准星圆环
  ring(cx, h * 0.40, 96, 8, 126, 231, 135);
  // 准星中心点
  fillCircle(cx, h * 0.40, 16, 126, 231, 135);

  return encodePNG(w, h, px);
}

// 写启动页
const splash = makeSplash(480, 800);
fs.mkdirSync(path.join(RES, "drawable"), { recursive: true });
fs.writeFileSync(path.join(RES, "drawable", "splash.png"), splash);
console.log("splash.png 已生成:", splash.length, "bytes");
