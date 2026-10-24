import type { FindingMessageCatalog } from './catalog.js';

export const LOCAL_TRUST_MESSAGES = {
  'seo-adv-001.evidence.address': {
    en: 'No physical address was recognized in the contact markup checked on this readable local page.',
    uk: 'У перевіреній розмітці контактів цієї прочитаної локальної сторінки не розпізнано фізичної адреси.',
  },
  'seo-adv-001.evidence.telephone': {
    en: 'No telephone was observed on this readable local contact page.',
    uk: 'На цій прочитаній локальній сторінці контактів не помічено телефону.',
  },
  'seo-adv-001.evidence.hours': {
    en: 'No opening hours were recognized in the contact markup checked on this readable local page.',
    uk: 'У перевіреній розмітці контактів цієї прочитаної локальної сторінки не розпізнано годин роботи.',
  },
  'seo-adv-001.evidence.clickable': {
    en: 'A telephone is displayed on this local contact page without an observed tel: link.',
    uk: 'На цій локальній сторінці контактів є телефон, але не помічено посилання tel:.',
  },
  'seo-adv-001.recommendation.contact': {
    en: 'Make the physical address, opening hours and telephone easy to find on the contact page and footer, and link displayed phone numbers with tel:. Keep contact facts consistent with markup for the same location; preserve valid alternative phones and separate branch contacts.',
    uk: 'Зробіть фізичну адресу, години роботи й телефон помітними на сторінці контактів та у футері; додайте tel: до видимих номерів. Узгодьте дані з розміткою тієї самої локації; збережіть додаткові телефони та окремі контакти філій.',
  },
  'seo-adv-001.evidence.difference': {
    en: 'Different observed {field} values for the explicitly identified entity {entity}: {first} versus {second}. Source: {source}. Confirm whether both remain valid before changing contact data.',
    uk: 'Різні спостережені значення {field} для явно визначеної сутності {entity}: {first} та {second}. Джерело: {source}. Перш ніж змінювати контакти, перевірте, чи обидва значення досі чинні.',
  },
  'seo-adv-001.recommendation.difference': {
    en: 'Review these same-entity contact observations across schema, contact page and footer. Correct stale values, or clearly label branches, translated names, phone extensions and alternative contact numbers. Different valid contacts are not inherently an error.',
    uk: 'Звірте ці контакти однієї сутності в schema, на сторінці контактів і у футері. Виправте застарілі дані або чітко позначте філії, переклади назв, додаткові та внутрішні номери. Різні чинні контакти самі по собі не є помилкою.',
  },
  'seo-struct-003.evidence.missing': {
    en: 'A physical address and telephone are visible, but no LocalBusiness or recognized subtype was observed in readable page JSON-LD. This is a markup opportunity, not proof of a search eligibility problem.',
    uk: 'Видно фізичну адресу й телефон, але в прочитаному JSON-LD сторінки не помічено LocalBusiness або відомого підтипу. Це можливість доповнити розмітку, а не доказ проблеми з показом у пошуку.',
  },
  'seo-struct-003.evidence.fields': {
    en: 'Local entity {entity}, types {types}. Missing required local-business fields: {required}. Missing recommended fields: {recommended}. Only observed markup was inspected.',
    uk: 'Локальна сутність {entity}, типи {types}. Бракує обов’язкових полів local business: {required}. Бракує рекомендованих полів: {recommended}. Перевірено лише помічену розмітку.',
  },
  'seo-struct-003.recommendation': {
    en: 'Describe the visible business with the most specific applicable Schema.org type (for example Dentist for a dental practice; MedicalBusiness for an applicable medical business). For Google local-business markup, name and a physical PostalAddress are required; telephone, openingHoursSpecification/openingHours and geo are recommended. Include accurate street/locality and applicable address details. Use valid coordinates and local opening times, including overnight hours. Do not invent data or promise rich results.',
    uk: 'Опишіть видимий бізнес найточнішим доречним типом Schema.org (наприклад Dentist для стоматологічної практики; MedicalBusiness для відповідного медичного бізнесу). Для local business розмітки Google потрібні name і фізична PostalAddress; telephone, openingHoursSpecification/openingHours та geo рекомендовані. Вкажіть достовірні вулицю, місто й доречні деталі адреси, координати та місцевий час роботи, зокрема нічні години. Не вигадуйте даних і не обіцяйте розширених результатів.',
  },
  'seo-struct-004.evidence': {
    en: 'Same-site LocalBusiness entity {entity} carries review or aggregateRating. If this is the business’s own site, self-serving LocalBusiness/Organization reviews are ineligible for Google review stars, including third-party widgets. Same-host markup alone does not prove ownership. Missing ratings never fail.',
    uk: 'Сутність LocalBusiness {entity} із цього хоста має review або aggregateRating. Якщо це власний сайт бізнесу, власні відгуки LocalBusiness/Organization не дають права на зірочки Google, зокрема й через сторонні віджети. Сам хост не доводить володіння сайтом. Відсутність рейтингу не є помилкою.',
  },
  'seo-struct-004.recommendation': {
    en: 'Keep genuine, visible reviews for visitors, but do not add or change clinic AggregateRating to obtain Google stars. Review Google review-snippet eligibility separately from markup validity; never fabricate ratings.',
    uk: 'Зберігайте справжні видимі відгуки для відвідувачів, але не додавайте й не змінюйте AggregateRating клініки заради зірочок Google. Відокремлюйте право на review snippet від коректності розмітки; не вигадуйте рейтингів.',
  },
  'content-008.evidence.attribution': {
    en: 'No named author or medical reviewer was observed in this readable article.',
    uk: 'У цій прочитаній статті не помічено імені автора або медичного рецензента.',
  },
  'content-008.evidence.published': {
    en: 'No publication date was observed in this readable article. A modification date alone does not identify when it was first published.',
    uk: 'У цій прочитаній статті не помічено дати публікації. Сама дата зміни не пояснює, коли статтю опубліковано вперше.',
  },
  'content-008.recommendation': {
    en: 'Identify the article author OR a medical reviewer, with a profile describing relevant qualifications. Display truthful publication and, when updated, modification dates consistently with Article markup. Do not invent a review or change dates without a substantive update. These are transparency observations, not a Google trust or ranking score.',
    uk: 'Вкажіть автора статті АБО медичного рецензента з профілем і описом доречної кваліфікації. Показуйте правдиві дати публікації та, після оновлення, зміни; узгодьте їх із Article. Не вигадуйте рецензування й не змінюйте дату без змістовного оновлення. Це спостереження прозорості, а не оцінка довіри Google чи позицій.',
  },
  'content-012.evidence.profiles': {
    en: 'No doctor profiles were observed in the readable medical-business crawl.',
    uk: 'У прочитаному обході медичного закладу не помічено профілів лікарів.',
  },
  'content-012.evidence.qualifications': {
    en: 'No qualification descriptions were observed for doctor profiles in this crawl. This does not verify or disprove their qualifications.',
    uk: 'В обході не помічено описів кваліфікації у профілях лікарів. Це не підтверджує й не спростовує їхню кваліфікацію.',
  },
  'content-012.evidence.about': {
    en: 'No about information was observed in the readable medical-business crawl.',
    uk: 'У прочитаному обході медичного закладу не помічено інформації про заклад.',
  },
  'content-012.evidence.contact': {
    en: 'No contact page with a physical address and telephone was observed in this readable medical-business crawl.',
    uk: 'У прочитаному обході медичного закладу не помічено сторінки контактів із фізичною адресою й телефоном.',
  },
  'content-012.evidence.license': {
    en: 'No license information was observed in this crawl. This does not establish that a license is absent or invalid.',
    uk: 'У цьому обході не помічено інформації про ліцензію. Це не доводить, що ліцензії немає або вона недійсна.',
  },
  'content-012.recommendation': {
    en: 'Make doctor profiles, relevant qualifications, about/contact details and applicable license information accessible to visitors. Check accuracy with the business and relevant registers manually. This check only records on-site evidence; it does not verify credentials, legal compliance, Google trust, rankings or GEO improvements.',
    uk: 'Зробіть профілі лікарів, доречну кваліфікацію, інформацію про заклад, контакти та відповідні ліцензійні дані доступними відвідувачам. Перевірте достовірність із закладом і потрібними реєстрами вручну. Перевірка лише фіксує дані сайту: не підтверджує кваліфікацію, законність, довіру Google, позиції чи покращення GEO.',
  },
} as const satisfies FindingMessageCatalog;
