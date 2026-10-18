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
};
