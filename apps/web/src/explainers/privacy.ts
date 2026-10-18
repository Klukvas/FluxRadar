// Privacy: what a page stores in, and loads into, the visitor’s browser.

import { type ExplainedRule } from './types';

export const PRIVACY_EXPLAINERS: Readonly<Record<string, ExplainedRule>> = {
  'PRIVACY-001': {
    countsPages: true,
    en: {
      title: 'Pages that set cookies',
      what: 'These pages store cookies in the visitor’s browser. The finding lists their names; their values are not recorded.',
      why: 'Privacy rules in many places expect a site to explain the cookies it uses and to ask before setting the ones that are not strictly needed. This is an inventory to check, not a sign that something is wrong.',
      fix: 'Check that each cookie named in the technical details is needed and described in your privacy policy and — where the rules that apply to your visitors require it — that the ones not strictly needed wait for the visitor’s consent. Your website developer can tell you what sets each one.',
      count: 'One finding for each page that sets at least one cookie.',
    },
    uk: {
      title: 'Сторінки, що встановлюють cookie',
      what: 'Ці сторінки зберігають cookie в браузері відвідувача. Знахідка перелічує їхні назви; значення не записуються.',
      why: 'Правила приватності в багатьох країнах очікують, що сайт пояснює, які cookie використовує, і питає згоди перед тими, що не є суто необхідними. Це перелік для перевірки, а не ознака, що щось не так.',
      fix: 'Перевірте, що кожна cookie з технічних деталей потрібна й описана у вашій політиці конфіденційності, а там, де цього вимагають правила для ваших відвідувачів, — що не суто необхідні чекають на згоду відвідувача. Розробник може підказати, що встановлює кожну з них.',
      count: 'Одна знахідка на кожну сторінку, що встановлює хоча б одну cookie.',
    },
  },
  // A static signal only (privacy-002-consent.ts): a known tracker in the page
  // code and no sign of a consent tool in it. A banner a script adds later is
  // not seen, and the copy makes no legal finding.
  'PRIVACY-002': {
    countsPages: true,
    en: {
      title: 'Tracking that may start before visitors agree',
      what: 'These pages load a known tracking or analytics service, such as Google Analytics, the Facebook pixel or Hotjar, and their code shows no sign of a cookie or consent banner. Only the page code FluxRadar received is read, so a banner that appears later may not be seen.',
      why: 'Privacy rules in many places expect a site to ask before tracking visitors with tools that are not strictly needed. This is a sign to check, not a finding that a rule has been broken.',
      fix: 'Check whether your site shows a consent banner and whether tracking waits for the visitor’s choice; many site builders have a cookie banner setting. Your website developer can check whether the tracking starts before the visitor agrees.',
      count: 'One finding for each page.',
    },
    uk: {
      title: 'Відстеження, що може починатися до згоди відвідувача',
      what: 'Ці сторінки завантажують відомий сервіс відстеження чи аналітики, як-от Google Analytics, піксель Facebook чи Hotjar, а в їхньому коді немає ознак банера про cookie чи згоду. Читається лише код сторінки, який отримав FluxRadar, тож банер, що зʼявляється пізніше, може лишитися непоміченим.',
      why: 'Правила приватності в багатьох країнах очікують, що сайт питає згоди, перш ніж відстежувати відвідувачів інструментами, які не є суто необхідними. Це ознака для перевірки, а не висновок, що якесь правило порушено.',
      fix: 'Перевірте, чи показує ваш сайт банер згоди й чи чекає відстеження на вибір відвідувача; у багатьох конструкторах сайтів є налаштування банера cookie. Розробник може перевірити, чи не починається відстеження до згоди.',
      count: 'Одна знахідка на кожну сторінку.',
    },
  },
  'PRIVACY-003': {
    countsPages: true,
    en: {
      title: 'Pages that load code from other companies',
      what: 'These pages load scripts from other websites’ addresses, such as an analytics service, a chat widget or an online booking form. The finding lists those addresses.',
      why: 'Each such script runs in your visitors’ browsers, and the company behind it may receive information about them, so it is worth knowing which ones you use and why. This is an inventory to check, not a sign that something is wrong.',
      fix: 'Check that each address named in the technical details belongs to a service you still use and mention in your privacy policy, and remove the ones you no longer need. Your website developer can tell you what each one is.',
      count: 'One finding for each page that loads at least one such script.',
    },
    uk: {
      title: 'Сторінки, що завантажують код інших компаній',
      what: 'Ці сторінки завантажують скрипти з адрес інших сайтів, як-от сервісу аналітики, віджета чату чи форми онлайн-запису. Знахідка перелічує ці адреси.',
      why: 'Кожен такий скрипт працює в браузері ваших відвідувачів, і компанія, що за ним стоїть, може отримувати відомості про них, тож варто знати, які з них ви використовуєте й навіщо. Це перелік для перевірки, а не ознака, що щось не так.',
      fix: 'Перевірте, що кожна адреса з технічних деталей належить сервісу, яким ви досі користуєтеся і який згадано у вашій політиці конфіденційності, і приберіть ті, що більше не потрібні. Розробник може підказати, що стоїть за кожною з них.',
      count: 'Одна знахідка на кожну сторінку, що завантажує хоча б один такий скрипт.',
    },
  },
  // A link-presence check on the home page only (privacy-004-policy.ts), not a
  // judgement of what the policy says.
  'PRIVACY-004': {
    countsPages: false,
    en: {
      title: 'No privacy policy link on the home page',
      what: 'The home page has no link to a page of your own site whose link text or address mentions privacy or cookies. Only the home page is checked, and only whether such a link is there, not what the policy says.',
      why: 'Privacy rules in many places expect visitors to be able to find out how their data is used, and a link from the home page, usually in the footer, is where people look for it.',
      fix: 'Add a link to your privacy policy to the site’s footer, so it appears on the home page too; most site builders have a footer or legal pages setting. If you have no policy yet, what it must say depends on the rules that apply to your business.',
      count: 'One finding for the whole site, about its home page.',
    },
    uk: {
      title: 'На головній немає посилання на політику конфіденційності',
      what: 'Головна сторінка не має посилання на сторінку вашого ж сайту, у тексті посилання чи адресі якої згадано приватність або cookie. Перевіряється лише головна сторінка й лише те, чи є таке посилання, а не що написано в політиці.',
      why: 'Правила приватності в багатьох країнах очікують, що відвідувач може дізнатися, як використовуються його дані, а посилання з головної, зазвичай у підвалі сайту, — саме там, де його шукають.',
      fix: 'Додайте посилання на політику конфіденційності в підвал сайту, щоб воно було й на головній; у більшості конструкторів сайтів є налаштування підвалу чи юридичних сторінок. Якщо політики ще немає, її зміст залежить від правил, що стосуються вашого бізнесу.',
      count: 'Одна знахідка на весь сайт, про його головну сторінку.',
    },
  },
};
