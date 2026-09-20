import { useEffect, type JSX } from 'react';

import type { Language } from '../i18n';
import { EffectiveNotice, OperatorDetails, SupportLink } from './SharedLegal';

export function TermsOfService({ language }: { readonly language: Language }): JSX.Element {
  // The footer's refund link points straight at the purchases section, and the
  // browser looks for that anchor before this document has rendered. The jump
  // the link promised is made here, once the sections exist. Same reason as the
  // one in `Checks`.
  useEffect(() => {
    const anchor = window.location.hash.slice(1);
    if (!anchor.startsWith('terms-')) return;
    document.getElementById(anchor)?.scrollIntoView({ block: 'start' });
  }, []);

  return language === 'uk' ? <UkrainianTerms /> : <EnglishTerms />;
}

function UkrainianTerms(): JSX.Element {
  return (
    <article className="legal-document" lang="uk">
      <EffectiveNotice
        language="uk"
        documentName="Умови користування сервісом FluxRadar, що надається під найменуванням FluxLab."
      />
      <section id="terms-operator" className="legal-section">
        <span className="legal-section__label">01 / ОПЕРАТОР</span>
        <h2>Хто надає сервіс</h2>
        <p>
          FluxRadar надає ФОП Павленко Андрій Володимирович під комерційним найменуванням FluxLab.
          Цей підприємець є оператором сервісу та стороною цих Умов щодо надання аудиту. FastSpring
          є окремим merchant of record: він оформлює продаж, приймає платіж, розраховує податки та
          видає платіжні документи за власними умовами.
        </p>
        <OperatorDetails language="uk" />
      </section>
      <section id="terms-service" className="legal-section">
        <span className="legal-section__label">02 / СЕРВІС</span>
        <h2>Що робить FluxRadar</h2>
        <p>
          FluxRadar автоматично перевіряє загальнодоступні ресурси сайтів і формує технічні, SEO,
          AI‑видимість, performance, security, accessibility, reliability, content, privacy та, коли
          доступно, UX/Conversion сигнали. Сервіс не змінює перевірюваний сайт і не потребує доступу
          до CMS чи приватних облікових записів.
        </p>
        <p>
          Можна подати будь-який загальнодоступний сайт. Якщо ви вимикаєте дотримання
          <code> robots.txt</code>, ви підтверджуєте, що маєте законні повноваження відступити від
          опублікованих інструкцій цього сайту, і відповідаєте за такий вибір.
        </p>
      </section>
      <section id="terms-account" className="legal-section">
        <span className="legal-section__label">03 / ДОСТУП</span>
        <h2>Акаунти та підключені сервіси</h2>
        <p>
          Для створення акаунта або оплати ви повинні бути повнолітніми за законодавством своєї
          країни або мати належний дозвіл одного з батьків чи опікуна. Надавайте точні дані,
          зберігайте облікові дані в безпеці та повідомляйте нас про несанкціонований доступ.
        </p>
        <p>
          Підключення Google і Bing необов’язкові та працюють лише на читання в межах наданих
          дозволів. Ви відповідаєте за вибір ресурсів, які маєте право читати. Квоти, дозволи або
          недоступність провайдера можуть обмежити інтегровані результати, не зупиняючи доступні
          публічні перевірки.
        </p>
      </section>
      <section id="terms-paid" className="legal-section">
        <span className="legal-section__label">04 / ПОКУПКИ</span>
        <h2>Разові аудити, строк виконання та повернення</h2>
        <p>
          Basic і Complete — разові аудити без підписки й автоматичного продовження. Ціна,
          конфігурація, обсяг, вибір <code>robots.txt</code>, зовнішні провайдери та обмеження
          показуються до відкриття checkout. Аудит запускається лише після серверного підтвердження
          платежу FastSpring і має бути наданий протягом 24 годин після такого підтвердження.
        </p>
        <p>
          FluxRadar не надає добровільних повернень, крім випадку ненадання оплаченого аудиту або
          підтвердженого істотного технічного дефекту. У таких випадках зверніться до{' '}
          <SupportLink />; залежно від обставин ми можемо повторити виконання або організувати
          повернення через FastSpring. Також діють усі засоби захисту, від яких не можна відмовитися
          за застосовним законом. Ці Умови не скасовують обов’язкове право споживача на відмову,
          повторне виконання, зменшення ціни чи повернення коштів і не стверджують, що таке право
          автоматично втрачено через початок аудиту.
        </p>
        <p>
          Повернення, chargeback або недійсний платіж можуть припинити доступ до відповідного звіту.
          З питань платежу також можна звернутися до{' '}
          <a href="https://fastspring.com/consumer-support/">
            служби підтримки покупців FastSpring
          </a>
          .
        </p>
      </section>
      <section id="terms-use" className="legal-section">
        <span className="legal-section__label">05 / ПРАВИЛА</span>
        <h2>Прийнятне використання</h2>
        <ul>
          <li>
            Не подавайте паролі, секрети, приватні URL або дані, які не маєте права обробляти.
          </li>
          <li>
            Не використовуйте FluxRadar для атак, перевантаження, обходу автентифікації чи інших
            засобів контролю, несанкціонованого доступу або незаконної діяльності.
          </li>
          <li>
            Не вводьте конфіденційні відомості, спеціальні категорії даних або чужі персональні дані
            без належної правової підстави.
          </li>
          <li>
            Не називайте автоматичний звіт юридичною, security чи accessibility сертифікацією і не
            обходьте тарифні обмеження.
          </li>
        </ul>
      </section>
      <section id="terms-results" className="legal-section">
        <span className="legal-section__label">06 / РЕЗУЛЬТАТ</span>
        <h2>Звіти допомагають ухвалювати рішення</h2>
        <p>
          Звіт може бути неповним, затриманим, недоступним або помилковим. Сторінки можуть бути
          заблоковані, змінитися чи залежати від JavaScript, який crawler не виконує. AI,
          PageSpeed/Lighthouse, CrUX та підключені інтеграції можуть не відповісти, вичерпати квоту
          або не мати достатніх даних. Завершений запуск не означає, що кожен модуль має оцінку.
        </p>
        <p>
          AI‑відповіді й UX‑інтерпретації є ймовірнісними: вони можуть пропустити факт, вигадати
          твердження або змінитися під час наступного запиту. Lighthouse є разовим лабораторним
          вимірюванням, а CrUX — історичною вибіркою реального користувацького досвіду, яка може
          бути відсутня. Search Console та Analytics можуть бути затриманими, відфільтрованими чи
          неповними.
        </p>
        <p>
          FluxRadar не гарантує оцінку, ranking, згадку в AI, traffic, conversion,
          security‑результат, юридичну відповідність або accessibility conformance. Перевіряйте
          суттєві висновки та докази самостійно. Ці обмеження не звільняють нас від обов’язку надати
          придбаний аудит і не скасовують обов’язкові засоби захисту споживача.
        </p>
      </section>
      <section id="terms-rights" className="legal-section">
        <span className="legal-section__label">07 / ПРАВА</span>
        <h2>Ваші матеріали та звіт</h2>
        <p>
          Ви зберігаєте права на подану інформацію. Звіт приватний і доступний через ваш акаунт, але
          ви можете завантажувати, передавати та публікувати свій звіт на власний розсуд і
          відповідаєте за розкриту в ньому інформацію. FluxRadar і FluxLab зберігають права на
          сервіс, програмний код, правила, методики оцінювання та брендинг.
        </p>
        <p>
          Ми можемо використовувати лише знеособлені й агреговані результати аудитів для покращення
          правил і якості сервісу, не публікуючи ідентифікований сайт або окремий звіт.
        </p>
      </section>
      <section id="terms-liability" className="legal-section">
        <span className="legal-section__label">08 / ВІДПОВІДАЛЬНІСТЬ</span>
        <h2>Доступність і межі відповідальності</h2>
        <p>
          Ми можемо змінювати або призупиняти функції для обслуговування, security чи через зміни
          провайдерів, а також обмежувати доступ у разі шахрайства, незаконного використання або
          істотного порушення цих Умов. Наскільки дозволяє закон, сервіс надається без гарантії
          безперервної чи безпомилкової роботи.
        </p>
        <p>
          Наскільки це дозволено законом, сукупна відповідальність FluxRadar, FluxLab і оператора за
          претензією обмежується сумою, сплаченою за конкретний аудит, якого вона стосується. Це
          обмеження не застосовується до відповідальності та прав, які закон забороняє виключати або
          обмежувати.
        </p>
      </section>
      <section id="terms-law" className="legal-section">
        <span className="legal-section__label">09 / ПРАВО</span>
        <h2>Застосовне право, спори та зміни</h2>
        <p>
          Ці Умови регулюються правом України. Спочатку надішліть претензію на <SupportLink />, щоб
          ми могли спробувати вирішити її без спору. Якщо це не вдасться, спір розглядають
          компетентні суди України, крім випадків, коли обов’язкове законодавство про захист
          споживачів надає вам інше застосовне право або місце розгляду.
        </p>
        <p>
          Ми можемо оновлювати ці Умови й дату набрання чинності та повідомимо про суттєві зміни,
          коли це вимагається. Українська версія є юридично пріоритетною; переклади надаються для
          зручності.
        </p>
      </section>
    </article>
  );
}

function EnglishTerms(): JSX.Element {
  return (
    <article className="legal-document" lang="en">
      <EffectiveNotice
        language="en"
        documentName="Terms for the FluxRadar service provided under the FluxLab trade name."
      />
      <section id="terms-operator" className="legal-section">
        <span className="legal-section__label">01 / OPERATOR</span>
        <h2>Who provides the service</h2>
        <p>
          FluxRadar is provided by Pavlenko Andrii Volodymyrovich, a Ukrainian individual
          entrepreneur trading as FluxLab. He is the service operator and the party to these Terms
          for delivery of the audit. FastSpring is a separate merchant of record that concludes the
          sale, takes payment, calculates taxes and provides payment documents under its own terms.
        </p>
        <OperatorDetails language="en" />
      </section>
      <section id="terms-service" className="legal-section">
        <span className="legal-section__label">02 / SERVICE</span>
        <h2>What FluxRadar does</h2>
        <p>
          FluxRadar automatically reviews publicly accessible website resources and produces
          technical, SEO, AI visibility, performance, security, accessibility, reliability, content,
          privacy and, where available, UX/Conversion signals. It does not modify the tested site or
          require CMS or private-account access.
        </p>
        <p>
          You may submit any publicly accessible site. If you disable compliance with
          <code> robots.txt</code>, you confirm that you have lawful authority to depart from the
          site’s published instructions and accept responsibility for that choice.
        </p>
      </section>
      <section id="terms-account" className="legal-section">
        <span className="legal-section__label">03 / ACCESS</span>
        <h2>Accounts and connected services</h2>
        <p>
          To create an account or pay, you must be an adult under the law that applies to you or
          have proper permission from a parent or guardian. Provide accurate information, keep your
          credentials secure and notify us of unauthorized access.
        </p>
        <p>
          Google and Bing connections are optional and read-only within the scopes you grant. You
          are responsible for selecting properties you may lawfully read. Provider permissions,
          quotas or outages can limit integrated results without stopping available public checks.
        </p>
      </section>
      <section id="terms-paid" className="legal-section">
        <span className="legal-section__label">04 / PURCHASES</span>
        <h2>One-time audits, delivery and refunds</h2>
        <p>
          Basic and Complete are one-time audits with no subscription or automatic renewal. The
          price, configuration, scope, <code>robots.txt</code> choice, external providers and known
          limitations are shown before checkout opens. An audit starts only after FastSpring’s
          server confirmation of payment and will be delivered within 24 hours of that confirmation.
        </p>
        <p>
          FluxRadar offers no voluntary refunds except for non-delivery of a paid audit or a
          verified material technical defect. Contact <SupportLink />; depending on the facts, we
          may repeat performance or arrange a refund through FastSpring. All remedies that cannot be
          waived under applicable law continue to apply. These Terms do not remove a mandatory
          consumer right of withdrawal, repeat performance, price reduction or refund, and do not
          claim that a withdrawal right is automatically lost when an audit starts.
        </p>
        <p>
          A refund, chargeback or invalid payment may end access to the corresponding report. For
          payment questions, you may also contact{' '}
          <a href="https://fastspring.com/consumer-support/">FastSpring buyer support</a>.
        </p>
      </section>
      <section id="terms-use" className="legal-section">
        <span className="legal-section__label">05 / RULES</span>
        <h2>Acceptable use</h2>
        <ul>
          <li>Do not submit passwords, secrets, private URLs or data you may not process.</li>
          <li>
            Do not use FluxRadar to attack, overload, bypass authentication or other controls, gain
            unauthorized access or perform unlawful activity.
          </li>
          <li>
            Do not enter confidential information, special-category or sensitive data, or another
            person’s personal data without a lawful basis.
          </li>
          <li>
            Do not present an automated report as legal, security or accessibility certification or
            evade plan limits.
          </li>
        </ul>
      </section>
      <section id="terms-results" className="legal-section">
        <span className="legal-section__label">06 / OUTPUT</span>
        <h2>Reports are decision support</h2>
        <p>
          A report can be partial, delayed, unavailable or wrong. Pages may be blocked, change or
          depend on JavaScript the crawler does not run. AI, PageSpeed/Lighthouse, CrUX and
          connected integrations may fail, exhaust a quota or lack sufficient data. A completed run
          does not mean that every module produced a score.
        </p>
        <p>
          AI answers and UX interpretations are probabilistic: they can omit a fact, invent a claim
          or change on another request. Lighthouse is a point-in-time lab measurement; CrUX is a
          historical real-user sample that may be unavailable. Search Console and Analytics can be
          delayed, filtered or incomplete.
        </p>
        <p>
          FluxRadar does not guarantee a score, ranking, AI mention, traffic, conversion, security
          outcome, legal compliance or accessibility conformance. Independently review material
          conclusions and evidence. These limitations do not excuse a failure to provide the
          purchased audit or remove mandatory consumer remedies.
        </p>
      </section>
      <section id="terms-rights" className="legal-section">
        <span className="legal-section__label">07 / RIGHTS</span>
        <h2>Your materials and report</h2>
        <p>
          You retain rights in submitted information. Reports are private and account-scoped by
          default, but you may download, share and publish your own report at your discretion and
          are responsible for information you disclose. FluxRadar and FluxLab retain rights in the
          service, software, rules, scoring methods and branding.
        </p>
        <p>
          We may use only anonymized and aggregated audit results to improve service rules and
          quality, without publishing an identifiable site or individual report.
        </p>
      </section>
      <section id="terms-liability" className="legal-section">
        <span className="legal-section__label">08 / LIABILITY</span>
        <h2>Availability and liability limits</h2>
        <p>
          We may change or pause features for maintenance, security or provider changes and may
          restrict fraud, unlawful use or a material breach. To the extent permitted by law, the
          service is provided without a promise of uninterrupted or error-free operation.
        </p>
        <p>
          To the maximum extent permitted by law, the total liability of FluxRadar, FluxLab and the
          operator for a claim is limited to the amount paid for the specific affected audit. This
          limit does not apply to liability or rights that applicable law does not permit us to
          exclude or restrict.
        </p>
      </section>
      <section id="terms-law" className="legal-section">
        <span className="legal-section__label">09 / LAW</span>
        <h2>Governing law, disputes and changes</h2>
        <p>
          These Terms are governed by Ukrainian law. First send a complaint to <SupportLink /> so we
          can try to resolve it. If that fails, the competent courts of Ukraine have jurisdiction,
          except where mandatory consumer law gives you another governing law or venue.
        </p>
        <p>
          We may update these Terms and their effective date and will provide notice of material
          changes where required. The Ukrainian version controls; translations are provided for
          convenience.
        </p>
      </section>
    </article>
  );
}
