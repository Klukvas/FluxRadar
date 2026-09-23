// Regression tests for the harness guard. Each case is an address a destructive
// step must not be handed: an application database, a host that is not literally
// loopback, a connection parameter that redirects the connection elsewhere, or a
// URL nobody acknowledged.

import { describe, expect, it } from 'vitest';

import {
  IGNORED_DATABASE_ENV_VARS,
  TEST_DATABASE_ACK_ENV,
  TEST_DATABASE_NAME_PATTERN,
  TEST_DATABASE_URL_ENV,
  assertNoRefusedTestDatabase,
  isTestDatabaseReady,
  requireTestDatabaseUrl,
  resolveTestDatabase,
  testDatabaseSkipReason,
} from './test-database-url.ts';

const OWNED_NAME = 'fluxradar_test_abc123';
const OWNED_URL = `postgresql://tester:pw@127.0.0.1:5432/${OWNED_NAME}`;

function env(values: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  return { ...values };
}

function acknowledged(url: string, name = OWNED_NAME): NodeJS.ProcessEnv {
  return env({ [TEST_DATABASE_URL_ENV]: url, [TEST_DATABASE_ACK_ENV]: name });
}

describe('resolveTestDatabase', () => {
  it('accepts an acknowledged loopback URL naming a disposable test database', () => {
    expect(resolveTestDatabase(acknowledged(OWNED_URL))).toEqual({
      state: 'ready',
      url: OWNED_URL,
      databaseName: OWNED_NAME,
    });
    expect(isTestDatabaseReady(acknowledged(OWNED_URL))).toBe(true);
  });

  it('is not tied to one database: any name following the convention is accepted', () => {
    const other = 'fluxradar_test_9f4c7ab2';
    const resolution = resolveTestDatabase(
      acknowledged(`postgresql://tester@127.0.0.1:55439/${other}`, other),
    );
    expect(resolution).toEqual({
      state: 'ready',
      url: `postgresql://tester@127.0.0.1:55439/${other}`,
      databaseName: other,
    });
  });

  it('accepts the literal IPv6 loopback address', () => {
    const url = `postgresql://tester@[::1]:5432/${OWNED_NAME}`;
    expect(resolveTestDatabase(acknowledged(url)).state).toBe('ready');
  });

  it('accepts a validated ?schema= parameter, which Prisma connections carry', () => {
    const url = `${OWNED_URL}?schema=public`;
    expect(resolveTestDatabase(acknowledged(url)).state).toBe('ready');
  });

  it('skips, without failing, when nothing is configured', () => {
    const resolution = resolveTestDatabase(env({}));
    expect(resolution.state).toBe('absent');
    expect(testDatabaseSkipReason(env({}))).toContain(TEST_DATABASE_URL_ENV);
    expect(() => assertNoRefusedTestDatabase(env({}))).not.toThrow();
  });

  it('never inherits TEST_DATABASE_URL or DATABASE_URL, and names them in the skip reason', () => {
    const inherited = env({
      TEST_DATABASE_URL: 'postgresql://user:pw@db.internal:5432/fluxradar',
      DATABASE_URL: 'postgresql://user:pw@db.internal:5432/fluxradar',
    });
    const resolution = resolveTestDatabase(inherited);
    expect(resolution.state).toBe('absent');
    for (const name of IGNORED_DATABASE_ENV_VARS) {
      expect(testDatabaseSkipReason(inherited)).toContain(name);
    }
  });

  it('refuses a remote host even when the database name follows the convention', () => {
    const resolution = resolveTestDatabase(
      acknowledged(`postgresql://user:pw@db.fluxradar.net:5432/${OWNED_NAME}`),
    );
    expect(resolution.state).toBe('refused');
    expect(resolution.state === 'refused' && resolution.reason).toContain('loopback');
  });

  it('refuses localhost, because a name is resolved by the machine and not by the guard', () => {
    const resolution = resolveTestDatabase(
      acknowledged(`postgresql://user@localhost:5432/${OWNED_NAME}`),
    );
    expect(resolution.state).toBe('refused');
    expect(resolution.state === 'refused' && resolution.reason).toContain('literal loopback');
  });

  it('refuses a host that only looks loopback', () => {
    const resolution = resolveTestDatabase(
      acknowledged(`postgresql://user@127.0.0.1.attacker.example:5432/${OWNED_NAME}`),
    );
    expect(resolution.state).toBe('refused');
  });

  it.each(['host', 'hostaddr', 'dbname', 'service', 'options', 'target_session_attrs'])(
    'refuses the connection parameter ?%s=, which can redirect the connection',
    (parameter) => {
      const resolution = resolveTestDatabase(acknowledged(`${OWNED_URL}?${parameter}=db.internal`));
      expect(resolution.state).toBe('refused');
      expect(resolution.state === 'refused' && resolution.reason).toContain(parameter);
    },
  );

  it('refuses a repeated connection parameter rather than guessing which one wins', () => {
    const resolution = resolveTestDatabase(acknowledged(`${OWNED_URL}?schema=public&schema=other`));
    expect(resolution.state).toBe('refused');
    expect(resolution.state === 'refused' && resolution.reason).toContain('repeats');
  });

  it('refuses a ?schema= value that is not a plain identifier', () => {
    const resolution = resolveTestDatabase(acknowledged(`${OWNED_URL}?schema=public;drop`));
    expect(resolution.state).toBe('refused');
  });

  it.each(['fluxradar', 'postgres', 'fluxradar_test', 'template1', ''])(
    'refuses the loopback database named %p because it is not a disposable test database',
    (name) => {
      const resolution = resolveTestDatabase(
        env({
          [TEST_DATABASE_URL_ENV]: `postgresql://user@127.0.0.1:5432/${name}`,
          [TEST_DATABASE_ACK_ENV]: name,
        }),
      );
      expect(resolution.state).toBe('refused');
      expect(resolution.state === 'refused' && resolution.reason).toContain('fluxradar_test_');
    },
  );

  it('refuses a name that merely starts with the convention', () => {
    const name = 'fluxradar_test_Production';
    expect(TEST_DATABASE_NAME_PATTERN.test(name)).toBe(false);
    expect(
      resolveTestDatabase(
        env({
          [TEST_DATABASE_URL_ENV]: `postgresql://user@127.0.0.1:5432/${name}`,
          [TEST_DATABASE_ACK_ENV]: name,
        }),
      ).state,
    ).toBe('refused');
  });

  it('refuses a non-PostgreSQL URL', () => {
    expect(resolveTestDatabase(acknowledged('mysql://127.0.0.1:3306/x')).state).toBe('refused');
    expect(resolveTestDatabase(acknowledged('not a url')).state).toBe('refused');
  });

  it('refuses the database until the destruction is acknowledged', () => {
    const resolution = resolveTestDatabase(env({ [TEST_DATABASE_URL_ENV]: OWNED_URL }));
    expect(resolution.state).toBe('refused');
    expect(resolution.state === 'refused' && resolution.reason).toContain(TEST_DATABASE_ACK_ENV);
  });

  it('refuses an acknowledgement that names a different database', () => {
    const resolution = resolveTestDatabase(
      env({ [TEST_DATABASE_URL_ENV]: OWNED_URL, [TEST_DATABASE_ACK_ENV]: 'fluxradar_test_other1' }),
    );
    expect(resolution.state).toBe('refused');
  });
});

describe('requireTestDatabaseUrl', () => {
  it('returns the URL once every rule passed', () => {
    expect(requireTestDatabaseUrl(acknowledged(OWNED_URL))).toBe(OWNED_URL);
  });

  it('throws, rather than returning an address, for a refused URL', () => {
    expect(() =>
      requireTestDatabaseUrl(acknowledged('postgresql://user@db.internal/fluxradar_test_abc123')),
    ).toThrow(/Refusing to use a database for API tests/);
  });

  it('throws when nothing is configured, so no destructive step can default to one', () => {
    expect(() => requireTestDatabaseUrl(env({}))).toThrow(
      /Refusing to use a database for API tests/,
    );
  });
});

describe('assertNoRefusedTestDatabase', () => {
  it('fails the run for a configured URL the guard refused', () => {
    expect(() =>
      assertNoRefusedTestDatabase(
        acknowledged('postgresql://user@db.internal/fluxradar_test_abc123'),
      ),
    ).toThrow(/Refusing to run API tests against the configured database/);
  });

  it('passes for a ready database and for no database at all', () => {
    expect(() => assertNoRefusedTestDatabase(acknowledged(OWNED_URL))).not.toThrow();
    expect(() => assertNoRefusedTestDatabase(env({}))).not.toThrow();
  });
});
