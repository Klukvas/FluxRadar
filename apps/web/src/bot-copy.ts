// Public crawler page (/bot), kept out of `i18n.ts` for the same reason the FAQ
// and the coverage page are: it is a long technical document, and a wall of
// prose inside the shared translation file makes both harder to edit.
//
// This page is the other half of two messages the product now sends. The
// crawler introduces itself as `FluxRadarBot/0.1 (+https://fluxradar.net/bot)`,
// and a scan that a site refuses tells its owner that the site refused us —
// both of which are useless if the address in them leads nowhere. What an owner
// needs on arrival is: who this is, where it comes from, that it obeys
// robots.txt, and a rule they can paste into their WAF without reading further.
//
// Two inline markers are allowed inside a paragraph or a bullet body:
// `code` renders as <code> and **strong** as <strong>. Anything else is text.

import { SUPPORT_EMAIL } from './brand';

export type BotSectionId = 'who' | 'identify' | 'rules' | 'allow' | 'why-blocked' | 'contact';

/** Anchor and reading order, shared by every locale. */
const SECTION_ORDER: readonly BotSectionId[] = [
  'who',
  'identify',
  'rules',
  'allow',
  'why-blocked',
  'contact',
];

export interface BotBullet {
  readonly term: string;
  readonly body: string;
}

export interface BotSectionText {
  readonly nav: string;
  readonly label: string;
  readonly title: string;
  readonly intro: readonly string[];
  readonly bullets: readonly BotBullet[];
  readonly outro: readonly string[];
  /** Ready-to-paste configuration, rendered verbatim in a <pre> block. */
  readonly snippet?: { readonly caption: string; readonly body: string };
}

export interface BotSection extends BotSectionText {
  readonly id: BotSectionId;
}

export interface BotCopy {
  readonly kicker: string;
  readonly meta: readonly string[];
  readonly title: string;
  readonly lede: string;
  readonly back: string;
  readonly contents: string;
  readonly documentLabel: string;
  readonly noticeLabel: string;
  readonly notice: string;
  readonly noticeTag: string;
  readonly contact: string;
  readonly contactEmail: string;
  readonly footerBrand: string;
  readonly footerHome: string;
  readonly footerPrivacy: string;
  readonly footerTerms: string;
  readonly sections: readonly BotSection[];
}

function botSections(sections: Record<BotSectionId, BotSectionText>): readonly BotSection[] {
  return SECTION_ORDER.map((id) => ({ id, ...sections[id] }));
}

/**
 * The egress address customers are asked to allow.
 *
 * One address, stated once, so the page and the support reply cannot drift
 * apart. It is deliberately the only network fact here: an owner allowlisting a
 * crawler needs the address it arrives from and nothing else about our hosting.
 */
export const CRAWLER_EGRESS_IP = '173.242.53.147';

const CLOUDFLARE_RULE = `(http.user_agent contains "FluxRadarBot" and ip.src eq ${CRAWLER_EGRESS_IP})`;

const ROBOTS_ALLOW = `User-agent: FluxRadarBot
Allow: /`;

const ROBOTS_DISALLOW = `User-agent: FluxRadarBot
Disallow: /`;

export const botCopyEn: BotCopy = {
  kicker: 'FLUXRADAR / CRAWLER',
  meta: ['Updated 2026-09-21', 'No login required to read this', 'FluxRadarBot/0.1'],
  title: 'FluxRadarBot',
  lede: 'The crawler that reads a site when its owner asks FluxRadar to audit it — what it is, where it comes from, and how to let it through or turn it away.',
  back: '← Back to home',
  contents: 'CONTENTS',
  documentLabel: 'Crawler detail',
  noticeLabel: 'READ-ONLY',
  notice:
    'FluxRadarBot only reads public pages, with GET and HEAD requests. It never signs in, never submits a form, never posts, and never asks for credentials.',
  noticeTag: 'GET / HEAD ONLY',
  contact: 'Questions about this crawler, or a site you want it to stop visiting:',
  contactEmail: SUPPORT_EMAIL,
  footerBrand: 'FluxRadar',
  footerHome: 'Home',
  footerPrivacy: 'Privacy policy',
  footerTerms: 'Terms of service',
  sections: botSections({
    who: {
      nav: 'Who we are',
      label: '01',
      title: 'Who FluxRadarBot is',
      intro: [
        'FluxRadar is a web audit service. When the owner of a site asks us to check it, FluxRadarBot fetches that site’s public pages and we report what we found — SEO, accessibility, security headers, privacy signals and the rest.',
        'The crawler visits a site only because someone with access to it asked for a report. It does not roam the web, and it does not build an index or a dataset of anyone’s content.',
      ],
      bullets: [
        {
          term: 'It reads',
          body: 'public HTML, `robots.txt`, `sitemap.xml`, and response headers.',
        },
        {
          term: 'It does not read',
          body: 'anything behind a login, anything a form submission would produce, or any page your `robots.txt` disallows.',
        },
        {
          term: 'It does not keep your pages',
          body: 'beyond the audit they were fetched for. What a report stores is the evidence behind each finding, not a copy of the site.',
        },
      ],
      outro: [],
    },
    identify: {
      nav: 'How to identify it',
      label: '02',
      title: 'How to identify it in your logs',
      intro: [
        'Every request carries this user agent. A mobile audit appends ` Mobile` to it; the `FluxRadarBot` token stays first either way, so one rule matches both.',
      ],
      bullets: [
        {
          term: 'User agent',
          body: '`FluxRadarBot/0.1 (+https://fluxradar.net/bot)`',
        },
        {
          term: 'Source address',
          body: `\`${CRAWLER_EGRESS_IP}\` — every request, for every customer.`,
        },
        { term: 'Methods', body: '`GET` and `HEAD`. Nothing else.' },
      ],
      outro: [
        'Anything claiming to be FluxRadarBot from another address is not us. If you see one, the address above is the only one we use, and we would like to know about the other.',
      ],
    },
    rules: {
      nav: 'What it respects',
      label: '03',
      title: 'What it respects',
      intro: [],
      bullets: [
        {
          term: 'robots.txt',
          body: 'Always. A `Disallow` that applies to `FluxRadarBot` or to `*` keeps us off that path, and the report says which addresses were skipped for that reason instead of counting them as missing.',
        },
        {
          term: 'Your rate',
          body: 'Requests to one host are spaced out, and we stop crawling a host entirely after five consecutive server errors rather than adding to the problem.',
        },
        {
          term: 'Your page limit',
          body: 'An audit reads at most the number of pages its plan covers, and the report states how many of the addresses it found were read.',
        },
      ],
      outro: [
        'The one exception to robots.txt is an override a site owner confirms for their own site, in writing, inside their FluxRadar account. Every such crawl is logged.',
      ],
    },
    allow: {
      nav: 'Letting it through',
      label: '04',
      title: 'Letting it through',
      intro: [
        'If your site sits behind Cloudflare, a WAF or a bot-protection layer, it may be refusing us before your server ever sees the request. Below is the rule to allow.',
      ],
      bullets: [],
      outro: [
        'On other providers, allow the same two things: the user-agent token `FluxRadarBot` and the source address above. Allowing the address alone is enough, and is the stricter of the two.',
      ],
      snippet: {
        caption: 'Cloudflare — WAF custom rule, action: Skip (or Allow)',
        body: CLOUDFLARE_RULE,
      },
    },
    'why-blocked': {
      nav: 'Turning it away',
      label: '05',
      title: 'Turning it away',
      intro: [
        'You are not obliged to let us in. Two lines in your `robots.txt` stop us at every path, and we will not argue with them — a scan of a site that has disallowed us reports that, and is refunded.',
      ],
      bullets: [],
      outro: ['To allow it again, replace `Disallow` with `Allow`:'],
      snippet: { caption: 'robots.txt — to keep us out', body: ROBOTS_DISALLOW },
    },
    contact: {
      nav: 'Contact',
      label: '06',
      title: 'Contact',
      intro: [
        'If FluxRadarBot has caused a problem on your site, write to us and we will stop crawling it while we look into it.',
      ],
      bullets: [],
      outro: [],
      snippet: { caption: 'robots.txt — to let us in again', body: ROBOTS_ALLOW },
    },
  }),
};

export const botCopyUk: BotCopy = {
  kicker: 'FLUXRADAR / КРАУЛЕР',
  meta: ['Оновлено 2026-09-21', 'Читати можна без входу', 'FluxRadarBot/0.1'],
  title: 'FluxRadarBot',
  lede: 'Краулер, який читає сайт, коли його власник просить FluxRadar зробити аудит — що це, звідки він приходить і як його пропустити або не пускати.',
  back: '← На головну',
  contents: 'ЗМІСТ',
  documentLabel: 'Деталі про краулер',
  noticeLabel: 'ТІЛЬКИ ЧИТАННЯ',
  notice:
    'FluxRadarBot читає лише публічні сторінки запитами GET і HEAD. Він ніколи не входить в акаунт, не надсилає форми, нічого не публікує і не просить облікових даних.',
  noticeTag: 'ЛИШЕ GET / HEAD',
  contact: 'Питання про краулер або сайт, який він має перестати відвідувати:',
  contactEmail: SUPPORT_EMAIL,
  footerBrand: 'FluxRadar',
  footerHome: 'Головна',
  footerPrivacy: 'Політика приватності',
  footerTerms: 'Умови обслуговування',
  sections: botSections({
    who: {
      nav: 'Хто ми',
      label: '01',
      title: 'Хто такий FluxRadarBot',
      intro: [
        'FluxRadar — сервіс аудиту сайтів. Коли власник сайту просить нас його перевірити, FluxRadarBot завантажує публічні сторінки цього сайту, і ми звітуємо про знайдене — SEO, доступність, заголовки безпеки, сигнали приватності та решту.',
        'Краулер приходить на сайт лише тому, що хтось із доступом до нього попросив звіт. Він не ходить вебом просто так і не будує індекс чи набір даних із чийогось контенту.',
      ],
      bullets: [
        {
          term: 'Він читає',
          body: 'публічний HTML, `robots.txt`, `sitemap.xml` і заголовки відповідей.',
        },
        {
          term: 'Він не читає',
          body: 'нічого за входом, нічого, що з’явилося б після надсилання форми, і жодної сторінки, яку забороняє ваш `robots.txt`.',
        },
        {
          term: 'Він не зберігає ваші сторінки',
          body: 'довше, ніж потрібно для аудиту, заради якого їх завантажено. Звіт зберігає докази до кожної знахідки, а не копію сайту.',
        },
      ],
      outro: [],
    },
    identify: {
      nav: 'Як розпізнати',
      label: '02',
      title: 'Як розпізнати його в логах',
      intro: [
        'Кожен запит несе цей user agent. Мобільний аудит додає до нього ` Mobile`; токен `FluxRadarBot` у будь-якому разі стоїть першим, тож одне правило покриває обидва випадки.',
      ],
      bullets: [
        { term: 'User agent', body: '`FluxRadarBot/0.1 (+https://fluxradar.net/bot)`' },
        {
          term: 'Адреса джерела',
          body: `\`${CRAWLER_EGRESS_IP}\` — кожен запит, для кожного клієнта.`,
        },
        { term: 'Методи', body: '`GET` і `HEAD`. Більше нічого.' },
      ],
      outro: [
        'Усе, що видає себе за FluxRadarBot з іншої адреси, — не ми. Якщо побачите таке: адреса вище єдина, яку ми використовуємо, і ми хотіли б знати про іншу.',
      ],
    },
    rules: {
      nav: 'Що він поважає',
      label: '03',
      title: 'Що він поважає',
      intro: [],
      bullets: [
        {
          term: 'robots.txt',
          body: 'Завжди. `Disallow`, що стосується `FluxRadarBot` або `*`, тримає нас поза цим шляхом, і звіт каже, які адреси пропущено з цієї причини, замість того щоб рахувати їх як недоглянуті.',
        },
        {
          term: 'Ваш темп',
          body: 'Запити до одного хоста рознесені в часі, а після п’яти поспіль серверних помилок ми зупиняємо обхід хоста зовсім, замість додавати проблем.',
        },
        {
          term: 'Ваш ліміт сторінок',
          body: 'Аудит читає щонайбільше стільки сторінок, скільки охоплює його тариф, і звіт каже, скільки зі знайдених адрес прочитано.',
        },
      ],
      outro: [
        'Єдиний виняток із robots.txt — override, який власник сайту підтверджує для власного сайту, письмово, у своєму акаунті FluxRadar. Кожен такий обхід логується.',
      ],
    },
    allow: {
      nav: 'Як пропустити',
      label: '04',
      title: 'Як пропустити',
      intro: [
        'Якщо ваш сайт стоїть за Cloudflare, WAF чи іншим захистом від ботів, він може відмовляти нам ще до того, як запит побачить ваш сервер. Нижче — правило, яке це вирішує.',
      ],
      bullets: [],
      outro: [
        'В інших провайдерів дозвольте те саме: токен user-agent `FluxRadarBot` і адресу джерела вище. Дозволити саму лише адресу достатньо — і це суворіший із двох варіантів.',
      ],
      snippet: {
        caption: 'Cloudflare — WAF custom rule, дія: Skip (або Allow)',
        body: CLOUDFLARE_RULE,
      },
    },
    'why-blocked': {
      nav: 'Як не пускати',
      label: '05',
      title: 'Як не пускати',
      intro: [
        'Ви не зобов’язані нас пускати. Два рядки у вашому `robots.txt` зупиняють нас на кожному шляху, і ми з ними не сперечаємось — перевірка сайту, який нас заборонив, так і повідомляє, і кошти повертаються.',
      ],
      bullets: [],
      outro: ['Щоб дозволити знову, замініть `Disallow` на `Allow`:'],
      snippet: { caption: 'robots.txt — щоб нас не пускати', body: ROBOTS_DISALLOW },
    },
    contact: {
      nav: 'Контакт',
      label: '06',
      title: 'Контакт',
      intro: [
        'Якщо FluxRadarBot створив проблему на вашому сайті, напишіть нам — ми припинимо обхід, поки розбираємось.',
      ],
      bullets: [],
      outro: [],
      snippet: { caption: 'robots.txt — щоб пустити знову', body: ROBOTS_ALLOW },
    },
  }),
};
