import type { HTMLElement } from 'node-html-parser';

const ADDRESS_LABEL = /^(?:address|адреса|адрес)\s*[:—-]\s*(.{5,})$/iu;
const PHONE_LABEL =
  /^(?:telephone|phone|tel\.?|телефон|тел\.)\s*[:—-]?\s*([+\d][\d\s().;-]{6,}\d)/iu;
const CITY_MARKER = /(?:^|[\s,])(?:м\.?|місто|г\.?|город)\s+[\p{L}][\p{L}'’ -]{1,50}(?:,|\s)/iu;
const STREET_BUILDING =
  /(?:^|[\s,])(?:вул(?:иця)?\.?|ул(?:ица)?\.?|просп(?:ект)?\.?|пров(?:улок)?\.?|пл(?:оща)?\.?)\s+[\p{L}][\p{L}\s()'’.-]{1,100}\s*\d{1,5}[\p{L}]?(?:[\s,/.]|$)/iu;
const HOURS =
  /(?:\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|opening hours|hours)\b|годин|графік|режим роботи|понеділок|вівторок|середа|четвер|п’ятниця|субота|неділя|пн\s*[-–:]|пн\s*[:.])[^<]{0,100}\d{1,2}[:.]\d{2}/iu;

export function telephoneValues(root: HTMLElement): readonly string[] {
  const links = root.querySelectorAll('a[href]').flatMap((element) => {
    const href = element.getAttribute('href') ?? '';
    return /^tel:/i.test(href) ? [href] : [];
  });
  const marked = root
    .querySelectorAll('[itemprop="telephone"]')
    .map((element) => element.getAttribute('content') ?? element.text);
  const labeled = root.querySelectorAll('p, li, dd').flatMap((element) => {
    const match = PHONE_LABEL.exec(element.text.trim());
    return match?.[1] === undefined ? [] : [match[1]];
  });
  return [...links, ...marked, ...labeled];
}

export function visibleAddresses(root: HTMLElement, contactContext = false): readonly string[] {
  const marked = root.querySelectorAll('address').map((element) => element.text.trim());
  const labeled = root.querySelectorAll('p, li, dd').flatMap((element) => {
    const match = ADDRESS_LABEL.exec(element.text.trim());
    return match?.[1] === undefined ? [] : [match[1]];
  });
  // On an explicit contact surface, a city + street + building is physical
  // address evidence even without a redundant "Address:" label. This fallback
  // stays off for generic prose and does not identify a branch on its own.
  const physical = contactContext
    ? root
        .querySelectorAll('p, li, dd')
        .map((element) => element.text.trim())
        .filter(
          (text) => text.length <= 400 && CITY_MARKER.test(text) && STREET_BUILDING.test(text),
        )
    : [];
  const street = root.querySelector('[itemprop="streetAddress"]');
  const city = root.querySelector('[itemprop="addressLocality"]');
  const structured =
    street !== null && city !== null
      ? [
          `${street.getAttribute('content') ?? street.text} ${city.getAttribute('content') ?? city.text}`,
        ]
      : [];
  return [...new Set([...marked, ...labeled, ...structured, ...physical])].filter(
    (value) => value.length >= 5,
  );
}

export function hasObservedHours(root: HTMLElement): boolean {
  return root
    .querySelectorAll(
      'p, li, dd, span, time, [itemprop="openingHours"], [itemprop="openingHoursSpecification"]',
    )
    .some((element) => {
      const value = element.getAttribute('content') ?? element.text;
      return (
        HOURS.test(value) ||
        ((element.getAttribute('itemprop') ?? '').startsWith('openingHours') &&
          /\d{1,2}[:.]\d{2}/u.test(value))
      );
    });
}
