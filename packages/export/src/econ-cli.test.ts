// CLI-враппер econ-validate: exit codes (0 pass / 1 fail / 2 плохой вход),
// причины отказа в stderr, отчёт в stdout; вся математика — в econ.test.ts.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { CliIo } from './econ-cli.js';
import { runEconValidate } from './econ-cli.js';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/econ/', import.meta.url));

interface CapturedIo extends CliIo {
  readonly outLines: string[];
  readonly errLines: string[];
}

function capturedIo(): CapturedIo {
  const outLines: string[] = [];
  const errLines: string[] = [];
  return {
    outLines,
    errLines,
    out: (line) => outLines.push(line),
    err: (line) => errLines.push(line),
  };
}

describe('runEconValidate', () => {
  it('валидный forecast → exit 0 и PASS-отчёт в stdout', () => {
    const io = capturedIo();
    const code = runEconValidate([join(FIXTURES_DIR, 'forecast-valid.json')], io);
    expect(code).toBe(0);
    expect(io.outLines[0]).toBe('ECON-001: PASS');
    expect(io.outLines.join('\n')).toContain('break-even scans:          49');
    expect(io.errLines).toEqual([]);
  });

  it('reserve ниже floor → exit 1 и причина [reserve-floor] в stderr', () => {
    const io = capturedIo();
    const code = runEconValidate([join(FIXTURES_DIR, 'forecast-reserve-below-floor.json')], io);
    expect(code).toBe(1);
    expect(io.errLines[0]).toBe('ECON-001: FAIL');
    expect(io.errLines.join('\n')).toContain('[reserve-floor]');
  });

  it('несуществующий файл → exit 2 с внятной ошибкой', () => {
    const io = capturedIo();
    const code = runEconValidate(['/nonexistent/forecast.json'], io);
    expect(code).toBe(2);
    expect(io.errLines.join('\n')).toContain('не удалось прочитать forecast-файл');
  });

  it('файл с невалидным JSON → exit 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'econ-cli-'));
    const path = join(dir, 'broken.json');
    writeFileSync(path, '{not json');
    const io = capturedIo();
    expect(runEconValidate([path], io)).toBe(2);
    expect(io.errLines.join('\n')).toContain('не является валидным JSON');
  });

  it('без аргументов → exit 2 и usage-подсказка', () => {
    const io = capturedIo();
    expect(runEconValidate([], io)).toBe(2);
    expect(io.errLines[0]).toContain('использование');
  });
});
