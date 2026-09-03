// URL-нормализация v1 (план §14 + D-018, D-113..D-116).
// Контракт заморожен: любое изменение поведения требует новой версии fingerprint.

const TRACKING_PARAM_NAMES: ReadonlySet<string> = new Set([
  'gclid',
  'fbclid',
  'msclkid',
  'yclid',
  'mc_cid',
  'mc_eid',
]);
const TRACKING_PARAM_PREFIX = 'utm_';

const UNRESERVED_ASCII = /^[A-Za-z0-9._~-]$/;
const HEX_PAIR = /^[0-9A-Fa-f]{2}$/;

/** Октет из percent-последовательности (number) или literal-символ исходной строки. */
type ComponentToken = number | string;

/**
 * Прогон текста (подлежит NFC и re-encode) либо сохранённая percent-последовательность
 * (uppercase, граница NFC-прогонов — D-116).
 */
type ComponentPart =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'encoded'; readonly value: string };

/**
 * Нормализует абсолютный http/https URL по правилам v1:
 * lowercase scheme/host, punycode host, срез default port, запрет userinfo,
 * отброс fragment, разрешение dot-segments, селективный percent-decode + NFC,
 * сортировка query-пар по UTF-8 байтам и удаление трекинг-параметров.
 * Результат — чистый ASCII (D-114). Идемпотентна.
 */
export function normalizeUrl(input: string): string {
  const url = parseAbsoluteUrl(input);
  if (url.username !== '' || url.password !== '') {
    throw new Error('normalizeUrl: userinfo is forbidden by URL normalization v1 (plan §14)');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `normalizeUrl: unsupported scheme "${url.protocol}" — URL normalization v1 covers only http/https (D-113)`,
    );
  }
  // WHATWG URL уже дал lowercase scheme/host, punycode host, разрешённые
  // dot-segments и срезанный default port (80/443).
  const path = normalizeComponent(url.pathname);
  const query = normalizeQuery(url.search);
  const port = url.port === '' ? '' : `:${url.port}`;
  const querySuffix = query === null ? '' : `?${query}`;
  return `${url.protocol}//${url.hostname}${port}${path}${querySuffix}`;
}

/**
 * Нормализация текстовых полей fingerprint (resource/selector/parameter/variant):
 * trim → NFC → CRLF→LF (порядок из §14). Замена CRLF идёт до неподвижной точки
 * (`\r+\n` → `\n`): однопроходный replaceAll на входе `a\r\r\nb` оставлял бы
 * новый CRLF (сохранённый `\r` + вставленный `\n`) и ломал идемпотентность
 * (D-118). Literal NUL сохраняется как есть; одиночный `\r` без последующего
 * `\n` не трогается — план требует замены только пары CRLF.
 */
export function normalizeField(value: string): string {
  return value.trim().normalize('NFC').replace(/\r+\n/g, '\n');
}

function parseAbsoluteUrl(input: string): URL {
  try {
    return new URL(input);
  } catch (error) {
    throw new Error(`normalizeUrl: input is not an absolute URL: ${JSON.stringify(input)}`, {
      cause: error,
    });
  }
}

/** null — query отсутствует в нормализованном URL (пустой или полностью вычищен, D-116). */
function normalizeQuery(search: string): string | null {
  if (search === '' || search === '?') {
    return null;
  }
  const pairs = search
    .slice(1)
    .split('&')
    .filter((segment) => segment !== '')
    .map(parseQueryPair)
    .filter((pair) => !isTrackingParam(pair.name));
  if (pairs.length === 0) {
    return null;
  }
  const sorted = [...pairs].sort(
    (a, b) => compareUtf8Bytes(a.name, b.name) || compareUtf8Bytes(a.value, b.value),
  );
  return sorted.map((pair) => `${pair.name}=${pair.value}`).join('&');
}

function parseQueryPair(segment: string): { readonly name: string; readonly value: string } {
  const separatorIndex = segment.indexOf('=');
  // Bare key без '=' канонизируется как пара (name, '') — модель query из §14 (D-116).
  const rawName = separatorIndex === -1 ? segment : segment.slice(0, separatorIndex);
  const rawValue = separatorIndex === -1 ? '' : segment.slice(separatorIndex + 1);
  return { name: normalizeComponent(rawName), value: normalizeComponent(rawValue) };
}

/** Точное case-sensitive совпадение по нормализованному имени; имена не lowercase-ятся (D-115). */
function isTrackingParam(normalizedName: string): boolean {
  return (
    TRACKING_PARAM_NAMES.has(normalizedName) || normalizedName.startsWith(TRACKING_PARAM_PREFIX)
  );
}

/** Сортировка query-пар — побайтово по UTF-8 (D-018), не по UTF-16 code units. */
function compareUtf8Bytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Нормализация одного компонента (path, query name, query value):
 * percent-decode только unreserved ASCII; валидный не-ASCII UTF-8 декодируется,
 * NFC-ится и re-encode-ится обратно в uppercase percent-encoding; невалидные и
 * reserved октеты сохраняются как uppercase %XX (D-114).
 */
function normalizeComponent(raw: string): string {
  return serializeParts(splitIntoParts(tokenize(raw)));
}

function tokenize(raw: string): readonly ComponentToken[] {
  const tokens: ComponentToken[] = [];
  let index = 0;
  while (index < raw.length) {
    const hexPair = raw.slice(index + 1, index + 3);
    if (raw[index] === '%' && HEX_PAIR.test(hexPair)) {
      tokens.push(Number.parseInt(hexPair, 16));
      index += 3;
    } else {
      tokens.push(raw[index] as string);
      index += 1;
    }
  }
  return tokens;
}

function splitIntoParts(tokens: readonly ComponentToken[]): readonly ComponentPart[] {
  const parts: ComponentPart[] = [];
  let text = '';
  const flushText = (): void => {
    if (text !== '') {
      parts.push({ kind: 'text', value: text });
      text = '';
    }
  };
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) {
      break; // недостижимо: index < tokens.length; ветка для noUncheckedIndexedAccess
    }
    if (typeof token === 'string') {
      text += token;
      index += 1;
      continue;
    }
    if (token < 0x80) {
      const char = String.fromCharCode(token);
      if (UNRESERVED_ASCII.test(char)) {
        text += char;
      } else {
        flushText();
        parts.push({ kind: 'encoded', value: encodeByte(token) });
      }
      index += 1;
      continue;
    }
    const sequence = readUtf8Sequence(tokens, index);
    if (sequence === null) {
      flushText();
      parts.push({ kind: 'encoded', value: encodeByte(token) });
      index += 1;
    } else {
      text += sequence.value;
      index += sequence.byteLength;
    }
  }
  flushText();
  return parts;
}

/**
 * Строгий UTF-8: диапазоны продолжений по RFC 3629 (без overlong-форм,
 * суррогатов и code points выше U+10FFFF). Невалидная последовательность → null.
 */
function readUtf8Sequence(
  tokens: readonly ComponentToken[],
  start: number,
): { readonly value: string; readonly byteLength: number } | null {
  const lead = tokens[start];
  if (typeof lead !== 'number') {
    return null;
  }
  const spec = leadByteSpec(lead);
  if (spec === null) {
    return null;
  }
  const bytes = [lead];
  for (let offset = 1; offset < spec.byteLength; offset += 1) {
    const continuation = tokens[start + offset];
    const min = offset === 1 ? spec.firstMin : 0x80;
    const max = offset === 1 ? spec.firstMax : 0xbf;
    if (typeof continuation !== 'number' || continuation < min || continuation > max) {
      return null;
    }
    bytes.push(continuation);
  }
  return { value: Buffer.from(bytes).toString('utf8'), byteLength: spec.byteLength };
}

function leadByteSpec(
  lead: number,
): { readonly byteLength: number; readonly firstMin: number; readonly firstMax: number } | null {
  if (lead >= 0xc2 && lead <= 0xdf) return { byteLength: 2, firstMin: 0x80, firstMax: 0xbf };
  if (lead === 0xe0) return { byteLength: 3, firstMin: 0xa0, firstMax: 0xbf };
  if (lead === 0xed) return { byteLength: 3, firstMin: 0x80, firstMax: 0x9f };
  if (lead >= 0xe1 && lead <= 0xef) return { byteLength: 3, firstMin: 0x80, firstMax: 0xbf };
  if (lead === 0xf0) return { byteLength: 4, firstMin: 0x90, firstMax: 0xbf };
  if (lead === 0xf4) return { byteLength: 4, firstMin: 0x80, firstMax: 0x8f };
  if (lead >= 0xf1 && lead <= 0xf3) return { byteLength: 4, firstMin: 0x80, firstMax: 0xbf };
  return null;
}

function serializeParts(parts: readonly ComponentPart[]): string {
  return parts
    .map((part) => (part.kind === 'encoded' ? part.value : encodeText(part.value.normalize('NFC'))))
    .join('');
}

function encodeText(text: string): string {
  let out = '';
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint < 0x80) {
      // '%' вне валидной hex-пары — literal-символ; кодируем, чтобы результат
      // был однозначен и идемпотентен (D-114).
      out += char === '%' ? '%25' : char;
    } else {
      out += Array.from(Buffer.from(char, 'utf8'), encodeByte).join('');
    }
  }
  return out;
}

function encodeByte(byte: number): string {
  return `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
}
