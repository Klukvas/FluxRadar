import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CompleteCheckCatalog } from './CompleteCheckCatalog';
import { completeCatalogCopy, geoCatalogCapabilities } from './complete-catalog-copy';
import { COMPLETE_CATALOG_MODULES } from './complete-check-catalog';
import { moduleLabel } from './rule-titles';

afterEach(cleanup);

describe('Complete catalog presentation', () => {
  it.each(['en', 'uk', 'ru'] as const)(
    'makes every module and title readable in %s without fabricating results',
    (language) => {
      const { container } = render(<CompleteCheckCatalog modules={[]} language={language} />);
      expect(
        screen.getByRole('region', { name: completeCatalogCopy[language].heading }),
      ).toBeInTheDocument();
      const disclosures = [...container.querySelectorAll('details')];
      expect(disclosures).toHaveLength(10);
      expect(disclosures.every((details) => !details.open)).toBe(true);
      const labels: Readonly<Record<string, string>> = completeCatalogCopy[language].labels;
      const benefits: Readonly<Record<string, string>> = completeCatalogCopy[language].benefits;
      expect(
        disclosures.map((details) =>
          details.querySelector('.complete-check-catalog__title')?.textContent?.trim(),
        ),
      ).toEqual(
        COMPLETE_CATALOG_MODULES.map((module) => labels[module] ?? moduleLabel(module, language)),
      );
      for (const [index, details] of disclosures.entries()) {
        const summary = details.querySelector('summary');
        expect(summary).not.toHaveAttribute('role');
        expect(summary).not.toHaveAttribute('tabindex');
        expect(summary).toHaveTextContent(completeCatalogCopy[language].available);
        expect(summary).toHaveTextContent(benefits[COMPLETE_CATALOG_MODULES[index] ?? ''] ?? '');
        expect(summary?.querySelector('button, a')).toBeNull();
      }
      expect(
        screen.getByText(
          language === 'en' ? 'TLS certificate validity' : 'Чинність TLS-сертифіката',
        ),
      ).toBeInTheDocument();
      expect(container.querySelectorAll('[data-locked-capability]')).toHaveLength(
        geoCatalogCapabilities[language].length,
      );
      const contentLanguage = language === 'ru' ? 'uk' : language;
      for (const selector of ['[data-locked-rule]', '[data-locked-capability]']) {
        const names = container.querySelectorAll(`${selector} .complete-check-catalog__name`);
        expect(names.length).toBeGreaterThan(0);
        for (const name of names) expect(name).toHaveAttribute('lang', contentLanguage);
      }
      expect(container.querySelector('[data-locked-rule^="GEO-"]')).toBeNull();
      expect(container.querySelector('[data-locked-rule="A11Y-011"]')).toBeNull();
      expect(container.querySelector('[data-locked-rule="BING-READ-UNAVAILABLE"]')).toBeNull();
      expect(container.querySelector('[data-locked-rule="BING-PARTIAL-PERIOD"]')).toBeNull();
      expect(
        container.querySelector('.module-checks__result, [role="meter"], [role="progressbar"]'),
      ).toBeNull();
      expect(container).not.toHaveTextContent(/0%|Not purchased|Не куплено/);
      for (const row of container.querySelectorAll(
        '[data-locked-rule], [data-locked-capability]',
      )) {
        expect(row).toHaveTextContent(completeCatalogCopy[language].available);
      }
      expect(container.querySelector('[data-locked-rule] button, [data-locked-rule] a')).toBeNull();
      expect(container.querySelector('.complete-check-catalog__blur')).toBeNull();
      expect(container).not.toHaveTextContent(/\b(?:88|93|100)\b/);
    },
  );

  it('offers a single Complete action outside the native disclosures', () => {
    const onUpgrade = vi.fn();
    const { container } = render(
      <CompleteCheckCatalog modules={[]} language="en" onUpgrade={onUpgrade} />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    const upgrade = screen.getByRole('button', { name: completeCatalogCopy.en.upgrade });
    expect(upgrade.closest('details')).toBeNull();
    fireEvent.click(upgrade);
    expect(onUpgrade).toHaveBeenCalledExactlyOnceWith('Complete');
    expect(container.querySelectorAll('details[open]')).toHaveLength(0);
  });
});
