// What the home page slider claims, checked against the lists the product
// itself reads, in every language the home page speaks — and the slider as the
// prerender writes it, before any JavaScript runs.

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AI_PROCESSING_OPT_IN_PROVIDERS, AI_PROCESSING_PROVIDERS } from './ai-processing-notice';
import { COMPLETE_RULE_CATALOG } from './complete-check-catalog';
import {
  EXAMPLE_AI_ANSWERS,
  EXAMPLE_DEVELOPER_TASK,
  EXAMPLE_PLAN_STEPS,
  EXAMPLE_SECURITY_ROWS,
} from './example-offer-fixture';
import { exampleReportContent } from './example-report-content';
import {
  EXAMPLE_DOMAIN,
  EXAMPLE_HOME_PREVIEW,
  EXAMPLE_ISSUES,
  EXAMPLE_SUMMARY,
} from './example-report-fixture';
import { HeroOfferSlider } from './HeroOfferSlider';
import { HomeHero } from './HomeHero';
import {
  AI_ASKED_COUNT,
  AI_OPTIONAL_COUNT,
  SECURITY_CHECK_COUNT,
  SEO_CHECK_COUNT,
} from './hero-offer-content';
import { heroOfferCopy, OFFER_SLIDE_IDS, type OfferSlideId } from './hero-offer-copy';
import { copy, LANGUAGES, type Language } from './i18n';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The text of one slide, as the slider renders it in `language`. */
function slideText(language: Language, slide: OfferSlideId): string {
  render(<HeroOfferSlider language={language} />);
  const index = OFFER_SLIDE_IDS.indexOf(slide);
  const tab = screen.getAllByRole('tab')[index] as HTMLElement;
  const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
  const text = panel?.textContent ?? '';
  cleanup();
  return text;
}

/** Every string of one language's slider copy, functions called with sample counts. */
function copyLeaves(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') {
    const result: unknown = (value as (...args: readonly unknown[]) => unknown)(2, 5);
    return typeof result === 'string' ? [result] : [];
  }
  if (Array.isArray(value)) return value.flatMap(copyLeaves);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(copyLeaves);
  return [];
}

describe('what the slider claims', () => {
  // Verified against the source lists: these are the offer's real sizes.
  it('counts from the catalogues the product reads', () => {
    expect(SEO_CHECK_COUNT).toBe(27);
    expect(SECURITY_CHECK_COUNT).toBe(COMPLETE_RULE_CATALOG.Security?.length);
    expect(SECURITY_CHECK_COUNT).toBe(8);
    expect(AI_ASKED_COUNT).toBe(2);
    expect(AI_OPTIONAL_COUNT).toBe(2);
  });

  it.each(LANGUAGES)('names the plan on every paid slide (%s)', (language) => {
    expect(slideText(language, 'report')).toMatch(/Basic.+Complete/);
    expect(slideText(language, 'ai')).toMatch(/Basic.+Complete/);
    expect(slideText(language, 'plan')).toMatch(/Basic.+Complete/);
    // Security is Complete only.
    const security = slideText(language, 'security');
    expect(security).toContain('Complete');
    expect(security).not.toContain('Basic');
  });

  // The full example's own SEO section counts the checks that applied to the
  // salon (fewer than 27), so slide 1 states the plans' offer, not the salon's run.
  it.each<[Language, string]>([
    ['en', 'Basic and Complete include 27 checks for Google search'],
    ['uk', 'Basic і Complete містять 27 перевірок для пошуку Google'],
    ['ru', 'Basic и Complete включают 27 проверок для поиска Google'],
  ])('says the 27 checks are what the plans include (%s)', (language, caption) => {
    expect(slideText(language, 'report')).toContain(caption);
  });

  it.each(LANGUAGES)('prints the counts it was handed (%s)', (language) => {
    expect(slideText(language, 'report')).toContain(`${SEO_CHECK_COUNT} `);
    expect(slideText(language, 'security')).toContain(`${SECURITY_CHECK_COUNT} `);
    const ai = slideText(language, 'ai');
    expect(ai).toContain(`${AI_ASKED_COUNT} `);
    // Two asked, two more on request: never a flat "4".
    expect(ai).not.toMatch(/\b4\b/);
  });

  it('asks the assistants a paid scan asks, and offers the opt-in ones by name', () => {
    expect(EXAMPLE_AI_ANSWERS.map((answer) => answer.provider)).toEqual([
      ...AI_PROCESSING_PROVIDERS,
    ]);
    const ai = slideText('en', 'ai');
    expect(ai).toMatch(/Claude/);
    expect(ai).toMatch(/ChatGPT/);
    expect(AI_PROCESSING_OPT_IN_PROVIDERS).toEqual(['google', 'perplexity']);
    expect(ai).toMatch(/Gemini.+Perplexity/);
  });

  it('shows Security checks the catalogue has, in words for every language', () => {
    const catalogue = (COMPLETE_RULE_CATALOG.Security ?? []).map(([id]) => id);
    for (const row of EXAMPLE_SECURITY_ROWS) {
      expect(catalogue).toContain(row.ruleId);
      for (const language of LANGUAGES) {
        expect(heroOfferCopy[language].security.rows[row.ruleId], language).toBeDefined();
      }
    }
  });
});

describe('the slider is an extract of the one made-up salon', () => {
  // Slide 1 and the full example both say the salon has six problems, and the
  // full example is a Complete report, which runs Security and asks the AI
  // assistants. The slider's own data must not add a seventh: the fixture's
  // types admit only passed checks and answers that named and linked the
  // salon, and every row the slides draw says so.
  it.each(LANGUAGES)('adds no problem to the full example’s count (%s)', (language) => {
    const t = heroOfferCopy[language];
    expect(EXAMPLE_HOME_PREVIEW.problems).toBe(EXAMPLE_SUMMARY.groups.length);
    expect(copy[language].home.hero.example.meta).toContain(`${EXAMPLE_HOME_PREVIEW.problems} `);
    render(<HeroOfferSlider language={language} />);
    const panelOf = (slide: OfferSlideId): HTMLElement => {
      const tab = screen.getAllByRole('tab')[OFFER_SLIDE_IDS.indexOf(slide)] as HTMLElement;
      return document.getElementById(tab.getAttribute('aria-controls') ?? '') as HTMLElement;
    };
    const chips = (slide: OfferSlideId): readonly (string | null)[] =>
      [...panelOf(slide).querySelectorAll('.home-hero__finding--ok .home-hero__chip')].map(
        (chip) => chip.textContent,
      );
    expect(chips('security')).toEqual(EXAMPLE_SECURITY_ROWS.map(() => t.security.passed));
    expect(chips('ai')).toEqual(EXAMPLE_AI_ANSWERS.map(() => t.ai.mentioned));
  });

  it('cites a page the full example read', () => {
    const pages = new Set(EXAMPLE_ISSUES.map((issue) => issue.targetUrl.replace('https://', '')));
    for (const answer of EXAMPLE_AI_ANSWERS) {
      expect(pages).toContain(answer.citedPage);
    }
    expect(EXAMPLE_DOMAIN).toMatch(/\.example$/);
  });

  it('plans the example’s own problems, with the summary’s counts', () => {
    for (const step of EXAMPLE_PLAN_STEPS) {
      const group = EXAMPLE_SUMMARY.groups.find((candidate) => candidate.ruleId === step.ruleId);
      expect(group, step.ruleId).toBeDefined();
      expect(step).toEqual({ ruleId: step.ruleId, open: group?.openIssues, total: group?.issues });
    }
  });

  it.each(LANGUAGES)('quotes the real developer message, not a paraphrase (%s)', (language) => {
    const task = EXAMPLE_DEVELOPER_TASK[language];
    const full = exampleReportContent[language].developerTask;
    expect(task.text).toBe(full);
    for (const line of [task.heading, task.where, task.whatToDo]) {
      expect(full.split('\n')).toContain(line);
    }
    const text = slideText(language, 'developer');
    expect(text).toContain(task.heading);
    expect(text).toContain(task.whatToDo);
  });

  it('copies the whole message from the slide’s button', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<HeroOfferSlider language="en" />);
    fireEvent.click(screen.getByRole('tab', { name: heroOfferCopy.en.tabs.developer }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy task for developer' }));
    });
    expect(writeText).toHaveBeenCalledWith(EXAMPLE_DEVELOPER_TASK.en.text);
    expect(screen.getByRole('status')).toHaveTextContent('Task copied');
  });

  // The status line is there, empty, before any click, with room already kept
  // for both messages, so "Task copied" or a refusal does not grow the slide.
  it('reserves the copy status line before the button is pressed', () => {
    render(<HeroOfferSlider language="en" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('');
    const reserved = [...(status.parentElement?.querySelectorAll('[aria-hidden="true"]') ?? [])];
    expect(reserved.map((line) => line.textContent)).toEqual([
      'Task copied. Paste it into a message to your developer.',
      heroOfferCopy.en.developer.copyFailed,
    ]);
  });

  it('shows the whole message inside the extract’s box when copying is refused', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const writeText = vi.fn(async () => {
      throw new Error('denied');
    });
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<HeroOfferSlider language="en" />);
    fireEvent.click(screen.getByRole('tab', { name: heroOfferCopy.en.tabs.developer }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy task for developer' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent(heroOfferCopy.en.developer.copyFailed);
    const full = screen.getByRole('textbox', { name: 'Task for your developer' });
    expect(full).toHaveValue(EXAMPLE_DEVELOPER_TASK.en.text);
    // Laid over the extract in the same box, not added under it.
    expect(full.parentElement).toHaveClass('hero-offer__note');
    expect(full.parentElement?.querySelector('.hero-offer__note-extract')).toHaveClass(
      'is-covered',
    );
  });
});

describe('the slider’s words, for a shop owner', () => {
  const JARGON = /OWASP|ASVS|HSTS|SPF|DMARC|\bCSP\b|CORS|\bTLS\b|header|заголов/i;

  it.each(LANGUAGES)('names no standard, header or record (%s)', (language) => {
    const hits = copyLeaves(heroOfferCopy[language]).filter((line) => JARGON.test(line));
    expect(hits).toEqual([]);
  });

  it('says «ШІ» in Ukrainian and «ИИ» in Russian, never a Latin AI', () => {
    expect(copyLeaves(heroOfferCopy.uk).filter((line) => /\bAI\b/.test(line))).toEqual([]);
    expect(copyLeaves(heroOfferCopy.ru).filter((line) => /\bAI\b/.test(line))).toEqual([]);
  });

  it('carries no dash construction in Russian', () => {
    expect(copyLeaves(heroOfferCopy.ru).filter((line) => /\s[—–]\s/.test(line))).toEqual([]);
  });

  it.each<[Language, string, string]>([
    ['uk', '27 перевірок для пошуку Google', '8 перевірок безпеки'],
    ['ru', '27 проверок для поиска Google', '8 проверок безопасности'],
    ['en', '27 checks for Google search', '8 security checks'],
  ])('agrees its numerals with their nouns (%s)', (language, seo, security) => {
    const t = heroOfferCopy[language];
    expect(t.report.includes(SEO_CHECK_COUNT, 'Basic', 2)).toContain(seo);
    expect(t.security.includes(SECURITY_CHECK_COUNT)).toContain(security);
  });

  it('has every key in every language, none of them empty', () => {
    const shape = (language: Language): number => copyLeaves(heroOfferCopy[language]).length;
    expect(shape('uk')).toBe(shape('en'));
    expect(shape('ru')).toBe(shape('en'));
    for (const language of LANGUAGES) {
      expect(copyLeaves(heroOfferCopy[language]).filter((line) => line.trim() === '')).toEqual([]);
    }
  });
});

describe('the slider before JavaScript runs', () => {
  function serverHero(language: Language): string {
    return renderToString(
      <HomeHero language={language} onStartSite={() => undefined} onSeePricing={() => undefined} />,
    );
  }

  it.each(LANGUAGES)('prerenders every tab label and the first slide whole (%s)', (language) => {
    const html = serverHero(language);
    for (const slide of OFFER_SLIDE_IDS) {
      expect(html).toContain(heroOfferCopy[language].tabs[slide]);
    }
    const first = copy[language].home.hero.example;
    expect(html).toContain(first.site);
    // The first panel is the visible one and the only one not inert.
    expect(html.match(/role="tabpanel"/g)).toHaveLength(OFFER_SLIDE_IDS.length);
    expect(html.match(/hero-offer__slide is-active/g)).toHaveLength(1);
    expect(html.match(/inert=""/g)).toHaveLength(OFFER_SLIDE_IDS.length - 1);
    // Nothing to stop before anything can move.
    expect(html).not.toContain(heroOfferCopy[language].stop);
  });

  it('hydrates without a mismatch, and only then starts to move', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const recoverable = vi.fn();
    const container = document.createElement('div');
    container.innerHTML = serverHero('uk');
    document.body.append(container);
    const root = await act(async () =>
      hydrateRoot(
        container,
        <HomeHero language="uk" onStartSite={() => undefined} onSeePricing={() => undefined} />,
        { onRecoverableError: recoverable },
      ),
    );
    expect(recoverable).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    const window = within(container).getByRole('region', { name: heroOfferCopy.uk.windowTitle });
    expect(window).toHaveClass('is-auto');
    act(() => root.unmount());
    container.remove();
  });
});
