import { describe, expect, it } from 'vitest';

import { normalizeField, normalizeUrl } from './normalize-url.js';

describe('normalizeUrl: equivalence/difference таблица (план §14)', () => {
  it('lowercase host: https://Example.com/a/ == https://example.com/a/', () => {
    expect(normalizeUrl('https://Example.com/a/')).toBe('https://example.com/a/');
    expect(normalizeUrl('https://Example.com/a/')).toBe(normalizeUrl('https://example.com/a/'));
  });

  it('lowercase scheme: HTTPS://EXAMPLE.COM/a == https://example.com/a', () => {
    expect(normalizeUrl('HTTPS://EXAMPLE.COM/a')).toBe('https://example.com/a');
  });

  it('trailing slash сохраняется: /a != /a/', () => {
    expect(normalizeUrl('https://example.com/a')).not.toBe(normalizeUrl('https://example.com/a/'));
  });

  it('query сортируется, трекинг удаляется: ?utm_source=x&b=2&a=1 == ?a=1&b=2', () => {
    expect(normalizeUrl('https://example.com/a/?utm_source=x&b=2&a=1')).toBe(
      'https://example.com/a/?a=1&b=2',
    );
    expect(normalizeUrl('https://example.com/a/?utm_source=x&b=2&a=1')).toBe(
      normalizeUrl('https://example.com/a/?a=1&b=2'),
    );
  });

  it('duplicate query pairs сохраняются после сортировки', () => {
    expect(normalizeUrl('https://example.com/a?b=2&a=1&b=2')).toBe(
      'https://example.com/a?a=1&b=2&b=2',
    );
    expect(normalizeUrl('https://example.com/a?b=2&b=1')).toBe('https://example.com/a?b=1&b=2');
  });

  it('default port удаляется: :443 == без порта; :80 для http', () => {
    expect(normalizeUrl('https://example.com:443/a')).toBe('https://example.com/a');
    expect(normalizeUrl('http://example.com:80/a')).toBe('http://example.com/a');
  });

  it('non-default port сохраняется: :8443 != default', () => {
    expect(normalizeUrl('https://example.com:8443/a')).toBe('https://example.com:8443/a');
    expect(normalizeUrl('https://example.com:8443/a')).not.toBe(
      normalizeUrl('https://example.com/a'),
    );
  });

  it('NFC == NFD после нормализации (é composed vs decomposed)', () => {
    const composed = normalizeUrl('https://example.com/café');
    const decomposed = normalizeUrl('https://example.com/café');
    expect(composed).toBe('https://example.com/caf%C3%A9');
    expect(decomposed).toBe(composed);
  });

  it('NFC == NFD и в query-компонентах (D-018)', () => {
    expect(normalizeUrl('https://example.com/?café=1')).toBe(
      normalizeUrl('https://example.com/?café=1'),
    );
  });

  it('dot-segments разрешаются: /a/../b → /b', () => {
    expect(normalizeUrl('https://example.com/a/../b')).toBe('https://example.com/b');
    expect(normalizeUrl('https://example.com/a/./b/../c')).toBe('https://example.com/a/c');
  });

  it('fragment отбрасывается', () => {
    expect(normalizeUrl('https://example.com/a#section')).toBe('https://example.com/a');
  });

  it('userinfo запрещён → throw', () => {
    expect(() => normalizeUrl('https://user:pass@example.com/')).toThrow(/userinfo/);
    expect(() => normalizeUrl('https://user@example.com/')).toThrow(/userinfo/);
  });
});

describe('normalizeUrl: трекинг-параметры (D-115)', () => {
  it('удаляет весь список и utm_-префикс', () => {
    expect(
      normalizeUrl(
        'https://example.com/a?utm_campaign=x&gclid=1&fbclid=2&msclkid=3&yclid=4&mc_cid=5&mc_eid=6&keep=1',
      ),
    ).toBe('https://example.com/a?keep=1');
  });

  it('сравнение case-sensitive: UTM_source и GCLID сохраняются', () => {
    expect(normalizeUrl('https://example.com/a?UTM_source=x&GCLID=1')).toBe(
      'https://example.com/a?GCLID=1&UTM_source=x',
    );
  });

  it('имя сверяется после декодирования unreserved: %75tm_source удаляется', () => {
    expect(normalizeUrl('https://example.com/a?%75tm_source=x&b=1')).toBe(
      'https://example.com/a?b=1',
    );
  });
});

describe('normalizeUrl: QA-11 (IDN, percent-encoding, идемпотентность)', () => {
  it('IDN → punycode: https://пример.рф/', () => {
    expect(normalizeUrl('https://пример.рф/')).toBe('https://xn--e1afmkfd.xn--p1ai/');
  });

  it('percent-decode только unreserved: %7E → ~, %41 → A', () => {
    expect(normalizeUrl('https://example.com/%7Euser/%41')).toBe('https://example.com/~user/A');
  });

  it('reserved percent-последовательности сохраняются с UPPERCASE hex (D-114)', () => {
    expect(normalizeUrl('https://example.com/a%2fb')).toBe('https://example.com/a%2Fb');
    expect(normalizeUrl('https://example.com/a%20b')).toBe('https://example.com/a%20b');
  });

  it('не-ASCII после NFC re-encode-ится в uppercase percent-encoding (D-114)', () => {
    expect(normalizeUrl('https://example.com/%c3%a9')).toBe('https://example.com/%C3%A9');
  });

  it('невалидный UTF-8 в percent-encoding сохраняется побайтно', () => {
    expect(normalizeUrl('https://example.com/a%ff%c3b')).toBe('https://example.com/a%FF%C3b');
  });

  it('одиночный % вне hex-пары кодируется как %25 (D-114)', () => {
    expect(normalizeUrl('https://example.com/100%')).toBe('https://example.com/100%25');
    expect(normalizeUrl('https://example.com/a?b=50%&c=1')).toBe(
      'https://example.com/a?b=50%25&c=1',
    );
  });

  it('%00 в path и query сохраняется как encoded byte', () => {
    expect(normalizeUrl('https://example.com/a%00b?k=%00')).toBe('https://example.com/a%00b?k=%00');
  });

  it('WHATWG pre-parse зафиксирован: tab/newline вырезаются, backslash → slash', () => {
    // Поведение парсера WHATWG URL до нормализации v1 — фиксируем как контракт.
    expect(normalizeUrl('https://exa\tmple.com/a\nb')).toBe('https://example.com/ab');
    expect(normalizeUrl('https://example.com\\x\\y')).toBe('https://example.com/x/y');
  });

  it('пустой query (?) отбрасывается; query из одних трекеров тоже (D-116)', () => {
    expect(normalizeUrl('https://example.com/a?')).toBe('https://example.com/a');
    expect(normalizeUrl('https://example.com/a?utm_source=x')).toBe('https://example.com/a');
  });

  it('bare key канонизируется в name=; пустые сегменты && отбрасываются (D-116)', () => {
    expect(normalizeUrl('https://example.com/a?flag&b=1')).toBe('https://example.com/a?b=1&flag=');
    expect(normalizeUrl('https://example.com/a?b=1&&c=2')).toBe('https://example.com/a?b=1&c=2');
  });

  it('пустой путь → /; query при этом сохраняется', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
    expect(normalizeUrl('https://example.com?a=1')).toBe('https://example.com/?a=1');
  });

  it('не-http(s) схема → throw (D-113); мусор → throw', () => {
    expect(() => normalizeUrl('ftp://example.com/a')).toThrow(/scheme/);
    expect(() => normalizeUrl('not a url')).toThrow(/absolute URL/);
  });

  const idempotencyInputs = [
    'https://Example.com/a/',
    'https://example.com/a',
    'https://example.com/a/?b=2&utm_source=x&a=1',
    'https://example.com/a?b=2&a=1&b=2',
    'https://example.com:8443/a',
    'https://example.com/café',
    'https://example.com/a/../b',
    'https://пример.рф/путь?имя=значение',
    'https://example.com/%7Euser/%41%2f%c3%a9',
    'https://example.com/a%ff%25b',
    'https://example.com/a?flag&b=1',
    'http://example.com:80/',
  ];

  it.each(idempotencyInputs)('идемпотентность: normalizeUrl(normalizeUrl(%s))', (input) => {
    const once = normalizeUrl(input);
    expect(normalizeUrl(once)).toBe(once);
  });
});

describe('normalizeField (план §14)', () => {
  it('trim + NFC + CRLF→LF', () => {
    expect(normalizeField('  div.hero \r\n a \r\n ')).toBe('div.hero \n a');
    expect(normalizeField('café')).toBe('café');
  });

  it('literal NUL сохраняется, одиночный \\r не заменяется', () => {
    expect(normalizeField('a\u0000b')).toBe('a\u0000b');
    expect(normalizeField('a\rb')).toBe('a\rb');
  });

  it('идемпотентность', () => {
    const once = normalizeField('  a\r\nb\u0000 café ');
    expect(normalizeField(once)).toBe(once);
  });

  it('CRLF→LF до неподвижной точки: CR CR LF не оставляет новый CRLF (D-118)', () => {
    // Регрессия: однопроходный replaceAll давал 'a\r\nb' — повторная
    // нормализация меняла значение и, значит, fingerprint.
    expect(normalizeField('a\r\r\nb')).toBe('a\nb');
    expect(normalizeField('a\r\r\r\nb')).toBe('a\nb');
    for (const input of ['a\r\r\nb', 'x\r\r\r\ny\rz']) {
      const normalizedOnce = normalizeField(input);
      expect(normalizeField(normalizedOnce)).toBe(normalizedOnce);
    }
  });
});
