// What the owner sees while the free check of the site they typed is being
// started (auto-free-check.ts).
//
// Saving the site, asking it whether it answers and starting the check take
// three requests, and the site's answer alone can take several seconds. Without
// this the screen behind it stayed as it was — the home page, or an empty
// workspace right after sign-up — and the button that started it all looked
// dead. It names the site and says what is happening, and goes away by itself
// when the next screen opens.

import { useEffect, useRef } from 'react';

import { displayDomain } from './scan-status';
import type { Language } from './i18n';
import { LoadingState } from './components';

const startingCopy: Readonly<Record<Language, { title: string; body: (site: string) => string }>> =
  {
    en: {
      title: 'Checking your site',
      body: (site) =>
        `Asking ${site} whether it answers, then starting the free homepage check. This takes a few seconds.`,
    },
    uk: {
      title: 'Перевіряємо ваш сайт',
      body: (site) =>
        `Питаємо ${site}, чи він відповідає, і запускаємо безкоштовну перевірку головної сторінки. Це займе кілька секунд.`,
    },
    ru: {
      title: 'Проверяем ваш сайт',
      body: (site) =>
        `Спрашиваем ${site}, отвечает ли он, и запускаем бесплатную проверку главной страницы. Это займёт несколько секунд.`,
    },
  };

export function StartingFreeCheck(props: { site: string | null; language: Language }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const open = props.site !== null;
  // The button that started this is covered; the focus goes to what replaced it.
  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open]);
  if (props.site === null) return null;
  const t = startingCopy[props.language];
  return (
    <div className="modal-backdrop">
      <section
        className="window window--dialog"
        role="dialog"
        aria-modal="true"
        aria-busy="true"
        aria-labelledby="starting-free-check-title"
        aria-describedby="starting-free-check-body"
      >
        <div className="window__content">
          <h2 id="starting-free-check-title" ref={heading} tabIndex={-1}>
            {t.title}
          </h2>
          <p id="starting-free-check-body">{t.body(displayDomain(props.site))}</p>
          <LoadingState />
        </div>
      </section>
    </div>
  );
}
