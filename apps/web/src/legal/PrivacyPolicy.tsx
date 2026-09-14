import type { JSX } from 'react';

import type { Language } from '../i18n';
import { EffectiveNotice, OperatorDetails, SupportLink, type EffectiveDate } from './SharedLegal';

/**
 * Changed when the Google data section stopped describing the removed Query
 * Ideas generator, which sent Search Console queries to the AI provider.
 */
const PRIVACY_EFFECTIVE: EffectiveDate = { uk: '14 вересня 2026 року', en: '14 September 2026' };

export function PrivacyPolicy({ language }: { readonly language: Language }): JSX.Element {
  return language === 'uk' ? <UkrainianPrivacy /> : <EnglishPrivacy />;
}

function UkrainianPrivacy(): JSX.Element {
  return (
    <article className="legal-document" lang="uk">
      <EffectiveNotice
        language="uk"
        documentName="Політика приватності FluxRadar, що надається під найменуванням FluxLab."
        effectiveOn={PRIVACY_EFFECTIVE}
      />
      <section id="privacy-controller" className="legal-section">
        <span className="legal-section__label">01 / КОНТРОЛЕР</span>
        <h2>Хто відповідає за дані</h2>
        <p>
          Контролером персональних даних у FluxRadar є ФОП Павленко Андрій Володимирович, який
          працює під комерційним найменуванням FluxLab. З питань приватності, реалізації прав або
          видалення акаунта звертайтеся за наведеними нижче контактами.
        </p>
        <OperatorDetails language="uk" />
      </section>
      <section id="privacy-data" className="legal-section">
        <span className="legal-section__label">02 / ДАНІ</span>
        <h2>Які дані ми обробляємо</h2>
        <ul>
          <li>
            <strong>Акаунт і підтримка:</strong> email, hash пароля, записи верифікації та
            відновлення, сесії входу, доставка сервісних листів і ваші звернення. Ми надсилаємо лише
            операційні повідомлення про акаунт, оплату, звіт і безпеку — без маркетингових розсилок.
          </li>
          <li>
            <strong>Профілі й аудити:</strong> домен, назва, галузь, опис, товари чи послуги,
            регіон, мови, аудиторія, конфігурація crawl, завантажені публічні сторінки й технічні
            сигнали, знахідки, оцінки, докази, AI‑запити та відповіді й експорт звіту.
          </li>
          <li>
            <strong>Інтеграції:</strong> зашифровані Google або Bing access/refresh tokens, дозволи,
            вибрані ресурси та дані, прочитані для запитаної функції. Google може надати URL,
            пошукові запити, clicks, impressions, CTR, positions і агреговані Analytics metrics.
          </li>
          <li>
            <strong>Покупки:</strong> FastSpring order і checkout identifiers, товар, сума, валюта,
            податок, статус платежу, повернення чи спору. Webhook може містити ім’я, email, billing
            address та інші дані покупця. Номер платіжної картки вводиться у FastSpring і не
            зберігається FluxRadar.
          </li>
          <li>
            <strong>Безпека й робота сервісу:</strong> IP‑адреса, request/error data та rate‑limit
            записи для захисту акаунтів, запобігання повторному використанню безкоштовної перевірки
            й діагностики несправностей.
          </li>
        </ul>
        <p>
          Публічна сторінка або введений контекст можуть містити персональні дані. Не додавайте
          паролі, конфіденційну інформацію, спеціальні категорії даних або чужі персональні дані,
          якщо не маєте законної підстави їх передавати й обробляти.
        </p>
      </section>
      <section id="privacy-google" className="legal-section">
        <span className="legal-section__label">03 / GOOGLE</span>
        <h2>Дані підключеного Google‑акаунта</h2>
        <p>
          Підключення Google надає FluxRadar read‑only доступ до Search Console та Google Analytics
          у межах дозволів
          <code> webmasters.readonly</code> і <code>analytics.readonly</code>. Ми використовуємо
          вибрані property data лише для функцій аудиту й звіту, не продаємо їх, не використовуємо
          для реклами, кредитних рішень або навчання загальних AI‑моделей. Використання Google API
          data підпорядковується{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , включно з Limited Use requirements.
        </p>
        <p>
          Дані Search Console та Analytics показуються у ваших звітах і налаштуваннях інтеграцій та
          не передаються AI‑провайдеру; Google OAuth tokens також ніколи не передаються
          AI‑провайдеру. Прочитані дані зберігаються разом зі звітом, для якого їх отримано,
          протягом описаного нижче строку зберігання звітів. Відключення Google видаляє збережені
          tokens.
        </p>
      </section>
      <section id="privacy-use" className="legal-section">
        <span className="legal-section__label">04 / МЕТА</span>
        <h2>Навіщо й на якій підставі ми використовуємо дані</h2>
        <p>
          Дані акаунта, профілю, аудиту, покупки та інтеграції потрібні для автентифікації,
          виконання вибраної перевірки, формування приватного звіту, сервісних повідомлень і
          підтримки. Правовою підставою обробки, об’єктивно необхідної для вибраної основної
          функції, є виконання договору. Безпека, запобігання зловживанням і захист прав є нашими
          законними інтересами з урахуванням прав користувача; окремі записи зберігаються через
          правовий обов’язок. Необов’язкове browser storage і майбутня site analytics потребують
          окремого вибору в налаштуваннях cookies.
        </p>
        <p>
          Платні аудити включають застосовний AI‑аналіз: Basic — AI SEO / GEO, Complete — AI SEO /
          GEO та UX/Conversion. До оплати й запуску помітний дисклеймер називає активного провайдера
          та пояснює передачу публічних сторінок і введеного контексту. На дату цієї Політики
          production‑адаптер використовує Anthropic. OpenAI може бути доданий лише після оновлення
          цього повідомлення; ми не стверджуємо, що він уже отримує дані. Дані акаунта, оплати,
          повний номер картки та Google/Bing tokens не входять до AI‑запиту.
        </p>
        <p>
          GEO може надсилати нейтралізований контекст для створення discovery questions без назви й
          домену, а потім окремо ставити awareness questions із назвою та доменом. UX/Conversion
          може включати обмежені публічні докази: URL, titles, headings, calls to action, links і
          form information. Автоматичне приховування секретів не гарантує видалення всіх
          персональних даних. Уже надісланий провайдеру запит неможливо відкликати.
        </p>
        <p>
          Ми не продаємо персональні дані й не передаємо їх рекламним партнерам. Дозволено
          використовувати лише знеособлені й агреговані результати аудитів для покращення правил і
          якості сервісу без публікації окремого сайту або звіту.
        </p>
      </section>
      <section id="privacy-providers" className="legal-section">
        <span className="legal-section__label">05 / ОТРИМУВАЧІ</span>
        <h2>Провайдери та міжнародна обробка</h2>
        <ul>
          <li>
            <strong>Hetzner Online GmbH</strong> — production application, PostgreSQL, приватне
            object storage і backups на інфраструктурі в Німеччині.
          </li>
          <li>
            <strong>Google і Microsoft/Bing</strong> — read‑only integration requests;
            <strong> Google PageSpeed Insights і CrUX</strong> отримують публічний URL або origin
            для Complete performance check без підключення користувацького Google‑акаунта.
          </li>
          <li>
            <strong>Anthropic</strong> — поточний AI‑провайдер для описаних вище AI‑запитів.
            Retention і processing залежать від чинних API terms та налаштувань; ми не обіцяємо zero
            retention у провайдера. Див.{' '}
            <a href="https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data">
              інформацію Anthropic про зберігання комерційних даних
            </a>
            .
          </li>
          <li>
            <strong>OpenAI</strong> не використовується поточним production‑адаптером. Якщо його
            буде підключено, активний pre‑purchase notice і ця Політика будуть оновлені до першої
            передачі. Див.{' '}
            <a href="https://openai.com/policies/privacy-policy/">Privacy Policy OpenAI</a>.
          </li>
          <li>
            <strong>FastSpring</strong> — merchant of record і checkout provider. Див.{' '}
            <a href="https://fastspring.com/privacy/">FastSpring Privacy Statement</a>.
          </li>
          <li>
            <strong>Resend</strong> — коли transactional email увімкнено, отримує email і вміст
            сервісного листа. Див.{' '}
            <a href="https://resend.com/legal/privacy-policy">Resend Privacy Policy</a>.
          </li>
        </ul>
        <p>
          Окремі провайдери можуть обробляти дані за межами вашої країни, зокрема у США, за власними
          умовами й застосовними механізмами передачі. Зверніться до <SupportLink />, якщо потрібна
          інформація про домовленості, застосовні до конкретної обробки.
        </p>
      </section>
      <section id="privacy-retention" className="legal-section">
        <span className="legal-section__label">06 / СТРОКИ</span>
        <h2>Зберігання та видалення</h2>
        <ul>
          <li>Free і Basic reports — 30 днів від створення scan; Complete reports — 365 днів.</li>
          <li>
            Профілі, конфігурації й інтеграції зберігаються до видалення користувачем або акаунта,
            якщо коротший строк не встановлено для конкретного report artifact.
          </li>
          <li>
            Звичайні application і security logs — до 30 днів. Записи конкретного security incident,
            fraud investigation, legal obligation або спору можуть зберігатися до його завершення.
          </li>
          <li>
            Незв’язані або відхилені payment events можуть видалятися через 30 днів. Пов’язані
            purchase records зберігаються стільки, скільки потрібно для договору, бухгалтерських,
            податкових, fraud і dispute obligations.
          </li>
        </ul>
        <p>
          Після підтвердженого запиту на видалення акаунта ми видаляємо пов’язані профілі, токени,
          активні сесії, звіти та AI records протягом 30 днів, крім мінімальних записів, які
          необхідні за законом або для fraud/dispute defense. Backups у Hetzner перезаписуються або
          видаляються протягом 30 днів. Дані в FastSpring, email‑провайдера чи іншого незалежного
          провайдера підпорядковуються його власним строкам і правовим обов’язкам.
        </p>
      </section>
      <section id="privacy-cookies" className="legal-section">
        <span className="legal-section__label">07 / COOKIES</span>
        <h2>Cookies і browser storage</h2>
        <p>
          Необхідні засоби зберігання підтримують вхід, checkout recovery і ваш вибір cookies;
          preference storage запам’ятовує мову лише після дозволу. FluxRadar зараз не завантажує
          Google Analytics 4 або рекламні trackers. Якщо site analytics буде додано, вона
          запускатиметься лише після дозволу; Google Signals, ads personalization і remarketing
          будуть вимкнені, а user/event data зберігатимуться 2 місяці. Повний перелік, строки й
          керування наведено в <a href="/cookies?lang=uk">Політиці cookies</a>.
        </p>
      </section>
      <section id="privacy-rights" className="legal-section">
        <span className="legal-section__label">08 / ВАШІ ПРАВА</span>
        <h2>Доступ, виправлення, заперечення та видалення</h2>
        <p>
          Ви можете від’єднати інтеграцію, видалити browser preferences або звернутися до{' '}
          <SupportLink /> щодо доступу, виправлення, portable copy, обмеження, заперечення чи
          видалення даних. Ми можемо перевірити, що запит стосується вашого акаунта. Залежно від
          застосовного закону ви також можете відкликати згоду там, де вона є правовою підставою, та
          подати скаргу до компетентного органу із захисту даних.
        </p>
        <p>
          Ми оновлюємо цю Політику й дату набрання чинності, коли змінюється обробка, та надаємо
          повідомлення про суттєві зміни, якщо це потрібно. Українська версія є юридично
          пріоритетною; переклади надаються для зручності.
        </p>
      </section>
    </article>
  );
}

function EnglishPrivacy(): JSX.Element {
  return (
    <article className="legal-document" lang="en">
      <EffectiveNotice
        language="en"
        documentName="Privacy Policy for FluxRadar, provided under the FluxLab trade name."
        effectiveOn={PRIVACY_EFFECTIVE}
      />
      <section id="privacy-controller" className="legal-section">
        <span className="legal-section__label">01 / CONTROLLER</span>
        <h2>Who is responsible for data</h2>
        <p>
          The controller of personal data in FluxRadar is Pavlenko Andrii Volodymyrovich, a
          Ukrainian individual entrepreneur trading as FluxLab. Use the contact details below for
          privacy questions, rights requests or account deletion.
        </p>
        <OperatorDetails language="en" />
      </section>
      <section id="privacy-data" className="legal-section">
        <span className="legal-section__label">02 / DATA</span>
        <h2>Data we handle</h2>
        <ul>
          <li>
            <strong>Account and support:</strong> email, password hash, verification and reset
            records, sign-in sessions, service-email delivery and support messages. We send only
            operational account, payment, report and security messages, not marketing email.
          </li>
          <li>
            <strong>Profiles and audits:</strong> domain, name, industry, description, products or
            services, region, languages, audience, crawl configuration, fetched public pages and
            technical signals, findings, scores, evidence, AI inputs and responses and exports.
          </li>
          <li>
            <strong>Integrations:</strong> encrypted Google or Bing access and refresh tokens,
            scopes, selected properties and data read for a requested feature. Google data can
            include URLs, search queries, clicks, impressions, CTR, positions and aggregate
            Analytics metrics.
          </li>
          <li>
            <strong>Purchases:</strong> FastSpring order and checkout identifiers, product, amount,
            currency, tax, payment, refund and dispute status. Webhooks can contain buyer name,
            email, billing address and other buyer details. Card entry is handled by FastSpring;
            FluxRadar does not store the full card number.
          </li>
          <li>
            <strong>Security and operations:</strong> IP address, request/error data and rate-limit
            records used to protect accounts, prevent repeated free checks and diagnose failures.
          </li>
        </ul>
        <p>
          A public page or supplied context can contain personal data. Do not provide passwords,
          confidential information, special-category or sensitive data, or another person’s data
          unless you have a lawful basis to disclose and process it.
        </p>
      </section>
      <section id="privacy-google" className="legal-section">
        <span className="legal-section__label">03 / GOOGLE</span>
        <h2>Connected Google account data</h2>
        <p>
          Connecting Google gives FluxRadar read-only Search Console and Google Analytics access
          within the <code>webmasters.readonly</code> and <code>analytics.readonly</code> scopes. We
          use selected property data only for requested audit and report features, and do not sell
          it or use it for advertising, credit decisions or general-purpose AI model training. Our
          use of Google API data is subject to the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including its Limited Use requirements.
        </p>
        <p>
          Search Console and Analytics data is shown in your reports and integration settings and is
          not sent to an AI provider; Google OAuth tokens are never sent to an AI provider either.
          The data read is kept with the report it was read for, for the report retention period
          described below. Disconnecting Google deletes the stored tokens.
        </p>
      </section>
      <section id="privacy-use" className="legal-section">
        <span className="legal-section__label">04 / PURPOSE</span>
        <h2>Why and on what basis we use data</h2>
        <p>
          Account, profile, audit, purchase and integration data is used to authenticate you,
          perform the selected check, build a private report, send service messages and provide
          support. Processing objectively necessary for a chosen core feature is based on
          performance of the service contract. Security, abuse prevention and protection of rights
          serve our legitimate interests, subject to user rights; some records are kept to meet a
          legal obligation. Optional browser storage and future site analytics require a separate
          cookie choice.
        </p>
        <p>
          Paid audits include the applicable AI analysis: Basic includes AI SEO / GEO, while
          Complete includes AI SEO / GEO and UX/Conversion. Before payment and launch, a prominent
          disclaimer names the active provider and explains the transfer of public pages and
          supplied project context. At this Policy’s effective date the production adapter uses
          Anthropic. OpenAI may be added only after that notice is updated; we do not claim it
          currently receives data. Account details, payment data, the full card number and
          Google/Bing tokens are not AI inputs.
        </p>
        <p>
          GEO can send neutralized context to generate discovery questions without the name or
          domain, then separately ask awareness questions that include them. UX/Conversion can
          include limited public evidence such as URLs, titles, headings, calls to action, links and
          form information. Automated secret redaction cannot guarantee removal of all personal
          data. A request already sent to a provider cannot be recalled.
        </p>
        <p>
          We do not sell personal data or share it with advertising partners. We may use only
          anonymized and aggregated audit results to improve service rules and quality, without
          publishing an individual site or report.
        </p>
      </section>
      <section id="privacy-providers" className="legal-section">
        <span className="legal-section__label">05 / RECIPIENTS</span>
        <h2>Providers and international processing</h2>
        <ul>
          <li>
            <strong>Hetzner Online GmbH</strong> hosts the production application, PostgreSQL,
            private object storage and backups on infrastructure in Germany.
          </li>
          <li>
            <strong>Google and Microsoft/Bing</strong> receive read-only integration requests;
            <strong> Google PageSpeed Insights and CrUX</strong> receive a public URL or origin for
            Complete performance checks without a connected user Google account.
          </li>
          <li>
            <strong>Anthropic</strong> is the current AI provider for the AI requests described
            above. Retention and processing depend on applicable API terms and settings; we do not
            promise zero provider retention. See{' '}
            <a href="https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data">
              Anthropic’s commercial retention information
            </a>
            .
          </li>
          <li>
            <strong>OpenAI</strong> is not used by the current production adapter. If enabled, the
            active pre-purchase notice and this Policy will be updated before the first transfer.
            See <a href="https://openai.com/policies/privacy-policy/">OpenAI Privacy Policy</a>.
          </li>
          <li>
            <strong>FastSpring</strong> is the merchant of record and checkout provider. See the{' '}
            <a href="https://fastspring.com/privacy/">FastSpring Privacy Statement</a>.
          </li>
          <li>
            <strong>Resend</strong>, when transactional email is enabled, receives the recipient
            email and service-message content. See the{' '}
            <a href="https://resend.com/legal/privacy-policy">Resend Privacy Policy</a>.
          </li>
        </ul>
        <p>
          Some providers may process data outside your country, including in the United States,
          under their terms and applicable transfer mechanisms. Contact <SupportLink /> for details
          about arrangements applicable to a particular processing activity.
        </p>
      </section>
      <section id="privacy-retention" className="legal-section">
        <span className="legal-section__label">06 / RETENTION</span>
        <h2>Storage and deletion</h2>
        <ul>
          <li>Free and Basic reports: 30 days from scan creation; Complete reports: 365 days.</li>
          <li>
            Profiles, configurations and integrations remain until deleted by the user or with the
            account, unless a shorter period applies to a particular report artifact.
          </li>
          <li>
            Ordinary application and security logs: up to 30 days. Records of an active security
            incident, fraud investigation, legal obligation or dispute may remain until resolved.
          </li>
          <li>
            Unlinked or rejected payment events may be removed after 30 days. Linked purchase
            records remain as needed for contract, accounting, tax, fraud and dispute obligations.
          </li>
        </ul>
        <p>
          After a verified account-deletion request, we remove linked profiles, tokens, active
          sessions, reports and AI records within 30 days, except minimal records required by law or
          for fraud/dispute defense. Hetzner backups are overwritten or deleted within 30 days.
          FastSpring, email-provider and other independent provider records follow their own
          retention and legal obligations.
        </p>
      </section>
      <section id="privacy-cookies" className="legal-section">
        <span className="legal-section__label">07 / COOKIES</span>
        <h2>Cookies and browser storage</h2>
        <p>
          Necessary storage supports sign-in, checkout recovery and the cookie choice; preference
          storage remembers language only after permission. FluxRadar does not currently load Google
          Analytics 4 or advertising trackers. If site analytics is added, it will start only after
          permission; Google Signals, ads personalization and remarketing will remain disabled, and
          user/event data retention will be set to 2 months. See the full inventory, durations and
          controls in the <a href="/cookies?lang=en">Cookie Policy</a>.
        </p>
      </section>
      <section id="privacy-rights" className="legal-section">
        <span className="legal-section__label">08 / YOUR RIGHTS</span>
        <h2>Access, correction, objection and deletion</h2>
        <p>
          You can disconnect an integration, remove browser preferences or contact <SupportLink />
          for access, correction, a portable copy, restriction, objection or deletion. We may verify
          that a request concerns your account. Depending on applicable law, you may also withdraw
          consent where it is the legal basis and complain to a competent data-protection authority.
        </p>
        <p>
          We update this Policy and its effective date when processing changes and provide notice of
          material changes where required. The Ukrainian version controls; translations are for
          convenience.
        </p>
      </section>
    </article>
  );
}
