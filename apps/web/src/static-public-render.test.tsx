// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { staticPublicFiles } from './static-public-render';

const template = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
describe('public first-response HTML', () => {
  const files = staticPublicFiles(template);
  it('renders all sixteen locale documents without a browser or network', () => {
    expect(files).toHaveLength(16);
    expect(new Set(files.map((file) => file.fileName)).size).toBe(16);
    for (const file of files) {
      expect(file.html).toContain('<h1');
      expect(file.html).toContain('data-public-snapshot=');
      expect(file.html).not.toContain('<div id="root"></div>');
      expect(file.html).toContain('<noscript>');
      expect(file.html).not.toContain('application/json');
      const uk = file.fileName.startsWith('uk/');
      expect(file.html).toContain(`<html lang="${uk ? 'uk' : 'en'}">`);
      expect(file.html).toContain(uk ? 'href="/uk/checks"' : 'href="/checks"');
    }
  });
  it('describes actual service offers without merchant inventory or invented reviews', () => {
    const home = files.find((file) => file.fileName === 'index.html')?.html ?? '';
    expect(home).toContain('"@type":"Service"');
    expect(home).not.toMatch(/"@type":"Product"|aggregateRating|InStock|shippingDetails/);
    expect(home).toContain('"price":"39"');
    expect(home).toContain('"price":"87"');
  });
});
