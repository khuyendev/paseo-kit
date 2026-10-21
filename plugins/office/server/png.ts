// RGBA to PNG with node:zlib and an integer nearest-neighbour upscale (OFFC-08, OFFC-09).
import { deflateSync } from "node:zlib";
import { PNG_MAX_DIMENSION, PNG_MAX_PIXELS } from "./limits.ts";

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// 256-entry table implementation so it runs on any Node the host uses (zlib.crc32 is recent).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = (CRC_TABLE[(c ^ data[i]!) & 0xff]!) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function positiveInt(name: string, v: number): void {
  if (!Number.isInteger(v) || v <= 0) throw new RangeError(`${name} must be a positive integer`);
}

// Encodes w*h RGBA pixels at an integer scale; throws RangeError on a bad size or a scaled size over the caps.
export function encodePng(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, scale = 1): Buffer {
  positiveInt("w", w);
  positiveInt("h", h);
  positiveInt("scale", scale);
  if (rgba.length !== w * h * 4) throw new RangeError("rgba length must be w*h*4");
  const sw = w * scale;
  const sh = h * scale;
  if (sw > PNG_MAX_DIMENSION || sh > PNG_MAX_DIMENSION) throw new RangeError("scaled size over the dimension cap");
  if (sw * sh > PNG_MAX_PIXELS) throw new RangeError("scaled size over the pixel cap");
  const stride = sw * 4 + 1;
  const raw = Buffer.alloc(stride * sh);
  const row = Buffer.alloc(stride);
  let out = 0;
  for (let y = 0; y < h; y++) {
    // Filter byte 0, then each source pixel repeated scale times.
    let p = 1;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let s = 0; s < scale; s++) {
        row[p++] = rgba[i]!;
        row[p++] = rgba[i + 1]!;
        row[p++] = rgba[i + 2]!;
        row[p++] = rgba[i + 3]!;
      }
    }
    for (let s = 0; s < scale; s++) {
      row.copy(raw, out);
      out += stride;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(sw, 0);
  ihdr.writeUInt32BE(sh, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export function pngDataUri(png: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}
