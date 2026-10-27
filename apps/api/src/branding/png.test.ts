import zlib from 'node:zlib';
import PDFDocument from 'pdfkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pngPdfCheck, sanitizeLogoPng } from './png.ts';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
  const length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])));
  return Buffer.concat([length, Buffer.from(type), data, crc]);
}
type PngOptions = {
  width?: number;
  height?: number;
  type?: number;
  depth?: number;
  interlace?: number;
  palette?: Buffer | null;
  transparency?: Buffer;
  extra?: Buffer;
  idat?: Buffer;
  raw?: Buffer;
};
function png(options: PngOptions = {}): Buffer {
  const { width = 200, height = 50, type = 6, depth = 8, interlace = 0 } = options;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = type;
  header[12] = interlace;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type] ?? 1;
  const raw = options.raw ?? Buffer.alloc(height * (1 + Math.ceil((width * channels * depth) / 8)));
  const palette =
    options.palette === undefined ? (type === 3 ? Buffer.from([0, 0, 0]) : null) : options.palette;
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    ...(palette === null ? [] : [chunk('PLTE', palette)]),
    ...(options.transparency ? [chunk('tRNS', options.transparency)] : []),
    options.extra ?? Buffer.alloc(0),
    chunk('IDAT', options.idat ?? zlib.deflateSync(raw)),
    chunk('IEND'),
  ]);
}
function alterHeader(bytes: Buffer, offset: number, value: number): Buffer {
  const header = Buffer.from(bytes.subarray(16, 29));
  header.writeUInt32BE(value, offset);
  return Buffer.concat([signature, chunk('IHDR', header), bytes.subarray(33)]);
}
afterEach(() => vi.restoreAllMocks());

describe('sanitised PNG upload', () => {
  it('finishes a real RGBA PDF secondary decode', async () => {
    const result = await sanitizeLogoPng(png());
    expect(result).toMatchObject({ width: 200, height: 50 });
  });
  it('accepts palette with tRNS, including packed palette depths', async () => {
    for (const depth of [1, 2, 4, 8])
      expect(
        (await sanitizeLogoPng(png({ type: 3, depth, transparency: Buffer.from([255]) }))).width,
      ).toBe(200);
  });
  it('strips text and EXIF metadata before PDFKit and storage', async () => {
    const check = vi.spyOn(pngPdfCheck, 'check').mockResolvedValue();
    const result = await sanitizeLogoPng(
      png({
        extra: Buffer.concat([
          chunk('tEXt', Buffer.from('SECRET-METADATA')),
          chunk('eXIf', Buffer.from('private exif')),
        ]),
      }),
    );
    expect(Buffer.from(result.png).toString('latin1')).not.toMatch(
      /SECRET-METADATA|eXIf|private exif/,
    );
    expect(check).toHaveBeenCalledWith(result.png);
  });
  it('accepts exactly 262144 input bytes and strips padding', async () => {
    const base = png();
    const padded = png({ extra: chunk('tEXt', Buffer.alloc(262144 - base.length - 12)) });
    expect(padded.length).toBe(262144);
    expect((await sanitizeLogoPng(padded)).png.byteLength).toBeLessThan(262144);
  });
  it('rejects bad dimensions before inflate or the PDF decoder', async () => {
    const inflate = vi.spyOn(zlib, 'inflateSync'),
      secondary = vi.spyOn(pngPdfCheck, 'check');
    const oversized = alterHeader(alterHeader(png(), 0, 100000), 4, 100000);
    await expect(sanitizeLogoPng(oversized)).rejects.toMatchObject({ code: 'LOGO_BAD_DIMENSIONS' });
    expect(inflate).not.toHaveBeenCalled();
    expect(secondary).not.toHaveBeenCalled();
  });
});

const malformed: readonly [string, () => Buffer, string][] = [
  ['bad CRC', () => Buffer.concat([png().subarray(0, -1), Buffer.from([0])]), 'LOGO_UNREADABLE'],
  ['truncated chunk', () => png().subarray(0, -3), 'LOGO_UNREADABLE'],
  ['bytes after IEND', () => Buffer.concat([png(), Buffer.from('polyglot')]), 'LOGO_UNREADABLE'],
  ['two IHDR', () => png({ extra: png().subarray(8, 33) }), 'LOGO_UNREADABLE'],
  ['APNG acTL', () => png({ extra: chunk('acTL', Buffer.alloc(8)) }), 'LOGO_UNREADABLE'],
  ['16-bit', () => png({ depth: 16 }), 'LOGO_UNREADABLE'],
  ['interlaced', () => png({ interlace: 1 }), 'LOGO_UNREADABLE'],
  ['colour type 1', () => png({ type: 1 }), 'LOGO_UNREADABLE'],
  ['PLTE on colour type 2', () => png({ type: 2, palette: Buffer.alloc(3) }), 'LOGO_UNREADABLE'],
  ['missing PLTE on type 3', () => png({ type: 3, palette: null }), 'LOGO_UNREADABLE'],
  ['PLTE length 770', () => png({ type: 3, palette: Buffer.alloc(770) }), 'LOGO_UNREADABLE'],
  ['tRNS on type 6', () => png({ transparency: Buffer.from([255]) }), 'LOGO_UNREADABLE'],
  [
    'tRNS longer than palette',
    () => png({ type: 3, transparency: Buffer.alloc(2) }),
    'LOGO_UNREADABLE',
  ],
  ['corrupt alpha IDAT', () => png({ idat: Buffer.from('corrupt') }), 'LOGO_UNREADABLE'],
  [
    'inflate exceeds expectedRaw',
    () => png({ raw: Buffer.alloc(50 * 801 + 1) }),
    'LOGO_UNREADABLE',
  ],
  [
    'indexed+tRNS corrupt stream',
    () => png({ type: 3, transparency: Buffer.from([255]), idat: Buffer.from('corrupt') }),
    'LOGO_UNREADABLE',
  ],
  [
    'filter byte 5',
    () => png({ raw: Buffer.concat([Buffer.from([5]), Buffer.alloc(50 * 801 - 1)]) }),
    'LOGO_UNREADABLE',
  ],
  ['10x10', () => png({ width: 10, height: 10 }), 'LOGO_BAD_DIMENSIONS'],
  ['10:1 ratio', () => png({ width: 1000, height: 100 }), 'LOGO_BAD_DIMENSIONS'],
  ['JPEG', () => Buffer.from([255, 216, 255, 224]), 'LOGO_UNSUPPORTED_TYPE'],
  ['SVG', () => Buffer.from('<svg></svg>'), 'LOGO_UNSUPPORTED_TYPE'],
  ['empty', () => Buffer.alloc(0), 'LOGO_UNSUPPORTED_TYPE'],
  ['262145 bytes', () => Buffer.alloc(262145), 'LOGO_TOO_LARGE'],
  [
    'noncontiguous IDAT',
    () => {
      const base = png();
      return Buffer.concat([base.subarray(0, -12), chunk('tEXt'), chunk('IDAT'), chunk('IEND')]);
    },
    'LOGO_UNREADABLE',
  ],
];
it.each(malformed)('rejects %s before PDFKit', async (_name, bytes, code) => {
  const secondary = vi.spyOn(pngPdfCheck, 'check');
  await expect(sanitizeLogoPng(bytes())).rejects.toMatchObject({ code });
  expect(secondary).not.toHaveBeenCalled();
});

it('maps a secondary decoder error to LOGO_UNREADABLE', async () => {
  vi.spyOn(pngPdfCheck, 'check').mockRejectedValue(new Error('decoder failure'));
  await expect(sanitizeLogoPng(png())).rejects.toMatchObject({ code: 'LOGO_UNREADABLE' });
});

it('rejects high-bit chunk type aliases before PDFKit can see a different IDAT stream', async () => {
  const original = png();
  const idatLength = original.readUInt32BE(33);
  const compressed = original.subarray(41, 41 + idatLength);
  const alias = Buffer.from([0xc9, 0x44, 0x41, 0x54]);
  const size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(2);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([alias, compressed.subarray(0, 2)])));
  const hostile = Buffer.concat([
    original.subarray(0, 33),
    size,
    alias,
    compressed.subarray(0, 2),
    crc,
    chunk('IDAT', compressed.subarray(2)),
    chunk('IEND'),
  ]);
  const secondary = vi.spyOn(pngPdfCheck, 'check');
  await expect(sanitizeLogoPng(hostile)).rejects.toMatchObject({ code: 'LOGO_UNREADABLE' });
  expect(secondary).not.toHaveBeenCalled();
});

async function pdfAlpha(pngBytes: Uint8Array): Promise<Buffer> {
  const doc = new PDFDocument(),
    pieces: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (piece: Buffer) => pieces.push(piece));
    doc.on('end', () => resolve(Buffer.concat(pieces)));
    doc.on('error', reject);
  });
  doc.image(Buffer.from(pngBytes), 0, 0);
  doc.end();
  const pdf = (await finished).toString('latin1');
  const image = [...pdf.matchAll(/\d+ 0 obj\n<<([\s\S]*?)>>\nstream\n([\s\S]*?)\nendstream/g)].find(
    (match) =>
      match[1]?.includes('/ColorSpace /DeviceGray') && match[1]?.includes('/Subtype /Image'),
  );
  if (!image?.[2]) throw new Error('missing alpha image');
  return zlib.inflateSync(Buffer.from(image[2], 'latin1'));
}

it.each([1, 2, 4])(
  'normalises packed indexed depth %s to the same opaque alpha in PDF and browser',
  async (depth) => {
    const entries = 1 << depth;
    const palette = Buffer.from(
      Array.from({ length: entries * 3 }, (_, index) => (index < 3 ? 0 : 255)),
    );
    const stride = 1 + Math.ceil((64 * depth) / 8);
    const raw = Buffer.concat(
      Array.from({ length: 16 }, () =>
        Buffer.concat([Buffer.from([0]), Buffer.alloc(stride - 1, 255)]),
      ),
    );
    const transparency = Buffer.from(
      Array.from({ length: entries }, (_, index) => (index === 0 ? 0 : 255)),
    );
    const result = await sanitizeLogoPng(
      png({ width: 64, height: 16, type: 3, depth, palette, transparency, raw }),
    );
    expect(Buffer.from(result.png)[24]).toBe(8);
    expect(Buffer.from(result.png)[25]).toBe(6);
    expect(await pdfAlpha(result.png)).toEqual(Buffer.alloc(64 * 16, 255));
  },
);
it.each([0, 2])('preserves type %s tRNS exact samples as RGBA alpha', async (type) => {
  const samples = type === 0 ? [128] : [128, 64, 32];
  const transparency = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => transparency.writeUInt16BE(sample, index * 2));
  const pixels = Buffer.concat(
    Array.from({ length: 64 }, (_, index) =>
      Buffer.from(index % 2 === 0 ? samples : samples.map((value) => value + 1)),
    ),
  );
  const raw = Buffer.concat(
    Array.from({ length: 16 }, () => Buffer.concat([Buffer.from([0]), pixels])),
  );
  const result = await sanitizeLogoPng(png({ width: 64, height: 16, type, transparency, raw }));
  expect(await pdfAlpha(result.png)).toEqual(
    Buffer.from(Array.from({ length: 64 * 16 }, (_, index) => (index % 2 === 0 ? 0 : 255))),
  );
});
it.each([1, 2, 3, 4])(
  'reverses packed PNG filter %s before normalising transparency',
  async (filter) => {
    const decoded = Buffer.alloc(8, 255);
    const rows = Array.from({ length: 16 }, (_, y) => {
      const encoded = Buffer.from(
        Array.from(decoded, (value, x) => {
          const left = x === 0 ? 0 : 255,
            above = y === 0 ? 0 : 255,
            upperLeft = y === 0 || x === 0 ? 0 : 255;
          const prediction =
            filter === 1
              ? left
              : filter === 2
                ? above
                : filter === 3
                  ? Math.floor((left + above) / 2)
                  : above === upperLeft
                    ? left
                    : above;
          return (value - prediction + 256) & 255;
        }),
      );
      return Buffer.concat([Buffer.from([filter]), encoded]);
    });
    const result = await sanitizeLogoPng(
      png({
        width: 64,
        height: 16,
        type: 3,
        depth: 1,
        palette: Buffer.from([0, 0, 0, 255, 255, 255]),
        transparency: Buffer.from([0, 255]),
        raw: Buffer.concat(rows),
      }),
    );
    expect(await pdfAlpha(result.png)).toEqual(Buffer.alloc(64 * 16, 255));
  },
);
