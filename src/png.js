import { PNG } from "pngjs";

/**
 * Decodes a PNG for measurement. Returns {width, height, channels, at(x,y)}
 * where at() yields [r,g,b,a] (a=255 for sources without an alpha channel) and
 * channels counts the source's own channels, 3 without alpha and 4 with it.
 */
export function decodePng(buffer) {
  const png = PNG.sync.read(buffer);
  const stride = png.width * 4;
  const pixels = png.data;
  return {
    width: png.width,
    height: png.height,
    channels: png.alpha ? 4 : 3,
    at(x, y) {
      const i = y * stride + x * 4;
      return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
    },
  };
}

/** The pixel size a PNG declares in its header, read without decoding the image. */
export function pngSize(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature) || buffer.toString("latin1", 12, 16) !== "IHDR") {
    throw new Error("not a PNG file");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
