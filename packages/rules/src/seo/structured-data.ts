// Structured-data helpers and rules. Static HTML is the only source in the
// public-only scanner; JSON-LD injected after load is explicitly not treated
// as absent because the crawler does not execute page JavaScript.

import type { PageSnapshot } from '@fluxradar/crawler';
import type { HTMLElement } from 'node-html-parser';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type { PageRule, RuleFinding } from '../engine/types.js';
import { isSuccessfulHtmlPage } from '../engine/types.js';
import { parsePage } from './dom.js';

const syntaxDescriptor = requireDescriptor('SEO-STRUCT-001');
const completenessDescriptor = requireDescriptor('SEO-STRUCT-002');

export interface JsonLdBlock {
  readonly selector: string;
  readonly rawText: string;
  readonly parsed: unknown | null;
}

export function jsonLdBlocks(page: PageSnapshot): readonly JsonLdBlock[] {
  if (page.html === null) return [];
  return parsePage(page)
    .querySelectorAll('script')
    .filter(
      (script) =>
        (script.getAttribute('type') ?? '').trim().toLowerCase() === 'application/ld+json',
    )
    .map((script) => toJsonLdBlock(script));
}

export function validJsonLdObjects(page: PageSnapshot): readonly Record<string, unknown>[] {
  return jsonLdBlocks(page).flatMap((block) => normalizeJsonLdObjects(block.parsed));
}

export function hasCompleteJsonLd(page: PageSnapshot): boolean {
  return validJsonLdObjects(page).some(hasJsonLdIdentity);
}

export const seoStruct001JsonLdSyntax: PageRule = {
  kind: 'page',
  descriptor: syntaxDescriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const invalid = jsonLdBlocks(page).filter((block) => block.parsed === null);
    if (invalid.length === 0) return [];
    return [
      pageFinding(syntaxDescriptor, page, {
        evidenceType: 'dom',
        evidence:
          `${invalid.length} JSON-LD block(s) не удалось разобрать как JSON; ` +
          `первый селектор: ${invalid[0]?.selector ?? 'script[type="application/ld+json"]'}`,
        recommendation:
          'Проверьте JSON-LD через JSON parser и Rich Results Test; один сломанный блок ' +
          'может сделать structured data недоступными поисковым системам.',
        selector: invalid[0]?.selector ?? 'script[type="application/ld+json"]',
        resource: 'json-ld',
      }),
    ];
  },
};

export const seoStruct002JsonLdCompleteness: PageRule = {
  kind: 'page',
  descriptor: completenessDescriptor,
  isApplicable: isSuccessfulHtmlPage,
  evaluatePage(page: PageSnapshot): readonly RuleFinding[] {
    const incomplete = jsonLdBlocks(page).filter((block) => isIncompleteJsonLd(block.parsed));
    if (incomplete.length === 0) return [];
    return [
      pageFinding(completenessDescriptor, page, {
        evidenceType: 'dom',
        evidence: `${incomplete.length} JSON-LD block(s) не содержат одновременно непустые @context и @type`,
        recommendation:
          'Добавьте в каждый JSON-LD объект корректные @context и @type; значения должны ' +
          'описывать видимую сущность страницы.',
        selector: incomplete[0]?.selector ?? 'script[type="application/ld+json"]',
        resource: 'json-ld',
      }),
    ];
  },
};

function toJsonLdBlock(script: HTMLElement): JsonLdBlock {
  const rawText = script.rawText.trim();
  let parsed: unknown | null = null;
  if (rawText !== '') {
    try {
      parsed = JSON.parse(rawText) as unknown;
    } catch {
      parsed = null;
    }
  }
  return {
    selector: 'script[type="application/ld+json"]',
    rawText,
    parsed,
  };
}

function normalizeJsonLdObjects(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  return isRecord(value) ? [value] : [];
}

function isIncompleteJsonLd(value: unknown): boolean {
  if (value === null) return false;
  if (Array.isArray(value)) {
    return value.length === 0 || value.some((item) => !isRecord(item) || !hasJsonLdIdentity(item));
  }
  return !isRecord(value) || !hasJsonLdIdentity(value);
}

function hasJsonLdIdentity(value: Record<string, unknown>): boolean {
  const context = value['@context'];
  const type = value['@type'];
  const hasContext =
    (typeof context === 'string' && context.trim() !== '') ||
    (isRecord(context) && Object.keys(context).length > 0);
  const hasType =
    (typeof type === 'string' && type.trim() !== '') ||
    (Array.isArray(type) && type.some((item) => typeof item === 'string' && item.trim() !== ''));
  return hasContext && hasType;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
