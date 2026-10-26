import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportBrandingPanel } from './ReportBrandingPanel';
import { reportBrandingCopy } from './report-branding-copy';
import type { BrandingView } from './report-branding-api';
import type { Language } from './i18n';

const view: BrandingView = {
  enabled: true,
  displayName: 'Studio Blue',
  accentColor: '#123456',
  contactLine: 'hello@example.com',
  logo: { dataUrl: 'data:image/png;base64,aGVsbG8=', width: 200, height: 50, byteLength: 5 },
  updatedAt: '2026-10-26T00:00:00Z',
};
function response(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    headers: { 'content-type': 'application/json' },
  });
}
function stub(
  initial: unknown = null,
  errorCode?: string,
  message = 'internal message not for UI',
) {
  const fetch = vi.fn((_path: unknown, init?: RequestInit) => {
    if (init?.method === 'PUT')
      return Promise.resolve(
        errorCode
          ? new Response(
              JSON.stringify({
                success: false,
                data: null,
                error: { code: errorCode, message },
              }),
              { status: 422 },
            )
          : response(view),
      );
    if (init?.method === 'DELETE') return Promise.resolve(response(null));
    return Promise.resolve(response(initial));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function show(language: Language = 'en'): Promise<void> {
  render(<ReportBrandingPanel language={language} />);
  await waitFor(() =>
    expect(screen.queryByText(reportBrandingCopy[language].loading)).not.toBeInTheDocument(),
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('loads null as unconfigured and labels/describes each field', async () => {
  stub();
  await show();
  const t = reportBrandingCopy.en;
  expect(screen.getByText(t.notConfigured)).toBeInTheDocument();
  for (const label of [t.name, t.accent, t.contact, t.choose]) {
    const input = screen.getByLabelText(label);
    const described = input.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(document.getElementById(described ?? '')).not.toBeNull();
  }
  expect(screen.getByText(t.eligibility)).toBeInTheDocument();
});
it.each(['invalid', { scan: {} }])(
  'shows a load error for an unrecognised shape',
  async (value) => {
    stub(value);
    await show();
    expect(screen.getByRole('alert')).toHaveTextContent(reportBrandingCopy.en.loadFailed);
  },
);
it('sends the strict body without a stored logo unless a file is chosen', async () => {
  const fetch = stub(view);
  await show();
  fireEvent.change(screen.getByLabelText(reportBrandingCopy.en.name), {
    target: { value: 'New studio' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText(reportBrandingCopy.en.saved);
  const write = fetch.mock.calls.find((call) => call[1]?.method === 'PUT');
  expect(JSON.parse(String(write?.[1]?.body))).toEqual({
    enabled: true,
    displayName: 'New studio',
    accentColor: '#123456',
    contactLine: 'hello@example.com',
  });
});
it('sends only a newly selected PNG with the next save and supports removing it', async () => {
  const fetch = stub(view);
  await show();
  fireEvent.change(screen.getByLabelText(reportBrandingCopy.en.choose), {
    target: { files: [new File(['png'], 'agency.png', { type: 'image/png' })] },
  });
  await screen.findByText('agency.png');
  expect(fetch.mock.calls.filter((call) => call[1]?.method === 'PUT')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText(reportBrandingCopy.en.saved);
  expect(
    JSON.parse(String(fetch.mock.calls.find((call) => call[1]?.method === 'PUT')?.[1]?.body)).logo,
  ).toBe(btoa('png'));
  fireEvent.click(screen.getByRole('button', { name: reportBrandingCopy.en.remove }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(fetch.mock.calls.filter((call) => call[1]?.method === 'PUT')).toHaveLength(2),
  );
  const calls = fetch.mock.calls.filter((call) => call[1]?.method === 'PUT');
  expect(JSON.parse(String(calls[1]?.[1]?.body)).logo).toBeNull();
});
it.each([
  ['image/jpeg', 2, 'LOGO_UNSUPPORTED_TYPE'],
  ['image/png', 262145, 'LOGO_TOO_LARGE'],
])('refuses %s/%s before making a write request', async (type, size, code) => {
  const fetch = stub();
  await show();
  fireEvent.change(screen.getByLabelText(reportBrandingCopy.en.choose), {
    target: { files: [new File([new Uint8Array(Number(size))], 'logo', { type: String(type) })] },
  });
  expect(screen.getByRole('alert')).toHaveTextContent(
    reportBrandingCopy.en.errors[String(code)] ?? '',
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('shows accentLow before saving and prevents saving a low-contrast accent', async () => {
  const fetch = stub(view);
  await show();
  fireEvent.change(screen.getByLabelText(reportBrandingCopy.en.accent), {
    target: { value: '#ffffff' },
  });
  expect(screen.getByRole('alert')).toHaveTextContent(reportBrandingCopy.en.accentLow);
  fireEvent.submit(document.querySelector('form') as HTMLFormElement);
  expect(fetch).toHaveBeenCalledTimes(1);
});
describe.each(['uk', 'en'] as const)('server error copy %s', (language) => {
  it.each([
    'LOGO_TOO_LARGE',
    'LOGO_UNSUPPORTED_TYPE',
    'LOGO_BAD_DIMENSIONS',
    'LOGO_UNREADABLE',
    'VALIDATION',
    'BRANDING_SAVE_FAILED',
    'RATE_LIMITED',
  ])('maps %s to its sentence', async (code) => {
    stub(view, code);
    await show(language);
    const t = reportBrandingCopy[language];
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.errors[code] ?? t.other);
  });
});
it('deletes branding and resets the form', async () => {
  const fetch = stub(view);
  await show();
  fireEvent.click(screen.getByRole('button', { name: reportBrandingCopy.en.delete }));
  await screen.findByText(reportBrandingCopy.en.deleted);
  expect(fetch.mock.calls.some((call) => call[1]?.method === 'DELETE')).toBe(true);
  expect(screen.getByLabelText(reportBrandingCopy.en.name)).toHaveValue('');
});

function delayedReaders(): {
  readers: FileReader[];
  finish: (reader: FileReader | undefined, value: string) => void;
} {
  const readers: FileReader[] = [];
  class DeferredReader extends FileReader {
    override readAsDataURL(): void {
      readers.push(this);
    }
  }
  vi.stubGlobal('FileReader', DeferredReader);
  return {
    readers,
    finish: (reader, value) => {
      if (!reader) throw new Error('missing reader');
      Object.defineProperty(reader, 'result', {
        value: `data:image/png;base64,${btoa(value)}`,
        configurable: true,
      });
      act(() => reader.dispatchEvent(new ProgressEvent('load')));
    },
  };
}
function selectFile(name: string): void {
  fireEvent.change(screen.getByLabelText(reportBrandingCopy.en.choose), {
    target: { files: [new File(['png'], name, { type: 'image/png' })] },
  });
}
it('blocks saving a pending read and ignores an earlier selection completing after the latest', async () => {
  const fetch = stub(view),
    delayed = delayedReaders();
  await show();
  selectFile('first.png');
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  fireEvent.submit(document.querySelector('form') as HTMLFormElement);
  expect(fetch).toHaveBeenCalledTimes(1);
  selectFile('latest.png');
  delayed.finish(delayed.readers[1], 'latest');
  await screen.findByText('latest.png');
  delayed.finish(delayed.readers[0], 'earlier');
  expect(screen.queryByText('first.png')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText(reportBrandingCopy.en.saved);
  expect(
    JSON.parse(String(fetch.mock.calls.find((call) => call[1]?.method === 'PUT')?.[1]?.body)).logo,
  ).toBe(btoa('latest'));
});
it.each(['remove', 'delete'])('invalidates a pending file when %s is clicked', async (action) => {
  const fetch = stub(view),
    delayed = delayedReaders();
  await show();
  selectFile('late.png');
  fireEvent.click(
    screen.getByRole('button', {
      name: action === 'remove' ? reportBrandingCopy.en.remove : reportBrandingCopy.en.delete,
    }),
  );
  if (action === 'delete') await screen.findByText(reportBrandingCopy.en.deleted);
  delayed.finish(delayed.readers[0], 'late');
  expect(screen.queryByText('late.png')).not.toBeInTheDocument();
  expect(document.querySelector('.branding-thumbnail')).toBeNull();
  if (action === 'remove') {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(reportBrandingCopy.en.saved);
    expect(
      JSON.parse(String(fetch.mock.calls.find((call) => call[1]?.method === 'PUT')?.[1]?.body))
        .logo,
    ).toBeNull();
  }
});
it.each([
  ['name', 'displayName'],
  ['contact', 'contactLine'],
] as const)(
  'associates local %s validation with its input and blocks the request',
  async (label, field) => {
    const fetch = stub(view);
    await show();
    const input = screen.getByLabelText(reportBrandingCopy.en[label]);
    fireEvent.change(input, { target: { value: 'hidden\u200btext' } });
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const ids = input.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(
      ids.some(
        (id) => document.getElementById(id)?.textContent === reportBrandingCopy.en.fields[field],
      ),
    ).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent(reportBrandingCopy.en.fields[field]);
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it('associates a server VALIDATION error with the named field', async () => {
  stub(view, 'VALIDATION', 'contactLine: invalid text');
  await show();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText(reportBrandingCopy.en.contact)).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(screen.getByRole('alert')).toHaveTextContent(reportBrandingCopy.en.fields.contactLine);
});
