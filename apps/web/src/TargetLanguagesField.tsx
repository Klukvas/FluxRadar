// The profile's target languages, picked from a dropdown instead of typed.
//
// See `target-languages.ts` for why the stored text is English names. The list
// used to be a `details` element that opened in the form's flow, which pushed
// the fields under it down the page every time it was opened; it is now a real
// anchored dropdown over the form, and the trigger says how many languages are
// chosen and which ones.
//
// It is a set of checkboxes rather than a single-choice list, so picking a second
// language does not close it and nothing has to be reopened to add a third. It
// closes only on Escape, a click outside it, or Tab out — the three ways a
// reader expects a pop-up to go away (WAI-ARIA APG).

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import { Checkbox } from './components';
import { copy, fillCopy, type Language } from './i18n';
import {
  PROFILE_TARGET_LANGUAGE_NAMES,
  formatTargetLanguages,
  parseTargetLanguages,
  targetLanguageLabel,
} from './target-languages';

export function TargetLanguagesField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  hint: string;
  language: Language;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const summaryId = `${id}-summary`;
  const popupId = `${id}-popup`;
  const t = copy[props.language].workspace;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const selected = parseTargetLanguages(props.value);
  // Older profiles can retain previously supported choices, but this picker
  // only offers the three languages the product now supports for new choices.
  const legacy = selected.filter((name) => !PROFILE_TARGET_LANGUAGE_NAMES.includes(name));
  const options = PROFILE_TARGET_LANGUAGE_NAMES;

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const boxes = (): readonly HTMLInputElement[] =>
    Array.from(
      optionsRef.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [],
    );

  /** Opens the list and puts the caller's end of it under the arrow keys. */
  const openAt = (edge: 'first' | 'last') => {
    setOpen(true);
    window.requestAnimationFrame(() => {
      const all = boxes();
      (edge === 'first' ? all[0] : all[all.length - 1])?.focus();
    });
  };

  const toggle = (name: string, checked: boolean): void =>
    props.onChange(
      formatTargetLanguages(
        checked ? [...selected, name] : selected.filter((entry) => entry !== name),
      ),
    );

  const removeLegacy = (): void =>
    props.onChange(
      formatTargetLanguages(
        selected.filter((name) => PROFILE_TARGET_LANGUAGE_NAMES.includes(name)),
      ),
    );

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openAt('first');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openAt('last');
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  const onOptionsKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') return;
    const all = boxes();
    const index = all.indexOf(document.activeElement as HTMLInputElement);
    if (index === -1 || all.length === 0) return;
    const last = all.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: index === last ? 0 : index + 1,
      ArrowUp: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    all[next]?.focus();
  };

  const chosen = selected.map((name) => targetLanguageLabel(name, props.language)).join(', ');
  return (
    <div className="field">
      <span className="field__label" id={labelId}>
        {props.label}
      </span>
      <div className="language-picker" ref={containerRef}>
        <button
          ref={triggerRef}
          type="button"
          className="control language-picker__summary"
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={open ? popupId : undefined}
          aria-labelledby={`${labelId} ${summaryId}`}
          onClick={() => setOpen(!open)}
          onKeyDown={onTriggerKeyDown}
        >
          <span
            id={summaryId}
            className={selected.length === 0 ? 'language-picker__placeholder' : undefined}
          >
            {selected.length === 0
              ? props.placeholder
              : `${fillCopy(t.targetLanguagesChosen, { count: String(selected.length) })}: ${chosen}`}
          </span>
        </button>
        {open ? (
          <div
            id={popupId}
            className="language-picker__popup"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
              }
            }}
            onBlur={(event) => {
              if (!containerRef.current?.contains(event.relatedTarget)) setOpen(false);
            }}
          >
            <div
              className="language-picker__options"
              role="group"
              aria-labelledby={labelId}
              ref={optionsRef}
              onKeyDown={onOptionsKeyDown}
            >
              {options.map((name) => (
                <Checkbox
                  key={name}
                  name="profile-languages"
                  label={targetLanguageLabel(name, props.language)}
                  checked={selected.includes(name)}
                  onChange={(checked) => toggle(name, checked)}
                />
              ))}
            </div>
            {legacy.length === 0 ? null : (
              <div className="language-picker__legacy">
                <p>{fillCopy(t.targetLanguagesLegacy, { languages: legacy.join(', ') })}</p>
                <button type="button" className="link-button" onClick={removeLegacy}>
                  {t.targetLanguagesRemoveLegacy}
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
      <span className="field__hint">{props.hint}</span>
    </div>
  );
}
