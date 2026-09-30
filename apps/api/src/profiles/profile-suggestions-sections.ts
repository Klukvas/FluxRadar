// Offerings read from the page itself, when its markup states none.
//
// The first version copied every `h2` and `h3` on the page. On a studio's
// homepage that proposed "Featured Projects, WashFlow, Accounting, Why fluxLab?,
// Full Ownership, Battle-Tested Stack" as the services it sells — section
// labels, product code names and marketing claims, nothing anyone buys. The
// owner then had to delete all of it, which is worse than an empty field.
//
// Headings are now read only inside a section the page itself calls its services
// or products, and even there a heading that reads as a section label, a
// question or a navigation entry is dropped. A page with no such section
// proposes nothing, and the form says so.

import type { HTMLElement } from 'node-html-parser';

import { boundedText, uniqueText } from './profile-suggestions-text.ts';

const MAX_ITEMS = 12;
const MAX_ITEM_CHARS = 80;
const MAX_ITEM_WORDS = 10;

const HEADING_LEVELS: Readonly<Record<string, number>> = { H1: 1, H2: 2, H3: 3, H4: 4 };

/** A heading the page uses to mean "the things we sell" — the UI's two languages. */
const SERVICE_SECTION =
  /\b(services?|products?|offerings?|what we (do|offer))\b|послуг|товар|продукт|що ми (робимо|пропонуємо)|напрямк/i;

/** Section labels, marketing claims and navigation — never a thing anyone buys. */
const NOT_AN_OFFERING: readonly RegExp[] = [
  /\b(why|about|contact|faq|frequently asked|testimonial|review|client|partner|portfolio|project|case stud|blog|news|career|job|vacanc|team|pricing|price|plan|feature|how it works|get started|sign (in|up)|log in|subscribe|newsletter|follow us|featured|privacy|terms|cookie|sitemap|language|menu|home)\b/i,
  /чому|про нас|контакт|відгук|клієнт|партнер|портфоліо|проєкт|проект|кейс|блог|новин|вакансі|команда|ціни|тариф|як це працює|підписат|політик|умови|кукі|мова|меню|головна/i,
];

function headingLevel(node: HTMLElement): number | undefined {
  return HEADING_LEVELS[node.tagName];
}

/**
 * A candidate offering, or nothing when the text reads as something else: a
 * question, a sentence, a navigation entry, or a section label.
 */
function offeringText(node: HTMLElement): string | undefined {
  const value = boundedText(node.text, MAX_ITEM_CHARS + 1);
  if (value === undefined || value.length > MAX_ITEM_CHARS) return undefined;
  if (value.length < 2 || !/\p{L}/u.test(value)) return undefined;
  if (value.endsWith('?')) return undefined;
  if (value.split(' ').length > MAX_ITEM_WORDS) return undefined;
  if (NOT_AN_OFFERING.some((pattern) => pattern.test(value))) return undefined;
  return value;
}

/**
 * The services or products named inside the page's own services section.
 *
 * The section runs from the heading that names it to the next heading at the
 * same level or above, so it needs no assumption about which element the page
 * wrapped it in. Only the first such section is read: a second one is usually a
 * repeat in the footer.
 */
export function offeringsFromSections(root: HTMLElement): readonly string[] {
  const flat = root.querySelectorAll('h1,h2,h3,h4,li');
  const start = flat.findIndex(
    (node) => headingLevel(node) !== undefined && SERVICE_SECTION.test(node.text),
  );
  const heading = start === -1 ? undefined : flat[start];
  const sectionLevel = heading === undefined ? undefined : headingLevel(heading);
  if (sectionLevel === undefined) return [];
  const items: string[] = [];
  for (const node of flat.slice(start + 1)) {
    const level = headingLevel(node);
    if (level !== undefined && level <= sectionLevel) break;
    // A list that nests another list would otherwise contribute its children's
    // text twice: once joined on the outer item, once on each inner one.
    if (node.tagName === 'LI' && node.querySelector('li') !== null) continue;
    const value = offeringText(node);
    if (value !== undefined) items.push(value);
    if (items.length >= MAX_ITEMS) break;
  }
  return uniqueText(items).slice(0, MAX_ITEMS);
}
