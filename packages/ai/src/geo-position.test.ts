// Where the brand sits in a discovery answer: lists, prose, and who came first.

import { describe, expect, it } from 'vitest';

import {
  computeGeoAnswerPositions,
  geoAnswerPosition,
  isFirstPlace,
  summarizeGeoPositions,
} from './geo-position.js';
import type { GeoMentionSignals } from './geo-rules.js';
import type { AiRequestOutcome } from './run-request.js';
import { makeRequest, makeResponse, makeResponseOutcome } from './testing/harness.js';
import type { AiProviderName } from './types.js';

const BRAND = 'Smile Clinic';

function place(answer: string, extra: { competitors?: string[]; question?: string } = {}) {
  return geoAnswerPosition({ answer, brand: BRAND, ...extra });
}

describe('the brand in a list', () => {
  it('ranks it in a numbered list', () => {
    const answer = 'Top clinics:\n1. Dent Pro\n2. Smile Clinic\n3. Bright Teeth';

    expect(place(answer)).toEqual({ kind: 'list', rank: 2, listSize: 3, competitorsBefore: 0 });
  });

  it('ranks it fifth in a bulleted list', () => {
    const answer = ['Options:', '- A', '- B', '* C', '• D', '- Smile Clinic, Kyiv'].join('\n');

    expect(place(answer)).toMatchObject({ kind: 'list', rank: 5, listSize: 5 });
  });

  it('ranks it first when it opens the list', () => {
    const answer = '1. **Smile Clinic** — implants\n2. **Dent Pro** — cleaning';

    const position = place(answer);
    expect(position).toMatchObject({ kind: 'list', rank: 1, listSize: 2 });
    expect(position !== null && isFirstPlace(position)).toBe(true);
  });

  it('reads Markdown headings with numbers and the text under them as one list', () => {
    const answer = [
      '### 1. Dent Pro',
      'A large clinic near the centre.',
      '',
      '### 2. Bright Teeth',
      'Known for whitening.',
      '',
      '### 3. Smile Clinic',
      'Implants and emergency care.',
    ].join('\n');

    expect(place(answer)).toMatchObject({ kind: 'list', rank: 3, listSize: 3 });
  });

  // A plain numbered item ends where unindented text begins, as a bullet does:
  // the sentence after the list is not part of its last item.
  it('ends a plain numbered list at the first unindented line after it', () => {
    const answer = '1. Dent Pro\n2. Bright Teeth\nSmile Clinic is also worth a look.';

    expect(place(answer)).toEqual({ kind: 'prose', bucket: 'late', competitorsBefore: 0 });
  });

  // A title item — heading or bold — keeps the description written right
  // under it, even when it is the last item.
  it('keeps the description under a last heading or bold-title item', () => {
    expect(
      place('### 1. Dent Pro\nA large clinic.\n### 2. Bright Teeth\nPartner of Smile Clinic.'),
    ).toMatchObject({ kind: 'list', rank: 2, listSize: 2 });
    expect(
      place('**1. Dent Pro**\nA large clinic.\n**2. Bright Teeth**\nPartner of Smile Clinic.'),
    ).toMatchObject({ kind: 'list', rank: 2, listSize: 2 });
  });

  // A heading or a bold-only title after the last titled item is the next
  // section, not that item's description — with or without a blank line.
  it('ends a titled list at the next heading or bold-only title', () => {
    expect(
      place(
        '### 1. Dent Pro\nA large clinic.\n### 2. Bright Teeth\nKnown for whitening.\n### Conclusion\nSmile Clinic is also fine.',
      ),
    ).toEqual({ kind: 'prose', bucket: 'late', competitorsBefore: 0 });
    expect(
      place(
        '**1. Dent Pro**\nA large clinic.\n**2. Bright Teeth**\nKnown for whitening.\n**Conclusion**\nSmile Clinic is also fine.',
      ),
    ).toEqual({ kind: 'prose', bucket: 'late', competitorsBefore: 0 });
  });

  // The bullets under a numbered section heading are that section's list, and
  // the brand's place is its place among them — not the heading's number.
  it('ranks the brand among the bullets under a numbered section heading', () => {
    expect(
      geoAnswerPosition({
        answer: '## 1. Top picks\n- Rival\n- Acme\n- Other\n## 2. Honourable mentions\n- Zed',
        brand: 'Acme',
      }),
    ).toMatchObject({ kind: 'list', rank: 2, listSize: 3 });
  });

  it('starts a new list at a plain numbered list right after a titled one', () => {
    expect(
      geoAnswerPosition({
        answer: '**1. Rival**\nRival is fine.\n**2. Other**\nOther is fine.\n1. Acme\n2. Zed',
        brand: 'Acme',
      }),
    ).toMatchObject({ kind: 'list', rank: 1, listSize: 2 });
  });

  it('reads en dash bullets as a list', () => {
    expect(
      geoAnswerPosition({ answer: 'Ось варіанти:\n– Rival\n– Acme\n– Other', brand: 'Acme' }),
    ).toMatchObject({ kind: 'list', rank: 2, listSize: 3 });
  });

  it('does not read a dash inside a sentence as a bullet', () => {
    expect(
      geoAnswerPosition({
        answer: 'Rival – популярна клініка.\nAcme – теж варіант. Інші далі.',
        brand: 'Acme',
      }),
    ).toMatchObject({ kind: 'prose' });
  });

  // Table rows are table syntax: with them counted, the second of two prose
  // sentences would read as "early" in a six-line answer.
  it('does not count table rows as sentences when the brand is outside the table', () => {
    const answer =
      'Compare the options.\nSmile Clinic is closest.\n| Clinic | Area |\n|---|---|\n| Dent Pro | Centre |\n| Bright Teeth | Podil |';

    expect(place(answer)).toMatchObject({ kind: 'prose', bucket: 'late' });
  });

  it('keeps nested bullets inside their numbered item', () => {
    const answer = [
      '1. Dent Pro',
      '   - Address: Khreshchatyk 1',
      '2. Bright Teeth',
      '   - Partner of Smile Clinic',
      '3. Smile Clinic',
    ].join('\n');

    // The first item naming the brand is the second one, by its nested line.
    expect(place(answer)).toMatchObject({ kind: 'list', rank: 2, listSize: 3 });
  });

  it('uses the list rank even when an introduction named the brand first', () => {
    const answer =
      'Smile Clinic and others are popular.\n- Dent Pro\n- Bright Teeth\n- Smile Clinic';

    expect(place(answer)).toMatchObject({ kind: 'list', rank: 3, listSize: 3 });
  });

  it('counts a Markdown list numbered 1, 1, 1 the way it renders', () => {
    const answer = '1. Dent Pro\n1. Bright Teeth\n1. Smile Clinic';

    expect(place(answer)).toEqual({ kind: 'list', rank: 3, listSize: 3, competitorsBefore: 0 });
  });

  it('reads numbers closed by a parenthesis as a list', () => {
    expect(place('1) A\n2) Smile Clinic')).toEqual({
      kind: 'list',
      rank: 2,
      listSize: 2,
      competitorsBefore: 0,
    });
  });

  it('does not call a single bullet a list', () => {
    const answer = 'You could try:\n- Smile Clinic\n\nIt is well reviewed.';

    expect(place(answer)).toMatchObject({ kind: 'prose' });
  });

  it('places a brand named only after the list in the prose', () => {
    const answer = [
      'Here are clinics.',
      '1. Dent Pro',
      '2. Bright Teeth',
      '',
      'Some people also mention Smile Clinic.',
    ].join('\n');

    expect(place(answer)).toEqual({ kind: 'prose', bucket: 'late', competitorsBefore: 0 });
  });
});

describe('the brand in prose', () => {
  it('finds it in the first sentence', () => {
    expect(place('Smile Clinic is a good choice. Others exist.')).toMatchObject({
      kind: 'prose',
      bucket: 'first-sentence',
    });
  });

  it('places it early in the first half of the answer', () => {
    const answer = 'Kyiv has many clinics. Smile Clinic is one. A. B. C.';

    expect(place(answer)).toMatchObject({ bucket: 'early' });
  });

  it('places it late in the second half', () => {
    const answer = 'Kyiv has many clinics. Prices vary. Book early. Smile Clinic is one.';

    expect(place(answer)).toMatchObject({ bucket: 'late' });
  });

  it('returns nothing when the answer does not name the brand', () => {
    expect(place('Dent Pro is the best known clinic.')).toBeNull();
  });
});

describe('competitors named before the brand', () => {
  it('counts profile competitors that precede the brand’s list item', () => {
    const answer = '1. Dent Pro\n2. Bright Teeth\n3. Smile Clinic\n4. Laser Dent';

    expect(place(answer, { competitors: ['Dent Pro', 'Laser Dent', 'Unrelated'] })).toMatchObject({
      rank: 3,
      competitorsBefore: 1,
    });
  });

  it('ignores a competitor the question itself named', () => {
    const answer = 'Dent Pro is popular, but Smile Clinic is closer.';

    expect(
      place(answer, { competitors: ['Dent Pro'], question: 'Is there anything like Dent Pro?' }),
    ).toMatchObject({ competitorsBefore: 0 });
    expect(place(answer, { competitors: ['Dent Pro'] })).toMatchObject({ competitorsBefore: 1 });
  });

  it('does not count a competitor whose name sits inside the brand', () => {
    const answer = 'Smile Clinic offers implants.';

    expect(place(answer, { competitors: ['Smile'] })).toMatchObject({ competitorsBefore: 0 });
  });

  it('is not first place when a rival opens the sentence', () => {
    const position = place('Dent Pro and Smile Clinic are both in Kyiv.', {
      competitors: ['Dent Pro'],
    });

    expect(position).toMatchObject({ bucket: 'first-sentence', competitorsBefore: 1 });
    expect(position !== null && isFirstPlace(position)).toBe(false);
  });
});

describe('spellings of the brand', () => {
  it('matches case-insensitively, the way the brand signal does', () => {
    expect(place('1. SMILE CLINIC\n2. Dent Pro')).toMatchObject({ rank: 1 });
  });

  it('matches a suffixed form the way the brand signal’s substring does', () => {
    expect(
      geoAnswerPosition({ answer: '- Dent Pro\n- Fyno’s fulfilment', brand: 'Fyno' }),
    ).toMatchObject({ kind: 'list', rank: 2 });
  });

  it('reads Ukrainian answers and Cyrillic brands', () => {
    const answer = 'Ось варіанти:\n1. Дент Про\n2. Посмішка Плюс\n3. АКПЕРОВА НЕЙЛС — манікюр';

    expect(
      geoAnswerPosition({ answer, brand: 'Акперова Нейлс', competitors: ['Дент Про'] }),
    ).toEqual({ kind: 'list', rank: 3, listSize: 3, competitorsBefore: 1 });
  });

  // «вул.» is an abbreviation, not the end of a sentence: splitting there put
  // the brand into the second half of a three-sentence answer.
  it('does not end a sentence at a Ukrainian street abbreviation', () => {
    expect(
      geoAnswerPosition({
        answer: 'Дент Про на вул. Хрещатик 1. Smile Clinic поруч. Інші далі.',
        brand: 'Smile Clinic',
      }),
    ).toMatchObject({ kind: 'prose', bucket: 'early' });
  });

  it('places a Ukrainian prose mention by sentence', () => {
    const answer =
      'У Києві багато салонів. Ціни різні. Варто записатися заздалегідь. Акперова Нейлс також.';

    expect(geoAnswerPosition({ answer, brand: 'Акперова Нейлс' })).toMatchObject({
      kind: 'prose',
      bucket: 'late',
    });
  });
});

function answer(
  key: string,
  provider: AiProviderName,
  text: string,
  promptVersion = 'geo-questions-v5-discovery',
): AiRequestOutcome {
  return makeResponseOutcome({
    aiRequestKey: key,
    request: makeRequest({
      provider,
      promptVersion,
      question: 'Which dental clinics in Kyiv do people recommend?',
    }),
    response: makeResponse({ provider, rawText: text, citations: [] }),
  });
}

const MENTIONED: GeoMentionSignals = { brand: 'mentioned', domain: 'not-mentioned' };

describe('positions per provider', () => {
  const outcomes = [
    answer('a1', 'anthropic', '1. Smile Clinic\n2. Dent Pro'),
    answer('a2', 'anthropic', '1. Dent Pro\n2. Bright\n3. Smile Clinic'),
    answer('a3', 'anthropic', 'Dent Pro is good. Smile Clinic too.'),
    answer('a4', 'anthropic', 'No clinic named here.'),
    answer('o1', 'openai', '1. Smile Clinic\n2. Dent Pro'),
    answer('c1', 'openai', 'Smile Clinic is a clinic.', 'geo-questions-v5-closed-book'),
  ];
  const mentions = new Map<string, GeoMentionSignals>([
    ['a1', MENTIONED],
    ['a2', MENTIONED],
    ['a3', MENTIONED],
    ['a4', { brand: 'not-mentioned', domain: 'not-mentioned' }],
    ['o1', MENTIONED],
    ['c1', { brand: 'named-in-question', domain: 'named-in-question' }],
  ]);
  const input = { outcomes, mentions, brand: BRAND, competitors: ['Dent Pro'] };

  it('places only discovery answers that mention the brand', () => {
    const positions = computeGeoAnswerPositions(input);

    expect([...positions.keys()]).toEqual(['a1', 'a2', 'a3', 'o1']);
  });

  it('counts first places, list places and rivals named first, as N of M', () => {
    const summary = summarizeGeoPositions(input, computeGeoAnswerPositions(input));

    expect(summary.competitorsConfigured).toBe(true);
    expect(summary.providers).toEqual([
      {
        provider: 'anthropic',
        discoveryAnswers: 4,
        placedAnswers: 3,
        firstPlace: 1,
        inList: 2,
        medianListRank: 2,
        afterCompetitors: 2,
      },
      {
        provider: 'openai',
        discoveryAnswers: 1,
        placedAnswers: 1,
        firstPlace: 1,
        inList: 1,
        // One list placement is not enough for a median.
        medianListRank: null,
        afterCompetitors: 0,
      },
    ]);
  });

  it('says when no competitors were configured', () => {
    const summary = summarizeGeoPositions(
      { ...input, competitors: [] },
      computeGeoAnswerPositions({ ...input, competitors: [] }),
    );

    expect(summary.competitorsConfigured).toBe(false);
    expect(summary.providers.every((provider) => provider.afterCompetitors === 0)).toBe(true);
  });
});

// The shapes models actually answer in, pinned so a later parser change cannot
// quietly move a brand's place on any of them.
describe('realistic answer layouts', () => {
  it.each([
    {
      name: 'EN plain numbered list with a closing paragraph',
      brand: 'Smile Clinic',
      answer:
        'Here are some options in Kyiv:\n1. Dent Pro – central, modern equipment.\n2. Smile Clinic – known for implants.\n3. Bright Teeth – affordable.\nAll three accept online booking.',
      expected: { kind: 'list', rank: 2, listSize: 3 },
    },
    {
      name: 'UK bold-title list with descriptions',
      brand: 'Смайл Клінік',
      answer:
        'Ось кілька варіантів:\n\n**1. Дент Про**\nВеликий центр на Хрещатику.\n\n**2. Посмішка Плюс**\nПрацює без вихідних.\n\n**3. Смайл Клінік**\nІмплантація та відбілювання.',
      expected: { kind: 'list', rank: 3, listSize: 3 },
    },
    {
      name: 'numbered ## sections with bullets',
      brand: 'Smile Clinic',
      answer: '## 1. Clinics\n- Dent Pro\n- Smile Clinic\n## 2. Labs\n- Lab One\n- Lab Two',
      expected: { kind: 'list', rank: 2, listSize: 2 },
    },
    {
      name: 'UK en dash bullets',
      brand: 'Смайл Клінік',
      answer: 'Можна звернутися до:\n– Дент Про\n– Смайл Клінік\n– Посмішка Плюс',
      expected: { kind: 'list', rank: 2, listSize: 3 },
    },
    {
      name: '### title items with descriptions and a summary heading',
      brand: 'Smile Clinic',
      answer:
        '### 1. Dent Pro\nCentral location.\n### 2. Smile Clinic\nImplants and whitening.\n### Summary\nBoth are fine.',
      expected: { kind: 'list', rank: 2, listSize: 2 },
    },
    {
      name: 'intro, list and a conclusion that names the brand',
      brand: 'Smile Clinic',
      answer:
        'Popular choices:\n- Dent Pro\n- Bright Teeth\n\nIf you prefer a quieter place, Smile Clinic is worth a call.',
      expected: { kind: 'prose', bucket: 'late' },
    },
    {
      name: 'brand only in the intro sentence',
      brand: 'Smile Clinic',
      answer: 'Smile Clinic is often recommended. Other options:\n- Dent Pro\n- Bright Teeth',
      expected: { kind: 'prose', bucket: 'first-sentence' },
    },
    {
      name: 'brand in the intro and in the list',
      brand: 'Smile Clinic',
      answer: 'Smile Clinic and Dent Pro are both popular.\n1. Dent Pro\n2. Smile Clinic',
      expected: { kind: 'list', rank: 2, listSize: 2, competitorsBefore: 1 },
    },
    {
      name: 'indented details under numbered items',
      brand: 'Smile Clinic',
      answer:
        '1. Dent Pro\n   - Address: Khreshchatyk 1\n   - Open daily\n2. Smile Clinic\n   - Address: Obolon',
      expected: { kind: 'list', rank: 2, listSize: 2 },
    },
    {
      name: 'Markdown table, brand in the first of two rows',
      brand: 'Smile Clinic',
      answer: '| Clinic | Area |\n|---|---|\n| Smile Clinic | Obolon |\n| Dent Pro | Centre |',
      expected: { kind: 'list', rank: 1, listSize: 2 },
    },
    {
      name: 'Markdown table, brand in the second of three rows',
      brand: 'Smile Clinic',
      answer:
        '| Clinic | Area |\n|:--|:--:|\n| Dent Pro | Centre |\n| Smile Clinic | Obolon |\n| Bright Teeth | Podil |',
      expected: { kind: 'list', rank: 2, listSize: 3, competitorsBefore: 1 },
    },
    {
      name: 'bullets with descriptions written under them (lazy continuation)',
      brand: 'Smile Clinic',
      answer:
        '- **Dent Pro**\nCentral location.\n- **Smile Clinic**\nImplants.\n- **Bright Teeth**\nAffordable.',
      expected: { kind: 'list', rank: 2, listSize: 3 },
    },
    {
      name: 'keycap emoji numbering',
      brand: 'Smile Clinic',
      answer: '1️⃣ Dent Pro\n2️⃣ Smile Clinic\n3️⃣ Bright Teeth',
      expected: { kind: 'list', rank: 2, listSize: 3 },
    },
    {
      name: 'emoji bullets',
      brand: 'Smile Clinic',
      answer: 'Options:\n🔹 Dent Pro\n🔹 Smile Clinic',
      expected: { kind: 'list', rank: 2, listSize: 2 },
    },
    {
      name: 'paragraphs that each open with a bold name',
      brand: 'Smile Clinic',
      answer:
        'A few places:\n\n**Dent Pro** – central, modern.\n\n**Smile Clinic** – implants.\n\n**Bright Teeth** – affordable.\n\nAll take online bookings.',
      expected: { kind: 'list', rank: 2, listSize: 3 },
    },
    {
      name: 'UK bold names with a colon, no blank lines',
      brand: 'Смайл Клінік',
      answer: '**Дент Про**: центр міста.\n**Смайл Клінік**: імплантація.',
      expected: { kind: 'list', rank: 2, listSize: 2 },
    },
    {
      // A line that is only a bold name reads as a heading as often as a business.
      name: 'paragraphs under bold-only name lines stay prose',
      brand: 'Smile Clinic',
      answer: '**Dent Pro**\nCentral.\n\n**Smile Clinic**\nImplants.',
      expected: { kind: 'prose', bucket: 'late' },
    },
    {
      // "Name: text" looks exactly like "Address: text"; nothing tells them apart.
      name: '"Name:" lines stay prose',
      brand: 'Smile Clinic',
      answer: 'Dent Pro: central.\nSmile Clinic: implants.\nBright Teeth: affordable.',
      expected: { kind: 'prose', bucket: 'early' },
    },
    {
      name: 'numbered items wrapping onto unindented lines',
      brand: 'Smile Clinic',
      answer:
        '1. Dent Pro, a large clinic\nin the centre.\n2. Bright Teeth, which shares a building\nwith Smile Clinic.',
      expected: { kind: 'list', rank: 2, listSize: 2 },
    },
    {
      name: 'prose beside a table counts only the sentences',
      brand: 'Smile Clinic',
      answer:
        'Compare the options.\nSmile Clinic is closest.\n| Clinic | Area |\n|---|---|\n| Dent Pro | Centre |\n| Bright Teeth | Podil |',
      expected: { kind: 'prose', bucket: 'late' },
    },
    {
      name: 'UK prose, mentioned late',
      brand: 'Смайл Клінік',
      answer:
        'У Києві багато клінік. Ціни різні. Варто записатися заздалегідь. Смайл Клінік також приймає.',
      expected: { kind: 'prose', bucket: 'late' },
    },
  ])('$name', ({ brand, answer, expected }) => {
    expect(
      geoAnswerPosition({ answer, brand, competitors: ['Dent Pro', 'Дент Про'] }),
    ).toMatchObject(expected);
  });
});
