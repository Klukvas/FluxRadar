#!/usr/bin/env node
// Тонкий CLI-враппер ECON-001: `econ-validate <forecast.json>`.
// Вся логика — в чистом validateEconForecast (econ.ts); здесь только I/O.
// Exit codes: 0 — pass, 1 — fail, 2 — непригодный вход/использование.

import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import type { EconReport } from './econ.js';
import { validateEconForecast } from './econ.js';
import { EconInputError } from './errors.js';

export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** Читает и парсит forecast-файл; любая проблема — типизированная EconInputError. */
export function readForecastFile(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new EconInputError(`не удалось прочитать forecast-файл «${path}»`, { cause: error });
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new EconInputError(`forecast-файл «${path}» не является валидным JSON`, { cause: error });
  }
}

export function runEconValidate(argv: readonly string[], io: CliIo): number {
  const path = argv[0];
  if (path === undefined || argv.length > 1) {
    io.err('использование: econ-validate <forecast.json>');
    return 2;
  }
  let forecast: unknown;
  try {
    forecast = readForecastFile(path);
  } catch (error) {
    if (error instanceof EconInputError) {
      const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
      io.err(`econ-validate: ${error.message}${cause}`);
      return 2;
    }
    throw error; // неожиданная ошибка — это баг, наверх с полным stack
  }
  const result = validateEconForecast(forecast);
  if (result.pass) {
    io.out('ECON-001: PASS');
    reportLines(result.report).forEach(io.out);
    return 0;
  }
  io.err('ECON-001: FAIL');
  result.failures.forEach(({ code, message }) => io.err(`  [${code}] ${message}`));
  if (result.report !== null) {
    reportLines(result.report).forEach(io.err);
  }
  return 1;
}

function reportLines(report: EconReport): readonly string[] {
  return [
    `  forecast scans:            ${report.forecastScans}`,
    `  gross revenue (пересчёт):  $${report.forecastGrossRevenueUsd.toFixed(2)}`,
    `  support-reserve floor:     $${report.supportReserveFloorUsd.toFixed(2)}`,
    `  contribution margin (avg): $${report.weightedContributionMarginUsd.toFixed(2)}`,
    `  break-even scans:          ${report.breakEvenScans}`,
    `  operational floor:         ${report.operationalFloorScans}`,
  ];
}

/**
 * D-188: Node резолвит `import.meta.url` через realpath, а `process.argv[1]`
 * при запуске через bin-шим pnpm — это symlink в `node_modules/.bin`. Наивное
 * сравнение путей не совпадало, main-блок не выполнялся, и CLI молча выходил
 * с кодом 0 при любом входе — ложный PASS economics gate. Сравниваем
 * канонические (realpath) пути.
 */
function isDirectCliRun(entryPoint: string | undefined): boolean {
  if (entryPoint === undefined) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(realpathSync(entryPoint)).href;
  } catch {
    // realpath недоступен (файл исчез между exec и проверкой) —
    // откатываемся к сравнению без резолва symlink-ов.
    return import.meta.url === pathToFileURL(entryPoint).href;
  }
}

if (isDirectCliRun(process.argv[1])) {
  process.exitCode = runEconValidate(process.argv.slice(2), {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
}
