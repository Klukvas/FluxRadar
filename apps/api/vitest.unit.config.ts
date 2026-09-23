// The pure unit suite on its own: no database, no global setup, no network.
//
// It exists so the check that runs on every change cannot touch a database at
// all — not through a mis-set variable, not through a file that gained a
// `createTestDb` import, not through a provider client that falls back to the
// real `fetch`. See vitest.shared.ts for what the project is made of.

import { defineConfig } from 'vitest/config';

import { unitTestProject } from './vitest.shared.ts';

export default defineConfig({ test: unitTestProject() });
