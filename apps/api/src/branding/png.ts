import zlib from 'node:zlib';
import PDFDocument from 'pdfkit';
import { ApiError } from '../http/errors.ts';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_BYTES = 262_144;
type Chunk = { readonly type: string; readonly data: Buffer; readonly bytes: Buffer };
type Header = {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly type: number;
};
const unreadable = (): ApiError => new ApiError(422, 'LOGO_UNREADABLE', 'PNG could not be read');

function readChunks(bytes: Buffer): readonly Chunk[] {
  const chunks: Chunk[] = [];
  let offset = 8;
  let idatEnded = false;
  let hasIdat = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw unreadable();
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw unreadable();
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw unreadable();
    const data = bytes.subarray(offset + 8, end - 4);
    if (zlib.crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4))
      throw unreadable();
    if (type === 'acTL' || (type === 'IDAT' && idatEnded)) throw unreadable();
    if (hasIdat && type !== 'IDAT') idatEnded = true;
    if (type === 'IDAT') hasIdat = true;
    chunks.push({ type, data, bytes: bytes.subarray(offset, end) });
    offset = end;
    if (type === 'IEND') {
      if (offset !== bytes.length || length !== 0) throw unreadable();
      break;
    }
  }
  if (chunks[0]?.type !== 'IHDR' || chunks.at(-1)?.type !== 'IEND') throw unreadable();
  if (chunks.filter((chunk) => chunk.type === 'IHDR').length !== 1) throw unreadable();
  if (!chunks.some((chunk) => chunk.type === 'IDAT')) throw unreadable();
  return chunks;
}

function readHeader(chunks: readonly Chunk[]): Header {
  const data = chunks[0]?.data;
  if (data === undefined || data.length !== 13) throw unreadable();
  const width = data.readUInt32BE(0),
    height = data.readUInt32BE(4);
  const depth = data[8] ?? 0,
    type = data[9] ?? -1;
  if (
    ![0, 2, 3, 4, 6].includes(type) ||
    !(depth === 8 || (type === 3 && [1, 2, 4].includes(depth)))
  )
    throw unreadable();
  if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw unreadable();
  if (
    Math.min(width, height) < 16 ||
    Math.max(width, height) > 2048 ||
    Math.max(width, height) < 64 ||
    width * height > 4_194_304 ||
    Math.max(width, height) / Math.min(width, height) > 8
  ) {
    throw new ApiError(422, 'LOGO_BAD_DIMENSIONS', 'PNG dimensions are outside the allowed range');
  }
  return { width, height, depth, type };
}

function validatePalette(chunks: readonly Chunk[], header: Header): void {
  const palettes = chunks.filter((chunk) => chunk.type === 'PLTE');
  const transparencies = chunks.filter((chunk) => chunk.type === 'tRNS');
  if (palettes.length > 1 || transparencies.length > 1) throw unreadable();
  const palette = palettes[0],
    transparency = transparencies[0];
  if ((header.type === 3) !== (palette !== undefined)) throw unreadable();
  const firstData = chunks.findIndex((chunk) => chunk.type === 'IDAT');
  if (
    palette !== undefined &&
    (palette.data.length === 0 ||
      palette.data.length % 3 !== 0 ||
      palette.data.length > 768 ||
      chunks.indexOf(palette) > firstData)
  )
    throw unreadable();
  if (transparency === undefined) return;
  if (chunks.indexOf(transparency) > firstData) throw unreadable();
  const length = transparency.data.length;
  if (header.type === 0 && length === 2) return;
  if (header.type === 2 && length === 6) return;
  if (
    header.type === 3 &&
    palette !== undefined &&
    chunks.indexOf(transparency) > chunks.indexOf(palette) &&
    length > 0 &&
    length <= palette.data.length / 3
  )
    return;
  throw unreadable();
}

function validatePixels(chunks: readonly Chunk[], header: Header): Buffer {
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[header.type] ?? 0;
  const stride = 1 + Math.ceil((header.width * channels * header.depth) / 8);
  const expectedRaw = header.height * stride;
  const compressed = Buffer.concat(
    chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data),
  );
  let raw: Buffer;
  try {
    raw = zlib.inflateSync(compressed, { maxOutputLength: expectedRaw });
  } catch {
    throw unreadable();
  }
  if (raw.length !== expectedRaw) throw unreadable();
  for (let row = 0; row < header.height; row += 1) {
    if ((raw[row * stride] ?? 5) > 4) throw unreadable();
  }
  return raw;
}

function paeth(left: number, above: number, upperLeft: number): number {
  const predictor = left + above - upperLeft;
  const distances = [
    Math.abs(predictor - left),
    Math.abs(predictor - above),
    Math.abs(predictor - upperLeft),
  ] as const;
  return distances[0] <= distances[1] && distances[0] <= distances[2]
    ? left
    : distances[1] <= distances[2]
      ? above
      : upperLeft;
}

function unfilter(raw: Buffer, header: Header): readonly Buffer[] {
  const stride = raw.length / header.height;
  const bpp = header.type === 2 ? 3 : 1;
  const rows: Buffer[] = [];
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * stride],
      row = Buffer.alloc(stride - 1),
      previous = rows[y - 1];
    for (let x = 0; x < row.length; x += 1) {
      const left = row[x - bpp] ?? 0,
        above = previous?.[x] ?? 0,
        upperLeft = previous?.[x - bpp] ?? 0;
      const prediction =
        filter === 1
          ? left
          : filter === 2
            ? above
            : filter === 3
              ? Math.floor((left + above) / 2)
              : filter === 4
                ? paeth(left, above, upperLeft)
                : 0;
      row[x] = ((raw[y * stride + 1 + x] ?? 0) + prediction) & 255;
    }
    rows.push(row);
  }
  return rows;
}

function rgbaPixel(
  row: Buffer,
  x: number,
  header: Header,
  palette: Buffer | undefined,
  transparency: Buffer | undefined,
): readonly number[] {
  if (header.type === 3) {
    const sample =
      ((row[Math.floor((x * header.depth) / 8)] ?? 0) >>
        (8 - header.depth - ((x * header.depth) % 8))) &
      ((1 << header.depth) - 1);
    if (palette === undefined || sample * 3 + 2 >= palette.length) throw unreadable();
    return [
      palette[sample * 3] ?? 0,
      palette[sample * 3 + 1] ?? 0,
      palette[sample * 3 + 2] ?? 0,
      transparency?.[sample] ?? 255,
    ];
  }
  const rgb =
    header.type === 0
      ? [row[x] ?? 0, row[x] ?? 0, row[x] ?? 0]
      : [row[x * 3] ?? 0, row[x * 3 + 1] ?? 0, row[x * 3 + 2] ?? 0];
  const match =
    transparency !== undefined &&
    (header.type === 0
      ? rgb[0] === transparency.readUInt16BE(0)
      : rgb.every((value, index) => value === transparency.readUInt16BE(index * 2)));
  return [...rgb, match ? 0 : 255];
}

function encodedChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])));
  return Buffer.concat([length, Buffer.from(type), data, crc]);
}

/** PDFKit's packed/indexed and tRNS paths disagree with PNG transparency. Store one RGBA interpretation. */
function normalisedPng(chunks: readonly Chunk[], header: Header, raw: Buffer): Buffer {
  const palette = chunks.find((chunk) => chunk.type === 'PLTE')?.data;
  const transparency = chunks.find((chunk) => chunk.type === 'tRNS')?.data;
  if (header.type !== 3 && transparency === undefined) {
    const kept = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
    return Buffer.concat([
      SIGNATURE,
      ...chunks.filter((chunk) => kept.has(chunk.type)).map((chunk) => chunk.bytes),
    ]);
  }
  const stride = 1 + header.width * 4;
  const rgba = Buffer.alloc(header.height * stride);
  unfilter(raw, header).forEach((row, y) => {
    for (let x = 0; x < header.width; x += 1) {
      const pixel = rgbaPixel(row, x, header, palette, transparency);
      pixel.forEach((value, channel) => {
        rgba[y * stride + 1 + x * 4 + channel] = value;
      });
    }
  });
  const ihdr = Buffer.from(chunks[0]?.data ?? []);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    SIGNATURE,
    encodedChunk('IHDR', ihdr),
    encodedChunk('IDAT', zlib.deflateSync(rgba)),
    encodedChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Injectable seam proves hostile bytes never reach the secondary PDF decoder. */
export const pngPdfCheck = {
  async check(png: Uint8Array): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const doc = new PDFDocument();
    const finished = new Promise<void>((resolve, reject) => {
      doc.on('error', reject);
      doc.on('end', resolve);
      doc.resume();
    });
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(unreadable()), 2000);
    });
    try {
      doc.image(Buffer.from(png), 0, 0, { fit: [64, 64] });
      doc.end();
      await Promise.race([finished, timeout]);
    } catch {
      throw unreadable();
    } finally {
      clearTimeout(timer);
      doc.destroy();
    }
  },
};

export async function sanitizeLogoPng(
  bytes: Uint8Array,
): Promise<{ readonly png: Uint8Array; readonly width: number; readonly height: number }> {
  if (bytes.byteLength > MAX_BYTES)
    throw new ApiError(413, 'LOGO_TOO_LARGE', 'PNG exceeds 256 KiB');
  const buffer = Buffer.from(bytes);
  if (!buffer.subarray(0, 8).equals(SIGNATURE))
    throw new ApiError(415, 'LOGO_UNSUPPORTED_TYPE', 'only PNG logos are supported');
  const chunks = readChunks(buffer);
  const header = readHeader(chunks);
  validatePalette(chunks, header);
  const raw = validatePixels(chunks, header);
  const png = normalisedPng(chunks, header, raw);
  if (png.byteLength > MAX_BYTES)
    throw new ApiError(413, 'LOGO_TOO_LARGE', 'normalised PNG exceeds 256 KiB');
  try {
    await pngPdfCheck.check(png);
  } catch {
    throw unreadable();
  }
  return { png, width: header.width, height: header.height };
}
