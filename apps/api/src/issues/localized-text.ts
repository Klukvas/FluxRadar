// A finding's evidence and recommendation in each report language.
//
// Issue rows written since findings carried message codes store the codes and
// their values in `messagesJson`; they are rendered here for every language so
// the browser only has to pick one. A row from before that, or one whose JSON
// this build cannot read, answers null and the reader sees the text stored with
// the finding — which is what every row showed before this existed.

import {
  FINDING_LANGUAGES,
  renderFindingMessage,
  truncateExcerpt,
  type FindingLanguage,
} from '@fluxradar/rules';
import { z } from 'zod';

const messageRefSchema = z.object({
  code: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
});

const messagesSchema = z.object({
  evidence: messageRefSchema,
  recommendation: messageRefSchema,
});

export interface LocalizedFindingText {
  readonly evidenceExcerpt: string | null;
  readonly recommendation: string | null;
}

export type LocalizedFindingTexts = Readonly<Record<FindingLanguage, LocalizedFindingText>>;

export type StoredFindingMessages = z.infer<typeof messagesSchema>;

/** The message codes and values stored with a finding, or null when there are none to read. */
export function storedFindingMessages(messagesJson: string | null): StoredFindingMessages | null {
  if (messagesJson === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(messagesJson) as unknown;
  } catch {
    // Unreadable stored JSON is not an error the reader can act on: the stored
    // English text is still there, and it is what this row falls back to.
    return null;
  }
  const parsed = messagesSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function localizedFindingTexts(messagesJson: string | null): LocalizedFindingTexts | null {
  const messages = storedFindingMessages(messagesJson);
  if (messages === null) return null;
  const { evidence, recommendation } = messages;
  return Object.fromEntries(
    FINDING_LANGUAGES.map((language) => {
      const evidenceText = renderFindingMessage(evidence, language);
      return [
        language,
        {
          // The same §16 limit the stored excerpt obeys; a Ukrainian sentence
          // is longer than the English one it was rendered next to.
          evidenceExcerpt: evidenceText === null ? null : truncateExcerpt(evidenceText),
          recommendation: renderFindingMessage(recommendation, language),
        },
      ];
    }),
  ) as LocalizedFindingTexts;
}
