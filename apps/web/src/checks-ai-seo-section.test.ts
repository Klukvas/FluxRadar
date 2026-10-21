// The AI SEO / GEO section of the public coverage page has to describe the
// per-engine visibility score before anyone pays for it.
//
// The score is published prose: the report prints a number out of 100 whose
// formula, denominator and threshold a buyer can only check against this page.
// Two of those are easy to get quietly wrong — the denominator is the answers
// in which a signal was *measurable*, not the answers received, and the score
// sits outside the overall audit score — so both are pinned here, in both
// languages.

import { describe, expect, it } from 'vitest';

import { checksCopyEn, checksCopyUk, type ChecksCopy } from './checks-copy';

const LOCALES: readonly (readonly [string, ChecksCopy])[] = [
  ['en', checksCopyEn],
  ['uk', checksCopyUk],
];

function aiSeoSection(copy: ChecksCopy) {
  const section = copy.sections.find((entry) => entry.id === 'ai-seo');
  if (section === undefined) {
    throw new Error('the coverage page has no AI SEO / GEO section');
  }
  return section;
}

/** The visibility-score bullet, by position: added with the score itself, before share of voice. */
function scoreBullet(copy: ChecksCopy) {
  const { bullets } = aiSeoSection(copy);
  return bullets[bullets.length - 2];
}

/** The "what AI says about your business" bullet: right before the score. */
function digestBullet(copy: ChecksCopy) {
  const { bullets } = aiSeoSection(copy);
  return bullets[bullets.length - 3];
}

/** The share-of-voice bullet (T7): the last bullet, added after the score. */
function shareOfVoiceBullet(copy: ChecksCopy) {
  const { bullets } = aiSeoSection(copy);
  return bullets[bullets.length - 1];
}

describe('the AI SEO / GEO section of the coverage page', () => {
  it.each(LOCALES)('carries one bullet per published check in %s', (_language, copy) => {
    // Crawler access, social preview tags, structured data, content clarity,
    // provider visibility, what AI says about the business, the visibility
    // score, and share of voice.
    expect(aiSeoSection(copy).bullets).toHaveLength(8);
  });

  // The summary above the answer cards: differences from the site, tone and
  // place. A buyer reads here that a difference is not a verdict on the model,
  // and that the summary is one run, not a model's memory.
  it('describes the facts, tone and place summary, with its limits (en)', () => {
    const body = digestBullet(checksCopyEn)?.body ?? '';
    expect(body).toContain('**differs from your site**');
    expect(body).toContain('tone');
    expect(body).toContain('named first');
    expect(body).toContain('snapshot of one run');
    expect(body).toContain('never changes your score');
  });

  it('describes the facts, tone and place summary, with its limits (uk)', () => {
    const body = digestBullet(checksCopyUk)?.body ?? '';
    expect(body).toContain('**розходиться з вашим сайтом**');
    expect(body).toContain('тоном');
    expect(body).toContain('названо першим');
    expect(body).toContain('знімок одного запуску');
    expect(body).toContain('на вашу оцінку це не впливає');
  });

  it.each(LOCALES)('publishes the score formula and its weights in %s', (_language, copy) => {
    const body = scoreBullet(copy)?.body ?? '';
    expect(body).toContain('**60%**');
    expect(body).toContain('**40%**');
    expect(body).toContain('**2**');
  });

  it('says the denominator is measured answers, not the answer count (en)', () => {
    const body = scoreBullet(checksCopyEn)?.body ?? '';
    expect(body).toContain('**measured**');
    expect(body).toContain('not the number of answers');
  });

  it('says the denominator is measured answers, not the answer count (uk)', () => {
    const body = scoreBullet(checksCopyUk)?.body ?? '';
    expect(body).toContain('**зміряти**');
    expect(body).toContain('не кількість відповідей');
  });

  it('says the score is informational and outside the overall score (en)', () => {
    const body = scoreBullet(checksCopyEn)?.body ?? '';
    expect(body).toContain('informational only');
    expect(body).toContain('never part of your overall audit score');
  });

  it('says the score is informational and outside the overall score (uk)', () => {
    const body = scoreBullet(checksCopyUk)?.body ?? '';
    expect(body).toContain('лише інформаційна');
    expect(body).toContain('не входить у загальну оцінку аудиту');
  });

  // T7: the share-of-voice bullet is where a buyer learns competitor names
  // never leave FluxRadar's own servers — that claim is pinned here, in both
  // languages, the same way the score formula above is.
  it('says competitor names are matched locally and never sent to a provider (en)', () => {
    const bullet = shareOfVoiceBullet(checksCopyEn);
    expect(bullet?.term).toContain('Share of voice');
    expect(bullet?.body ?? '').toContain('never sent to an AI provider');
  });

  it('says competitor names are matched locally and never sent to a provider (uk)', () => {
    const bullet = shareOfVoiceBullet(checksCopyUk);
    expect(bullet?.term).toContain('Частка голосу');
    expect(bullet?.body ?? '').toContain('ніколи не надсилаються AI-провайдеру');
  });
});

it.each(LOCALES)('names all twelve crawler policies in %s', (_language, copy) => {
  const body = aiSeoSection(copy).bullets[0]?.body ?? '';
  for (const agent of [
    'OAI-SearchBot',
    'Claude-SearchBot',
    'PerplexityBot',
    'ChatGPT-User',
    'Claude-User',
    'Perplexity-User',
    'GPTBot',
    'ClaudeBot',
    'Google-Extended',
    'Applebot-Extended',
    'CCBot',
    'Bytespider',
  ])
    expect(body).toContain(agent);
  expect(body).toMatch(/does not affect appearance in AI search|не впливає на появу в AI-пошуку/);
});
