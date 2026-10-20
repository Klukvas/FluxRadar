import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import type { ConnectionOptions, TLSSocket } from 'node:tls';
import { describe, expect, it, vi } from 'vitest';
import { SsrfBlockedError } from './errors.js';
import type { ProxyTunnelOptions } from './proxy.js';
import { inspectTlsCertificate } from './tls-certificate.js';

const publicResolver = { resolveAll: async () => ['93.184.216.34'] };
function transport(
  options: { silent?: boolean; authorized?: boolean; authorizationError?: string } = {},
) {
  const emitter = new EventEmitter();
  const socket = Object.assign(emitter, {
    authorized: options.authorized ?? true,
    authorizationError: options.authorizationError ?? null,
    destroy: vi.fn(),
    getPeerCertificate: () => ({
      subject: { CN: 'example.com' },
      subjectaltname: 'DNS:example.com',
      issuer: { CN: 'Test CA' },
      valid_from: 'Oct 1 00:00:00 2026 GMT',
      valid_to: 'Nov 1 00:00:00 2026 GMT',
    }),
  });
  const connect = vi.fn((connectionOptions: ConnectionOptions): TLSSocket => {
    expect(connectionOptions.rejectUnauthorized).toBe(false);
    if (options.silent !== true) queueMicrotask(() => emitter.emit('secureConnect'));
    return socket as unknown as TLSSocket;
  });
  return { socket, connect };
}
describe('passive TLS inspection', () => {
  it('pins DNS locally, records the certificate and closes the socket', async () => {
    const { socket, connect } = transport();
    const result = await inspectTlsCertificate('example.com', {
      resolver: publicResolver,
      tlsConnect: connect,
    });
    expect(result).toMatchObject({
      status: 'checked',
      authorized: true,
      issuer: 'CN=Test CA',
      subjectAltNames: ['DNS:example.com'],
    });
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: '93.184.216.34',
        servername: 'example.com',
        rejectUnauthorized: false,
      }),
    );
    expect(socket.destroy).toHaveBeenCalled();
  });
  it('rejects every private DNS answer before connecting', async () => {
    const { connect } = transport();
    await expect(
      inspectTlsCertificate('example.com', {
        resolver: { resolveAll: async () => ['93.184.216.34', '127.0.0.1'] },
        tlsConnect: connect,
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(connect).not.toHaveBeenCalled();
  });
  it('uses only the approved literal IP in CONNECT and destroys both sockets', async () => {
    const { connect, socket } = transport();
    const tunnel = { destroy: vi.fn() } as unknown as Socket;
    const openTunnel = vi.fn(async () => tunnel);
    await inspectTlsCertificate('example.com', {
      resolver: publicResolver,
      tlsConnect: connect,
      openTunnel,
      proxy: { host: 'proxy.example', port: 8080, credentials: null },
    });
    expect(openTunnel).toHaveBeenCalledWith(
      expect.objectContaining({ address: '93.184.216.34', port: 443 }),
    );
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({ socket: tunnel, servername: 'example.com' }),
    );
    expect(tunnel.destroy).toHaveBeenCalled();
    expect(socket.destroy).toHaveBeenCalled();
  });
  it('times out and destroys a connected socket', async () => {
    const { connect, socket } = transport({ silent: true });
    const result = await inspectTlsCertificate('example.com', {
      resolver: publicResolver,
      tlsConnect: connect,
      timeoutMs: 5,
    });
    expect(result.status).toBe('unverified');
    expect(socket.destroy).toHaveBeenCalled();
  });
  it('aborts a pending tunnel and destroys a socket that arrives late', async () => {
    const { connect } = transport();
    const tunnel = { destroy: vi.fn() } as unknown as Socket;
    const openTunnel = vi.fn(async (options: ProxyTunnelOptions) => {
      expect(options.address).toBe('93.184.216.34');
      await new Promise((resolve) => setTimeout(resolve, 15));
      return tunnel;
    });
    const result = await inspectTlsCertificate('example.com', {
      resolver: publicResolver,
      tlsConnect: connect,
      openTunnel,
      timeoutMs: 5,
      proxy: { host: 'proxy.example', port: 8080, credentials: null },
    });
    expect(result.status).toBe('unverified');
    expect(openTunnel.mock.calls[0]?.[0].signal.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(tunnel.destroy).toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });
  it('records certificate-chain failure without treating transport failure as a defect', async () => {
    const { connect } = transport({
      authorized: false,
      authorizationError: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    });
    expect(
      await inspectTlsCertificate('example.com', { resolver: publicResolver, tlsConnect: connect }),
    ).toMatchObject({
      status: 'checked',
      authorized: false,
      authorizationError: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    });
    const failing = vi.fn(() => {
      throw new Error('ECONNREFUSED');
    });
    expect(
      await inspectTlsCertificate('example.com', { resolver: publicResolver, tlsConnect: failing }),
    ).toMatchObject({ status: 'unverified', unavailableReason: 'ECONNREFUSED' });
  });
});

it('distinguishes unresolved DNS from a timeout so an absent counterpart is inapplicable', async () => {
  const snapshot = await inspectTlsCertificate('www.example.com', {
    resolver: {
      resolveAll: async () => {
        throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
      },
    },
  });
  expect(snapshot).toMatchObject({ status: 'unverified', unavailableReason: 'DnsUnresolved' });
});

it('does no DNS or TLS work for a pre-aborted inspection', async () => {
  const controller = new AbortController();
  controller.abort();
  const resolveAll = vi.fn(async () => ['93.184.216.34']);
  const { connect } = transport();
  const snapshot = await inspectTlsCertificate('example.com', {
    signal: controller.signal,
    resolver: { resolveAll },
    tlsConnect: connect,
  });
  expect(snapshot.status).toBe('unverified');
  expect(resolveAll).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
});

it('settles on cancellation during DNS without starting TLS after a late DNS answer', async () => {
  const controller = new AbortController();
  let finish: (addresses: readonly string[]) => void = () => {
    throw new Error('lookup not started');
  };
  const resolveAll = vi.fn(
    () =>
      new Promise<readonly string[]>((resolve) => {
        finish = resolve;
      }),
  );
  const { connect } = transport();
  const pending = inspectTlsCertificate('example.com', {
    signal: controller.signal,
    resolver: { resolveAll },
    tlsConnect: connect,
  });
  controller.abort();
  expect((await pending).status).toBe('unverified');
  finish(['93.184.216.34']);
  await Promise.resolve();
  await Promise.resolve();
  expect(connect).not.toHaveBeenCalled();
});
