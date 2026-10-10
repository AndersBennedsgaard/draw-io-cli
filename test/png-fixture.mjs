import { deflateSync } from "node:zlib";

// A synthetic rendered pair: a painted RGBA canvas with a model embedded in
// the tEXt chunk the way the webapp embeds it, so a test exercises the PNG
// readers without a browser render and places every ink pixel itself.

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

/**
 * Encodes a white w x h canvas with the given black rectangles painted and
 * the model XML embedded (tEXt keyed mxfile, URL-encoded), which is exactly
 * what `measure`, `extract` and `check-pair` read back.
 */
export function syntheticRender(w, h, blackRects, xml) {
  const raw = Buffer.alloc(h * (1 + w * 4), 0xff);
  for (let y = 0; y < h; y += 1) raw[y * (1 + w * 4)] = 0; // filter byte 0 per scanline
  for (const r of blackRects) {
    for (let y = r.y; y < r.y + r.h; y += 1) {
      for (let x = r.x; x < r.x + r.w; x += 1) {
        const at = y * (1 + w * 4) + 1 + x * 4;
        raw[at] = 0; raw[at + 1] = 0; raw[at + 2] = 0; raw[at + 3] = 0xff;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const text = Buffer.concat([Buffer.from("mxfile\0", "latin1"), Buffer.from(encodeURIComponent(xml), "latin1")]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("tEXt", text),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
