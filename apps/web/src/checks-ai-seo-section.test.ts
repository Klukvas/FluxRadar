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

/** The share-of-voice bullet (T7): the last bullet, added after the score. */
function shareOfVoiceBullet(copy: ChecksCopy) {
  const { bullets } = aiSeoSection(copy);
  return bullets[bullets.length - 1];
}

describe('the AI SEO / GEO section of the coverage page', () => {
  it.each(LOCALES)('carries one bullet per published check in %s', (_language, copy) => {
    // Crawler access, llms.txt, structured data, content clarity, provider
    // visibility, the visibility score, and share of voice.
    expect(aiSeoSection(copy).bullets).toHaveLength(7);
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
