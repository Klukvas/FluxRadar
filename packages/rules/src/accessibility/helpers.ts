import type { HTMLElement } from 'node-html-parser';

export interface RgbColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary']);
const REFERENCE_ATTRIBUTES = [
  'aria-activedescendant',
  'aria-controls',
  'aria-describedby',
  'aria-errormessage',
  'aria-labelledby',
  'aria-owns',
] as const;

export function elementSelector(element: HTMLElement): string {
  const tag = element.rawTagName.toLowerCase();
  const id = element.getAttribute('id')?.trim() ?? '';
  if (id !== '') {
    return `${tag}#${id}`;
  }
  const name = element.getAttribute('name')?.trim() ?? '';
  if (name !== '') {
    return `${tag}[name="${name}"]`;
  }
  return tag;
}

export function accessibleName(element: HTMLElement, root: HTMLElement): string {
  const ariaLabel = element.getAttribute('aria-label')?.trim() ?? '';
  if (ariaLabel !== '') {
    return ariaLabel;
  }
  const labelledBy = referencedElements(element, 'aria-labelledby', root)
    .map((label) => label.textContent.trim())
    .filter((text) => text !== '')
    .join(' ');
  if (labelledBy !== '') {
    return labelledBy;
  }
  const id = element.getAttribute('id')?.trim() ?? '';
  if (id !== '') {
    const label = root
      .querySelectorAll('label')
      .find((candidate) => candidate.getAttribute('for') === id);
    const labelText = label?.textContent.trim() ?? '';
    if (labelText !== '') {
      return labelText;
    }
  }
  const wrappingLabel = element.closest('label')?.textContent.trim() ?? '';
  if (wrappingLabel !== '') {
    return wrappingLabel;
  }
  const title = element.getAttribute('title')?.trim() ?? '';
  if (title !== '') {
    return title;
  }
  const alt = element.getAttribute('alt')?.trim() ?? '';
  if (alt !== '') {
    return alt;
  }
  const value = element.getAttribute('value')?.trim() ?? '';
  if (value !== '') {
    return value;
  }
  return element.textContent.replace(/\s+/g, ' ').trim();
}

export function isFocusable(element: HTMLElement): boolean {
  if (element.getAttribute('aria-hidden')?.trim().toLowerCase() === 'true') {
    return false;
  }
  if (element.getAttribute('disabled') !== undefined) {
    return false;
  }
  const tabindex = element.getAttribute('tabindex');
  if (tabindex !== undefined) {
    return Number.parseInt(tabindex, 10) >= 0;
  }
  const tag = element.rawTagName.toLowerCase();
  if (tag === 'a') {
    return (element.getAttribute('href')?.trim() ?? '') !== '';
  }
  if (tag === 'input') {
    return (element.getAttribute('type')?.trim().toLowerCase() ?? 'text') !== 'hidden';
  }
  return INTERACTIVE_TAGS.has(tag);
}

export function referencedElements(
  element: HTMLElement,
  attribute: (typeof REFERENCE_ATTRIBUTES)[number],
  root: HTMLElement,
): readonly HTMLElement[] {
  const value = element.getAttribute(attribute)?.trim() ?? '';
  if (value === '') {
    return [];
  }
  const byId = new Map(
    root
      .querySelectorAll('[id]')
      .map((candidate) => [candidate.getAttribute('id')?.trim() ?? '', candidate] as const)
      .filter(([id]) => id !== ''),
  );
  return value
    .split(/\s+/)
    .map((id) => byId.get(id))
    .filter((candidate): candidate is HTMLElement => candidate !== undefined);
}

export function missingReferencedIds(
  element: HTMLElement,
  attribute: (typeof REFERENCE_ATTRIBUTES)[number],
  root: HTMLElement,
): readonly string[] {
  const value = element.getAttribute(attribute)?.trim() ?? '';
  if (value === '') {
    return [];
  }
  const ids = new Set(
    root
      .querySelectorAll('[id]')
      .map((candidate) => candidate.getAttribute('id')?.trim() ?? '')
      .filter((id) => id !== ''),
  );
  return value.split(/\s+/).filter((id) => !ids.has(id));
}

export function referenceAttributes(): readonly (typeof REFERENCE_ATTRIBUTES)[number][] {
  return REFERENCE_ATTRIBUTES;
}

export function styleText(root: HTMLElement): string {
  return root
    .querySelectorAll('style')
    .map((style) => style.textContent)
    .join('\n');
}

export function inlineStyle(element: HTMLElement): string {
  return element.getAttribute('style')?.toLowerCase() ?? '';
}

export function parseColor(value: string): RgbColor | null {
  const normalized = value.trim().toLowerCase();
  const hex = normalized.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex !== undefined) {
    if (hex.length === 3 || hex.length === 4) {
      return {
        red: Number.parseInt(`${hex[0]}${hex[0]}`, 16),
        green: Number.parseInt(`${hex[1]}${hex[1]}`, 16),
        blue: Number.parseInt(`${hex[2]}${hex[2]}`, 16),
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        red: Number.parseInt(hex.slice(0, 2), 16),
        green: Number.parseInt(hex.slice(2, 4), 16),
        blue: Number.parseInt(hex.slice(4, 6), 16),
      };
    }
  }
  const rgb = normalized.match(/^rgba?\(([^)]+)\)$/)?.[1];
  if (rgb !== undefined) {
    const channels = rgb
      .split(',')
      .slice(0, 3)
      .map((channel) => channel.trim());
    if (channels.length === 3) {
      const parsed = channels.map((channel) =>
        channel.endsWith('%')
          ? (Number.parseFloat(channel) * 255) / 100
          : Number.parseFloat(channel),
      );
      if (parsed.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255)) {
        return {
          red: parsed[0] ?? 0,
          green: parsed[1] ?? 0,
          blue: parsed[2] ?? 0,
        };
      }
    }
  }
  return NAMED_COLORS[normalized] ?? null;
}

export function contrastRatio(foreground: RgbColor, background: RgbColor): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function parseInlineColorPair(
  element: HTMLElement,
): { readonly foreground: RgbColor; readonly background: RgbColor; readonly ratio: number } | null {
  const style = inlineStyle(element);
  const foreground = declarationValue(style, 'color');
  const background = declarationValue(style, 'background-color');
  if (foreground === null || background === null) {
    return null;
  }
  const foregroundColor = parseColor(foreground);
  const backgroundColor = parseColor(background);
  if (foregroundColor === null || backgroundColor === null) {
    return null;
  }
  return {
    foreground: foregroundColor,
    background: backgroundColor,
    ratio: contrastRatio(foregroundColor, backgroundColor),
  };
}

function declarationValue(style: string, property: string): string | null {
  const match = style.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  return match?.[1]?.trim() ?? null;
}

function relativeLuminance(color: RgbColor): number {
  const channels = [color.red, color.green, color.blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

const NAMED_COLORS: Readonly<Record<string, RgbColor>> = {
  black: { red: 0, green: 0, blue: 0 },
  blue: { red: 0, green: 0, blue: 255 },
  gray: { red: 128, green: 128, blue: 128 },
  grey: { red: 128, green: 128, blue: 128 },
  green: { red: 0, green: 128, blue: 0 },
  red: { red: 255, green: 0, blue: 0 },
  transparent: { red: 255, green: 255, blue: 255 },
  white: { red: 255, green: 255, blue: 255 },
  yellow: { red: 255, green: 255, blue: 0 },
};
