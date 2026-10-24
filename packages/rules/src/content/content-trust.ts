import { parseHtml, type PageSnapshot } from '@fluxradar/crawler';

import { requireDescriptor } from '../engine/descriptor.js';
import { pageFinding } from '../engine/finding.js';
import type {
  PageRule,
  RuleFinding,
  SiteContext,
  SiteRule,
  SiteRuleResult,
} from '../engine/types.js';
import { findingMessage } from '../messages/index.js';
import { metaContent, parsePage } from '../seo/dom.js';
import {
  isMedical,
  localFacts,
  observationScope,
  readable,
  record,
  primarySchemaNodes,
  referenceId,
  resolveObject,
  schemaNodes,
  strings,
  types,
  type JsonObject,
  type LocalPageFacts,
} from '../shared/local-business.js';

const articleDescriptor = requireDescriptor('CONTENT-008');
const medicalDescriptor = requireDescriptor('CONTENT-012');
const ARTICLE_TYPES = new Set([
  'Article',
  'BlogPosting',
  'NewsArticle',
  'ScholarlyArticle',
  'MedicalScholarlyArticle',
  'TechArticle',
]);
const MEDICAL_HEADING =
  /(?:\b(?:dental clinic|medical clinic|dental practice|dentist|hospital)\b|стоматологічн[а-яіїєґ]*\s+клінік|медичн[а-яіїєґ]*\s+(?:центр|клінік)|стоматологическ[а-я]*\s+клиник)/iu;
const DOCTOR = /(?:\b(?:doctor|dentist|physician|surgeon|dr\.)\b|лікар|стоматолог|врач|хірург)/iu;
const QUALIFICATION =
  /(?:\b(?:qualification|degree|education|board.certified|md|phd|dds|dmd)\b|освіта|кваліфікац|диплом|сертифікат|образован)/iu;

type ArticleFacts = {
  readonly article: boolean;
  readonly attribution: boolean;
  readonly published: boolean;
  readonly updated: boolean;
};
const articleCache = new WeakMap<PageSnapshot, ArticleFacts>();

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && Number.isFinite(Date.parse(value));
}

function displayedDate(value: string): boolean {
  if (validDate(value)) return true;
  const numeric = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  if (numeric !== null) return validDate(`${numeric[3]}-${numeric[2]}-${numeric[1]}`);
  return /^\d{1,2}\s+[A-Za-z]+\s+\d{4}$/.test(value.trim()) && Number.isFinite(Date.parse(value));
}

function currentPageArticle(node: JsonObject, page: PageSnapshot): boolean {
  const identity = strings(node['url'])[0] ?? strings(node['@id'])[0];
  if (identity === undefined) return true;
  const resolved = referenceId(identity, page);
  if (resolved === null) return false;
  const target = new URL(resolved);
  const current = new URL(page.finalUrl);
  return target.origin === current.origin && target.pathname === current.pathname;
}

function publishedTime(element: import('node-html-parser').HTMLElement): boolean {
  const marker = `${element.getAttribute('class') ?? ''} ${element.getAttribute('itemprop') ?? ''} ${element.parentNode?.text ?? ''}`;
  if (
    /(?:updated|modified|оновлено|оновлення|обновлено|dateModified)/iu.test(marker) &&
    !/(?:published|publication|опубліковано|публікація)/iu.test(marker)
  )
    return false;
  return displayedDate(
    element.getAttribute('datetime') ?? element.getAttribute('content') ?? element.text.trim(),
  );
}

function attribution(value: unknown, nodes: readonly JsonObject[], page: PageSnapshot): boolean {
  if (Array.isArray(value)) return value.some((item) => attribution(item, nodes, page));
  if (typeof value === 'string') return value.trim().length > 1;
  const person = resolveObject(value, nodes, page);
  return person !== null && strings(person['name']).length > 0;
}

function articleFacts(page: PageSnapshot): ArticleFacts {
  const cached = articleCache.get(page);
  if (cached !== undefined) return cached;
  const root = parsePage(page);
  const nodes = schemaNodes(page);
  const articles = primarySchemaNodes(page).filter(
    (node) => types(node).some((type) => ARTICLE_TYPES.has(type)) && currentPageArticle(node, page),
  );
  const primaryDomArticles = root
    .querySelectorAll('article')
    .filter(
      (element) =>
        element.closest('aside, nav, footer, header') === null &&
        element.parentNode?.closest('article') == null,
    );
  const primaryArticle =
    primaryDomArticles.find((element) => element.querySelector('h1') !== null) ??
    (primaryDomArticles.length === 1 ? primaryDomArticles[0] : undefined);
  const source = primaryArticle ?? root.querySelector('main');
  // Work on a detached copy: DOM parsing is shared with the other rules.
  const articleBody = source === null || source === undefined ? null : parseHtml(source.outerHTML);
  articleBody
    ?.querySelectorAll(
      primaryArticle === undefined
        ? 'aside, nav, footer, article'
        : 'aside, nav, footer, article article',
    )
    .forEach((element) => element.remove());
  const labeled = articleBody?.querySelectorAll('p, li, dd') ?? [];
  const meta = (name: string): string =>
    root.querySelector(`meta[property="${name}"]`)?.getAttribute('content') ??
    metaContent(root, name) ??
    '';
  const visibleAuthor =
    labeled.some((element) =>
      /^(?:by|author|автор|авторка)\s*[:—-]?\s+[\p{L}][\p{L}.\s-]{2,80}$/iu.test(
        element.text.trim(),
      ),
    ) ||
    (articleBody
      ?.querySelectorAll(
        '[rel="author"], [itemprop="author"], [itemprop="reviewedBy"], .author, .reviewer, .medical-reviewer',
      )
      .some((element) => element.text.trim().length > 1) ??
      false) ||
    /(?:medically reviewed by|медичн[а-яіїєґ]*\s+рецензент|медичн[а-яіїєґ]*\s+перевір(?:ив|ила)|перевірено лікарем)\s*[:—-]?\s*[\p{L}][\p{L}.\s-]{2,60}/iu.test(
      articleBody?.text ?? '',
    );
  const hasAuthor =
    articles.some(
      (node) =>
        attribution(node['author'], nodes, page) || attribution(node['reviewedBy'], nodes, page),
    ) ||
    [meta('author'), meta('article:author')].some((value) => value.trim() !== '') ||
    visibleAuthor;
  const schemaDate = (field: string): boolean =>
    articles.some((node) => strings(node[field]).some(validDate));
  const hasPublicationLabel = labeled.some((element) => {
    const date =
      /^(?:published(?:\s+on)?|publication date|опубліковано|дата публікації)\s*[:—-]?\s*(.+)$/iu.exec(
        element.text.trim(),
      )?.[1];
    return date !== undefined && displayedDate(date.trim());
  });
  const primaryDomArticle =
    primaryDomArticles.length === 1 &&
    primaryArticle?.querySelector('h1') != null &&
    (visibleAuthor || hasPublicationLabel);
  // CMS templates often publish og:type=article on every page. Strong primary
  // Article markup still wins; a contact/profile/list surface is not a post
  // merely because that generic sharing hint is present.
  const nonArticleTypes = new Set([
    'ContactPage',
    'AboutPage',
    'ProfilePage',
    'CollectionPage',
    'Service',
  ]);
  const explicitNonArticle = primarySchemaNodes(page).some(
    (node) =>
      currentPageArticle(node, page) && types(node).some((type) => nonArticleTypes.has(type)),
  );
  const path = new URL(page.finalUrl).pathname;
  const nonArticlePath =
    /^\/(?:(?:uk|ru|en)\/)?(?:contacts?|kontakty|about(?:-[a-z]{2})?|pro-nas|o-nas|doctors?|likari|team|services?)(?:\/|$)/iu.test(
      path,
    ) || /^\/(?:(?:uk|ru|en)\/)?(?:blog|statti|articles|news)\/?$/iu.test(path);
  const nonArticleHeading =
    /^(?:контакти|контакты|contacts?(?: us)?|про нас|о нас|about(?: us)?|лікарі|врачи|our doctors|doctors|статті|статьи|articles|blog|блог|команда)(?:$|[\s:—-])/iu.test(
      root.querySelector('h1')?.text.trim() ?? '',
    );
  const nonArticleSurface = explicitNonArticle || nonArticlePath || nonArticleHeading;
  const article =
    articles.length > 0 ||
    primaryDomArticle ||
    (!nonArticleSurface && meta('og:type').toLowerCase() === 'article');
  const dates = (selector: string): boolean =>
    (articleBody?.querySelectorAll(selector) ?? []).some((element) =>
      displayedDate(
        element.getAttribute('datetime') ?? element.getAttribute('content') ?? element.text.trim(),
      ),
    );
  const result = {
    article,
    attribution: hasAuthor,
    published:
      schemaDate('datePublished') ||
      [meta('article:published_time'), meta('datePublished'), meta('date')].some(validDate) ||
      (
        articleBody?.querySelectorAll(
          'time:not([itemprop="dateModified"]):not(.updated), [itemprop="datePublished"]',
        ) ?? []
      ).some(publishedTime) ||
      hasPublicationLabel,
    updated:
      schemaDate('dateModified') ||
      [meta('article:modified_time'), meta('dateModified'), meta('last-modified')].some(
        validDate,
      ) ||
      dates('[itemprop="dateModified"], article time.updated, article time[pubdate="modified"]'),
  };
  articleCache.set(page, result);
  return result;
}

export const content008ArticleTransparency: PageRule = {
  kind: 'page',
  descriptor: articleDescriptor,
  isApplicable: (page) => readable(page) && articleFacts(page).article,
  evaluatePage(page): readonly RuleFinding[] {
    const facts = articleFacts(page);
    const checks = [
      { missing: !facts.attribution, code: 'content-008.evidence.attribution' },
      { missing: !facts.published, code: 'content-008.evidence.published' },
    ] as const;
    return checks
      .filter((check) => check.missing)
      .map((check) =>
        pageFinding(articleDescriptor, page, {
          evidenceType: 'dom',
          evidence: findingMessage(check.code, {}),
          recommendation: findingMessage('content-008.recommendation', {}),
          parameter: check.code,
          confidence: 0.9,
        }),
      );
  },
};

function medicalBusiness(facts: LocalPageFacts): boolean {
  return (
    facts.businesses.some(isMedical) ||
    (facts.visibleLocal && MEDICAL_HEADING.test(facts.root.querySelector('h1')?.text ?? ''))
  );
}

function doctorProfile(facts: LocalPageFacts): boolean {
  return (
    facts.nodes.some(
      (node) =>
        (types(node).includes('Person') || types(node).includes('Physician')) &&
        strings(node['name']).length > 0 &&
        (types(node).includes('Physician') ||
          DOCTOR.test(strings(node['jobTitle']).join(' ')) ||
          strings(node['medicalSpecialty']).length > 0),
    ) ||
    (/\/(?:doctors?|likari|лікарі|team)\/.+/iu.test(new URL(facts.page.finalUrl).pathname) &&
      (facts.root.querySelector('h1')?.text.trim().length ?? 0) > 2 &&
      facts.root
        .querySelectorAll('p, [itemprop="jobTitle"]')
        .some((element) => DOCTOR.test(element.text)) &&
      facts.text.length >= 100)
  );
}

function presentQualification(node: JsonObject): boolean {
  return ['hasCredential', 'alumniOf', 'hasCertification'].some(
    (field) =>
      strings(node[field]).length > 0 ||
      record(node[field]) ||
      (Array.isArray(node[field]) && node[field].length > 0),
  );
}

export const content012MedicalTransparency: SiteRule = {
  kind: 'site',
  descriptor: medicalDescriptor,
  evaluateSite(ctx: SiteContext): SiteRuleResult {
    const crawl = localFacts(ctx);
    const businesses = crawl.pages.filter(medicalBusiness);
    if (businesses.length === 0 || !crawl.complete)
      return {
        findings: [],
        applicableTargets: 0,
        affectedTargets: 0,
        checkedTargets: [],
        notApplicableReason: 'no-candidates',
      };
    const profiles = crawl.pages.filter(doctorProfile);
    const observed = {
      profiles: Number(profiles.length > 0),
      qualifications: Number(
        profiles.some(
          (facts) => QUALIFICATION.test(facts.text) || facts.nodes.some(presentQualification),
        ),
      ),
      about: Number(
        crawl.pages.some(
          (facts) =>
            facts.nodes.some((node) => types(node).includes('AboutPage')) ||
            /(?:\babout\b|про\s+(?:нас|клініку|заклад)|о\s+клинике)/iu.test(
              facts.root.querySelector('h1')?.text ?? '',
            ),
        ),
      ),
      contact: Number(crawl.pages.some((facts) => facts.contact && facts.visibleLocal)),
      license: Number(
        crawl.pages.some(
          (facts) =>
            /(?:licen[cs]e|ліцензі[яїю]|лицензи[яию])[\s\S]{0,100}\d{3,}/iu.test(facts.text) ||
            facts.root
              .querySelectorAll('a[href]')
              .some(
                (anchor) =>
                  /(?:licen[cs]e|ліцензі|лицензи)/iu.test(anchor.text) &&
                  (anchor.getAttribute('href') ?? '').trim() !== '',
              ),
        ),
      ),
    };
    const page = businesses[0]?.page;
    const checks = [
      { present: observed.profiles, code: 'content-012.evidence.profiles' },
      { present: observed.qualifications, code: 'content-012.evidence.qualifications' },
      { present: observed.about, code: 'content-012.evidence.about' },
      { present: observed.contact, code: 'content-012.evidence.contact' },
      { present: observed.license, code: 'content-012.evidence.license' },
    ] as const;
    const findings =
      page === undefined
        ? []
        : checks
            .filter((check) => check.present === 0)
            .map((check) =>
              pageFinding(medicalDescriptor, page, {
                evidenceType: 'dom',
                evidence: findingMessage(check.code, {}),
                recommendation: findingMessage('content-012.recommendation', {}),
                parameter: check.code,
                dependencyTargets: crawl.pages.map((facts) => facts.page.normalizedUrl),
                confidence: 0.8,
              }),
            );
    return {
      findings,
      applicableTargets: 1,
      affectedTargets: Number(findings.length > 0),
      ...observationScope(ctx),
    };
  },
};
