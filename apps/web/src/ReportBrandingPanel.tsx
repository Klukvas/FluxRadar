import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ApiRequestError } from './api';
import { Button, Panel } from './components';
import type { Language } from './i18n';
import {
  brandingContrast,
  deleteBranding,
  fetchBranding,
  invalidBrandingFields,
  saveBranding,
  type BrandingField,
  type BrandingFieldErrors,
  type BrandingInput,
  type BrandingView,
} from './report-branding-api';
import { brandingError, reportBrandingCopy } from './report-branding-copy';

const empty = {
  enabled: false,
  displayName: '',
  accentColor: null,
  contactLine: null,
} satisfies BrandingInput;
type Form = BrandingInput & { readonly preview: string | null; readonly fileName: string | null };
const initial: Form = { ...empty, preview: null, fileName: null };

function fromView(view: BrandingView): Form {
  return {
    enabled: view.enabled,
    displayName: view.displayName,
    accentColor: view.accentColor,
    contactLine: view.contactLine,
    preview: view.logo?.dataUrl ?? null,
    fileName: null,
  };
}

function fileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Unreadable file'));
    reader.onerror = () => reject(new Error('Unreadable file'));
    reader.readAsDataURL(file);
  });
}

/** A newer selection, removal, deletion or unmount invalidates every older reader. */
function useLogoRead() {
  const version = useRef(0),
    pending = useRef(false);
  const [reading, setReading] = useState(false);
  const cancel = (): void => {
    version.current += 1;
    pending.current = false;
    setReading(false);
  };
  const begin = (): number => {
    version.current += 1;
    pending.current = true;
    setReading(true);
    return version.current;
  };
  const finish = (token: number): void => {
    if (token === version.current) {
      pending.current = false;
      setReading(false);
    }
  };
  useEffect(
    () => () => {
      version.current += 1;
      pending.current = false;
    },
    [],
  );
  return { version, pending, reading, cancel, begin, finish };
}

function useBrandingForm() {
  const [form, setForm] = useState<Form>(initial);
  const [fields, setFields] = useState<BrandingFieldErrors>({});
  const patch = (values: Partial<Form>): void => {
    setForm((current) => ({ ...current, ...values }));
    setFields((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !(key in values))),
    );
  };
  return { form, setForm, fields, setFields, patch };
}

function useBranding(language: Language) {
  const { form, setForm, fields, setFields, patch } = useBrandingForm();
  const [state, setState] = useState<
    'loading' | 'unconfigured' | 'configured' | 'saving' | 'error' | 'deleted'
  >('loading');
  const [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const logoRead = useLogoRead(),
    t = reportBrandingCopy[language];
  useEffect(() => {
    let current = true;
    void fetchBranding()
      .then((view) => {
        if (!current) return;
        if (view === 'invalid') {
          setState('error');
          setError(t.loadFailed);
          return;
        }
        setForm(view === null ? initial : fromView(view));
        setState(view === null ? 'unconfigured' : 'configured');
      })
      .catch(() => {
        if (current) {
          setState('error');
          setError(t.loadFailed);
        }
      });
    return () => {
      current = false;
    };
  }, [t.loadFailed]);
  return {
    form,
    setForm,
    state,
    setState,
    message,
    setMessage,
    error,
    setError,
    fields,
    setFields,
    patch,
    logoRead,
  };
}
type BrandingState = ReturnType<typeof useBranding>;

function fieldError(state: BrandingState, field: BrandingField, message: string): void {
  state.setFields((current) => ({ ...current, [field]: message }));
}

async function chooseLogo(
  event: ChangeEvent<HTMLInputElement>,
  state: BrandingState,
  language: Language,
): Promise<void> {
  const file = event.target.files?.[0];
  if (!file) return;
  state.logoRead.cancel();
  state.setError('');
  const code =
    file.type !== 'image/png'
      ? 'LOGO_UNSUPPORTED_TYPE'
      : file.size > 262144
        ? 'LOGO_TOO_LARGE'
        : null;
  if (code) {
    fieldError(state, 'logo', brandingError(language, code));
    return;
  }
  const token = state.logoRead.begin();
  try {
    const dataUrl = await fileData(file);
    if (token !== state.logoRead.version.current) return;
    state.patch({
      logo: dataUrl.slice(dataUrl.indexOf(',') + 1),
      preview: dataUrl,
      fileName: file.name,
    });
    fieldError(state, 'logo', '');
  } catch {
    if (token === state.logoRead.version.current)
      fieldError(state, 'logo', brandingError(language, 'LOGO_UNREADABLE'));
  } finally {
    state.logoRead.finish(token);
  }
}

function showSaveError(state: BrandingState, language: Language, error: unknown): void {
  const code = error instanceof ApiRequestError ? (error.code ?? '') : '';
  if (code.startsWith('LOGO_')) {
    fieldError(state, 'logo', brandingError(language, code));
    return;
  }
  const fields: readonly BrandingField[] = ['displayName', 'accentColor', 'contactLine', 'logo'];
  const invalid =
    error instanceof ApiRequestError && code === 'VALIDATION'
      ? fields.filter((field) => new RegExp(`(?:^|; )${field}:`).test(error.message))
      : [];
  if (invalid.length) {
    state.setFields(
      Object.fromEntries(
        invalid.map((field) => [field, reportBrandingCopy[language].fields[field]]),
      ),
    );
    return;
  }
  state.setError(brandingError(language, code));
}

async function submitBranding(
  event: FormEvent,
  state: BrandingState,
  language: Language,
): Promise<void> {
  event.preventDefault();
  if (state.logoRead.pending.current) return;
  const { enabled, displayName, accentColor, contactLine, logo } = state.form;
  const input = {
    enabled,
    displayName,
    accentColor,
    contactLine,
    ...(logo === undefined ? {} : { logo }),
  };
  const invalid = invalidBrandingFields(input);
  state.setFields(
    Object.fromEntries(invalid.map((field) => [field, reportBrandingCopy[language].fields[field]])),
  );
  if (invalid.length) return;
  state.setState('saving');
  state.setError('');
  state.setMessage('');
  try {
    const view = await saveBranding(input);
    state.setForm(fromView(view));
    state.setState('configured');
    state.setMessage(reportBrandingCopy[language].saved);
  } catch (error) {
    state.setState('configured');
    showSaveError(state, language, error);
  }
}

async function removeBranding(state: BrandingState, language: Language): Promise<void> {
  state.logoRead.cancel();
  state.setState('saving');
  state.setError('');
  state.setFields({});
  try {
    await deleteBranding();
    state.setForm(initial);
    state.setState('deleted');
    state.setMessage(reportBrandingCopy[language].deleted);
  } catch (error) {
    state.setState('configured');
    showSaveError(state, language, error);
  }
}

function removeLogo(state: BrandingState): void {
  state.logoRead.cancel();
  state.patch({ logo: null, preview: null, fileName: null });
  fieldError(state, 'logo', '');
}

function BrandingTextField(props: {
  id: string;
  label: string;
  hint: string;
  value: string;
  maximum: number;
  error?: string;
  placeholder?: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  const { id, error } = props;
  return (
    <>
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        required={props.required}
        maxLength={props.maximum}
        value={props.value}
        placeholder={props.placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <p className="muted" id={`${id}-hint`}>
        {props.hint}
      </p>
      {error ? (
        <p role="alert" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </>
  );
}

function BrandingFields({ state, language }: { state: BrandingState; language: Language }) {
  const t = reportBrandingCopy[language],
    id = useId(),
    accent = state.form.accentColor ?? '';
  const low = /^#[0-9a-f]{6}$/i.test(accent) && brandingContrast(accent) < 3;
  return (
    <>
      <label className="branding-enabled">
        <input
          type="checkbox"
          checked={state.form.enabled}
          onChange={(event) => state.patch({ enabled: event.target.checked })}
        />
        {t.enabled}
      </label>
      <BrandingTextField
        id={`${id}-name`}
        label={t.name}
        hint={t.nameHint}
        value={state.form.displayName}
        maximum={80}
        required
        error={state.fields.displayName}
        onChange={(displayName) => state.patch({ displayName })}
      />
      <BrandingTextField
        id={`${id}-accent`}
        label={t.accent}
        hint={t.accentHint}
        value={accent}
        maximum={7}
        placeholder="#1f4fd8"
        error={low ? t.accentLow : state.fields.accentColor}
        onChange={(value) => state.patch({ accentColor: value || null })}
      />
      <BrandingTextField
        id={`${id}-contact`}
        label={t.contact}
        hint={t.contactHint}
        value={state.form.contactLine ?? ''}
        maximum={160}
        error={state.fields.contactLine}
        onChange={(value) => state.patch({ contactLine: value || null })}
      />
    </>
  );
}

function BrandingLogo({ state, language }: { state: BrandingState; language: Language }) {
  const t = reportBrandingCopy[language],
    id = useId(),
    error = state.fields.logo;
  return (
    <div className="branding-logo">
      <p>{t.logo}</p>
      <label htmlFor={id} className="button branding-file-label">
        {t.choose}
      </label>
      <input
        id={id}
        className="branding-file"
        type="file"
        accept="image/png"
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
        onChange={(event) => void chooseLogo(event, state, language)}
      />
      <p id={`${id}-hint`} className="muted">
        {t.logoHint}
      </p>
      {error ? (
        <p id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
      {state.form.fileName ? <p>{state.form.fileName}</p> : null}
      {state.form.preview ? (
        <img className="branding-thumbnail" src={state.form.preview} alt={state.form.displayName} />
      ) : null}
      {state.form.preview || state.logoRead.reading ? (
        <Button onClick={() => removeLogo(state)}>{t.remove}</Button>
      ) : null}
    </div>
  );
}

export function ReportBrandingPanel({ language }: { language: Language }) {
  const state = useBranding(language),
    t = reportBrandingCopy[language],
    saving = state.state === 'saving';
  return (
    <Panel title={t.title}>
      <p>{t.lead}</p>
      <p className="muted">{t.eligibility}</p>
      {state.state === 'loading' ? (
        <p role="status">{t.loading}</p>
      ) : state.state === 'error' ? (
        <p role="alert">{state.error}</p>
      ) : (
        <>
          {state.state === 'unconfigured' ? <p className="muted">{t.notConfigured}</p> : null}
          <form
            className="stack report-branding"
            aria-busy={saving || state.logoRead.reading}
            onSubmit={(event) => void submitBranding(event, state, language)}
          >
            <fieldset disabled={saving} className="stack branding-fields">
              <BrandingFields state={state} language={language} />
              <BrandingLogo state={state} language={language} />
              {state.error ? <p role="alert">{state.error}</p> : null}
              <div className="button-row">
                <Button type="submit" variant="primary" disabled={state.logoRead.reading}>
                  {saving ? t.saving : t.save}
                </Button>
                <Button onClick={() => void removeBranding(state, language)}>{t.delete}</Button>
              </div>
            </fieldset>
            {state.message ? <p role="status">{state.message}</p> : null}
          </form>
        </>
      )}
    </Panel>
  );
}
