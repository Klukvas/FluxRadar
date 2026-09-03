# REVIEW_T-01 — Скелет монорепо (pnpm, TS, Vitest, lint)

**Дата:** 2026-09-03 · **Ревьювер:** review-агент · **Вердикт:** **approved-with-fixes**

Критерии T-01 (все пять команд проходят) выполнены и до, и после исправлений. Однако два
скрытых дефекта фундамента сломали бы ближайшие задачи (T-03..T-12), поэтому исправлены в
рамках ревью. Найдено 5 проблем (2 high, 1 medium, 2 low) — все 5 исправлены.

## Объём проверки

- Структура workspace против `IMPLEMENTATION_PLAN.md` §1: `packages/{contracts,fingerprint,
  scoring,safe-fetch,crawler,rules,ai,export}` + `apps/{api,web}` — полное соответствие.
- Корневые скрипты `dev/build/test/lint/typecheck/format`, `pnpm-workspace.yaml`.
- `tsconfig.base.json`: strict, `NodeNext`, `verbatimModuleSyntax`, `isolatedModules`,
  `noUncheckedIndexedAccess`, declaration+maps — соответствует D-102.
- `exports`-карты всех пакетов (`types` + `default` → `dist`) — корректны для NodeNext/bundler;
  отсутствие top-level `main`/`types` не проблема: устаревших резолверов в цепочке нет.
- ESLint flat config: эмпирически проверено, что `.ts`/`.tsx` реально линтуются
  (probe-файл с неиспользуемой переменной пойман `@typescript-eslint/no-unused-vars`).
- Vitest per-package через `pnpm -r test` (D-103), placeholder-тесты во всех пакетах.
- `.gitignore` / `.env.example`: секретов нет, значения пустые, `.env` игнорируется.
- README: структура и команды соответствуют факту.
- Решения D-101..D-106 сверены с фактическим состоянием репозитория.
- Прогон `pnpm -r build && pnpm test && pnpm lint && pnpm typecheck` до и после исправлений.

## Найденные проблемы и исправления

### FIX-1 · high — TS 6.0 не подключает `@types` автоматически → Node API нигде не типизируются

Probe в `apps/api`: `process.env` → `TS2591: Cannot find name 'process'`. TypeScript 6.0
удалил автоматическое подключение `@types/*` (проверено изолированно: не работает даже при
локальном `node_modules/@types/node`); `apps/web` работал лишь потому, что явно задаёт
`types: ["vite/client"]`. Любое обращение к `process`/`console`/`node:*` валило бы typecheck
и build в T-05/T-06/T-07/T-12 сразу.

**Исправлено:** `"types": ["node"]` в `tsconfig.base.json`. Для `apps/web` остаётся
переопределение `["vite/client"]` — браузерный код Node-глобалы не видит (корректно).

### FIX-2 · high — тестовые файлы не проверялись типами вообще

D-104 исключил `src/**/*.test.ts` из tsconfig с обоснованием «ошибки типов в тестах ловятся
на прогоне». Премисса неверна: Vitest транспилирует esbuild-ом, который типы **стрипает, а не
проверяет**. Probe `const broken: number = 'строка'` в тесте проходил и `pnpm typecheck`,
и `pnpm test` зелёным. Для проекта, где ядро поставки — golden-vector-тесты
(T-03/T-04/T-08/T-09/T-11), это дыра фундамента.

**Исправлено (9 пакетов: packages/\* + apps/api):** `tsconfig.json` теперь покрывает весь
`src`, включая тесты (его используют `tsc --noEmit` и редактор); emit вынесен в новый
`tsconfig.build.json` (`extends` + `exclude: ["src/**/*.test.ts"]`); build-скрипты →
`tsc -p tsconfig.build.json`. Верифицировано: probe-ошибка ловится typecheck-ом,
тест-артефакты в `dist` не попадают.

### FIX-3 · medium — dev-скрипт `apps/api` ломался при появлении второго файла

`node --watch src/index.ts` (D-105) несовместим с NodeNext-спецификаторами `./foo.js`:
type stripping Node не маппит `.js` → `.ts` (проверено: `ERR_MODULE_NOT_FOUND`). Триггер
пересмотра в D-105 («не-erasable синтаксис») этот случай не покрывал — сломалось бы на первом
же втором файле в T-12.

**Исправлено:** в `apps/api/tsconfig.json` добавлены `allowImportingTsExtensions` +
`rewriteRelativeImportExtensions`. Конвенция: **внутри `apps/api` относительные импорты
пишутся с `.ts`** (node запускает `src` напрямую; tsc при сборке переписывает в `.js`).
Верифицировано probe-ом: `node src/...` ✓, в `dist` спецификатор переписан в
`./probe-helper.js` ✓, `node dist/...` ✓. `packages/*` остаются на `.js`-конвенции —
они исполняются из `dist`, там она корректна.

### FIX-4 · low — `@types/node` ^26 при `engines: node >=24`

Типы описывали API новее минимального рантайма — риск использовать несуществующее в Node 24.
**Исправлено:** `@types/node@^24.13.3` (lockfile обновлён).

### FIX-5 · low — `.gitignore` не покрывал `.env.local` и подобные

**Исправлено:** добавлены `.env.*` и `!.env.example`.

## Проверено и признано корректным (без изменений)

- «Vitest workspace» реализован как `pnpm -r test` вместо корневого vitest-конфига —
  допустимое отступление от буквы T-01: per-package команды всё равно нужны для проверок из
  TASK_BOARD (`pnpm --filter <pkg> test`); web явно `--passWithNoTests`, остальные пакеты
  падают громко при пропаже тестов.
- Отсутствие `composite`/project references — осознанный выбор; топологический порядок сборки
  обеспечит pnpm. **Внимание T-02+:** межпакетные зависимости обязаны объявляться в
  `package.json` (`"@fluxradar/contracts": "workspace:*"`), иначе порядок `pnpm -r build`
  не гарантирован.
- D-106 (`onlyBuiltDependencies: ["esbuild"]`) — соответствует, Vite/Vitest получают бинарник.
- `.env.example`: 4 ключа (`DATABASE_URL`, `SESSION_SECRET`, `PADDLE_WEBHOOK_SECRET`, `PORT`),
  значения пустые — соответствует политике секретов и D-029.
- Версии тулинга соответствуют D-101 (TS 6.0.3, Vitest 4.1.11, ESLint 10 + tseslint 8.69,
  Vite 8.2.2, React 19).

## Рекомендации (не блокирующие)

1. **T-12:** D-105 остаётся в силе — при появлении не-erasable синтаксиса (enum, namespace,
   parameter properties) `node --watch` перестанет хватать; запасной вариант — tsx.
2. Межпакетные импорты идут через `dist` → перед тестами зависимого пакета собирать
   зависимости (`pnpm -r build` это покрывает). Если stale-dist начнёт мешать в T-03+,
   рассмотреть export condition `development: "./src/index.ts"`.
3. ESLint без type-aware правил — достаточно для скелета; при желании ужесточить позже
   (`recommendedTypeChecked`).
4. D-104 фактически пересмотрен этим ревью (тесты теперь типизируются; премисса про Vitest
   была неверна) — зафиксировать поправку при следующем обновлении `DECISIONS.md`.

## Изменённые в ревью файлы

- `tsconfig.base.json` — `types: ["node"]` (FIX-1)
- `packages/*/tsconfig.json`, `apps/api/tsconfig.json` — сняты `exclude` тестов; в api
  добавлены extension-флаги (FIX-2, FIX-3)
- `packages/*/tsconfig.build.json`, `apps/api/tsconfig.build.json` — новые build-конфиги (FIX-2)
- `packages/*/package.json`, `apps/api/package.json` — `build: tsc -p tsconfig.build.json` (FIX-2)
- `package.json`, `pnpm-lock.yaml` — `@types/node@^24` (FIX-4)
- `.gitignore` — `.env.*` + `!.env.example` (FIX-5)

## Повторный прогон после исправлений

| Команда | Результат |
|---|---|
| `pnpm -r build` | OK — 10/10 пакетов Done, dist чистый |
| `pnpm test` | OK — 9 suite × 1 тест passed (web: passWithNoTests) |
| `pnpm lint` | OK — 0 ошибок |
| `pnpm typecheck` | OK — 10/10, теперь включая тест-файлы |

Изменения не закоммичены (по условию задачи).
