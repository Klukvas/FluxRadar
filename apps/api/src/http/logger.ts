// Минимальный интерфейс логгера API. В тестах используется silentLogger —
// прогон supertest не должен шуметь в stdout; в проде main.ts подключает
// stdout/stderr-логгер. Детали (stack, ids) остаются в логах и никогда
// не попадают в HTTP-ответы (см. error-handler).

export interface ApiLogger {
  info(message: string, context?: Readonly<Record<string, unknown>>): void;
  warn(message: string, context?: Readonly<Record<string, unknown>>): void;
  error(message: string, context?: Readonly<Record<string, unknown>>): void;
}

const noop = (): void => undefined;

/** Логгер тестов: молчит намеренно (требование T-12 «в тестах молчит»). */
export const silentLogger: ApiLogger = { info: noop, warn: noop, error: noop };

function writeLine(
  stream: NodeJS.WritableStream,
  level: string,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): void {
  const entry = { time: new Date().toISOString(), level, message, ...context };
  stream.write(`${JSON.stringify(entry)}\n`);
}

/** Продовый JSON-line логгер: info → stdout, warn/error → stderr. */
export const stdoutLogger: ApiLogger = {
  info: (message, context) => writeLine(process.stdout, 'info', message, context),
  warn: (message, context) => writeLine(process.stderr, 'warn', message, context),
  error: (message, context) => writeLine(process.stderr, 'error', message, context),
};
