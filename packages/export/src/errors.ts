// Типизированные ошибки пакета export (T-11). ExportBuildError — нарушение
// контракта §16 на входе билдера (баг вызывающего кода, fail fast);
// EconInputError — непригодный forecast-файл ECON-001 (внешние данные).

/** Базовый класс: `error instanceof ExportError` покрывает все ошибки пакета. */
export class ExportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Вход record-билдера нарушает контракт §16/D-014..D-019 — запись не собирается. */
export class ExportBuildError extends ExportError {}

/** Forecast-файл ECON-001 не читается или не парсится как JSON-объект. */
export class EconInputError extends ExportError {}
