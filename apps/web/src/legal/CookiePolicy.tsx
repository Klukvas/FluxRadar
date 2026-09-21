import type { JSX } from 'react';

import { GA_MEASUREMENT_ID } from '../analytics-config';
import { CookieSettingsButton } from '../CookieConsent';
import type { Language } from '../i18n';
import { EffectiveNotice, OperatorDetails, SupportLink, type EffectiveDate } from './SharedLegal';

/** Changed when the policy gained the analytics category and Google Analytics 4. */
const COOKIES_EFFECTIVE: EffectiveDate = { uk: '21 вересня 2026 року', en: '21 September 2026' };

/** The second cookie gtag sets is named after the stream, so the inventory names it exactly. */
const GA_SESSION_COOKIE = `_ga_${GA_MEASUREMENT_ID.replace(/^G-/, '')}`;

export function CookiePolicy({ language }: { readonly language: Language }): JSX.Element {
  return language === 'uk' ? <UkrainianCookiePolicy /> : <EnglishCookiePolicy />;
}

function UkrainianCookiePolicy(): JSX.Element {
  return (
    <article className="legal-document" lang="uk">
      <EffectiveNotice
        language="uk"
        documentName="Політика cookies і browser storage для FluxRadar, що надається під найменуванням FluxLab."
        effectiveOn={COOKIES_EFFECTIVE}
      />
      <section id="cookies-controller" className="legal-section">
        <span className="legal-section__label">01 / ХТО ВІДПОВІДАЄ</span>
        <h2>Оператор і сфера дії</h2>
        <p>
          Ця Політика пояснює, які cookies та browser storage використовує FluxRadar на
          fluxradar.net, навіщо вони потрібні, скільки зберігаються і як ними керувати. Оператором
          сервісу є:
        </p>
        <OperatorDetails language="uk" />
      </section>
      <section id="cookies-categories" className="legal-section">
        <span className="legal-section__label">02 / КАТЕГОРІЇ</span>
        <h2>Необхідне, preferences та аналітика</h2>
        <p>
          Необхідні cookies і storage забезпечують вхід, безпеку, відновлення checkout та збереження
          самого вибору cookies. Вони працюють без окремої згоди, бо без них відповідна функція не
          може працювати належно.
        </p>
        <p>
          Дві інші категорії необов’язкові й вимкнені, доки ви їх не ввімкнете: позначте потрібну й
          натисніть «Зберегти вибір» або оберіть «Дозволити все». Preferences запам’ятовують мову
          інтерфейсу. Аналітика завантажує Google Analytics 4 — див. розділ 04. FluxRadar не
          використовує рекламні trackers, remarketing або Google Signals.
        </p>
      </section>
      <section id="cookies-inventory" className="legal-section">
        <span className="legal-section__label">03 / РЕЄСТР</span>
        <h2>Що саме зберігається</h2>
        <div className="legal-storage-table" role="region" aria-label="Реєстр cookies і storage">
          <table>
            <thead>
              <tr>
                <th>Назва</th>
                <th>Тип і мета</th>
                <th>Строк</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>fluxradar_session</code>
                </td>
                <td>Необхідний HTTP-only cookie для автентифікації та захисту акаунта.</td>
                <td>
                  До закриття browser session; якщо обрано «Запам’ятати вхід» — до 7 днів. Серверна
                  сесія в будь-якому разі спливає не пізніше ніж через 7 днів.
                </td>
              </tr>
              <tr>
                <td>
                  <code>fluxradar.pendingCheckout</code>
                </td>
                <td>
                  Необхідний localStorage: прив’язує поточний checkout до акаунта і дозволяє
                  відновити підтвердження платежу після reload або повернення з FastSpring.
                </td>
                <td>До підтвердження, скасування або очищення поточного checkout.</td>
              </tr>
              <tr>
                <td>
                  <code>fluxradar.cookieConsent</code>
                </td>
                <td>Необхідний localStorage: записує ваш вибір щодо preferences і аналітики.</td>
                <td>180 днів, після чого вибір запитується знову.</td>
              </tr>
              <tr>
                <td>
                  <code>fluxradar.language</code>
                </td>
                <td>Необов’язковий localStorage: запам’ятовує мову інтерфейсу на пристрої.</td>
                <td>До відкликання дозволу, очищення browser storage або зміни зберігання.</td>
              </tr>
              <tr>
                <td>
                  <code>_ga</code>
                </td>
                <td>
                  Необов’язковий cookie Google Analytics 4 після дозволу аналітики: випадковий
                  ідентифікатор, що відрізняє відвідувачів.
                </td>
                <td>
                  До 180 днів від останнього візиту. Видаляється, щойно ви відкликаєте аналітику,
                  або під час наступного візиту після того, як дозвіл сплив.
                </td>
              </tr>
              <tr>
                <td>
                  <code>{GA_SESSION_COOKIE}</code>
                </td>
                <td>
                  Необов’язковий cookie Google Analytics 4 після дозволу аналітики: стан поточного
                  візиту.
                </td>
                <td>
                  Так само, як <code>_ga</code>.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section id="cookies-analytics" className="legal-section">
        <span className="legal-section__label">04 / GOOGLE ANALYTICS</span>
        <h2>Аналітика сайту</h2>
        <p>
          Google Analytics 4 не завантажується, доки ви не дозволите аналітику: до цього браузер
          навіть не звертається до Google. Після дозволу ми бачимо, які сторінки відвідують, звідки
          приходять відвідувачі й на яких кроках вони зупиняються — реєстрація, запуск безкоштовної
          перевірки, початок оплати, завершена покупка (тариф і ціна, без даних картки).
        </p>
        <p>
          Адреси сторінок передаються без query string та ідентифікаторів перевірок, тож посилання
          для підтвердження email чи відновлення пароля й домени, які ви перевіряєте, до Google не
          потрапляють. Google Signals, ads personalization і remarketing вимкнені, а user та event
          data зберігаються 2 місяці. Google обробляє ці дані як наш обробник; див.{' '}
          <a href="https://policies.google.com/technologies/partner-sites">
            як Google використовує дані сайтів, що користуються його сервісами
          </a>
          .
        </p>
      </section>
      <section id="cookies-providers" className="legal-section">
        <span className="legal-section__label">05 / FASTSPRING</span>
        <h2>Checkout стороннього провайдера</h2>
        <p>
          FastSpring є окремим merchant of record. Його checkout завантажується лише коли ви
          навмисно починаєте платну покупку. FastSpring може встановлювати власні необхідні cookies
          та storage для checkout, запобігання fraud, оплати й податкового розрахунку за своєю
          політикою приватності. FluxRadar не керує строками зберігання FastSpring.
        </p>
      </section>
      <section id="cookies-controls" className="legal-section">
        <span className="legal-section__label">06 / КЕРУВАННЯ</span>
        <h2>Як змінити вибір</h2>
        <p>
          Натисніть «Налаштування cookies» нижче, щоб увімкнути або вимкнути preferences і
          аналітику. Поки дозволено не все, ця кнопка також є внизу кожної сторінки. Після
          відкликання FluxRadar видаляє збережену мову, зупиняє Google Analytics і видаляє його
          cookies. Ви також можете очистити cookies та site data у браузері; видалення необхідного
          storage може завершити вхід або перервати відновлення незавершеного checkout.
        </p>
        <div className="button-row">
          <CookieSettingsButton language="uk" />
        </div>
        <p>
          Питання або запити щодо cookies надсилайте на <SupportLink />. Українська версія є
          юридично пріоритетною; переклади надаються для зручності.
        </p>
      </section>
    </article>
  );
}

function EnglishCookiePolicy(): JSX.Element {
  return (
    <article className="legal-document" lang="en">
      <EffectiveNotice
        language="en"
        documentName="Cookie and browser-storage policy for FluxRadar, provided under the FluxLab trade name."
        effectiveOn={COOKIES_EFFECTIVE}
      />
      <section id="cookies-controller" className="legal-section">
        <span className="legal-section__label">01 / WHO IS RESPONSIBLE</span>
        <h2>Operator and scope</h2>
        <p>
          This Policy explains which cookies and browser storage FluxRadar uses on fluxradar.net,
          why they are needed, how long they remain and how to control them. The service operator
          is:
        </p>
        <OperatorDetails language="en" />
      </section>
      <section id="cookies-categories" className="legal-section">
        <span className="legal-section__label">02 / CATEGORIES</span>
        <h2>Necessary, preferences and analytics</h2>
        <p>
          Necessary cookies and storage support sign-in, security, checkout recovery and the cookie
          choice itself. They operate without separate consent because the requested function cannot
          work properly without them.
        </p>
        <p>
          The two other categories are optional and stay off until you turn them on: tick one and
          choose “Save choice”, or choose “Allow all”. Preferences remember the interface language.
          Analytics loads Google Analytics 4 — see section 04. FluxRadar uses no advertising
          trackers, remarketing or Google Signals.
        </p>
      </section>
      <section id="cookies-inventory" className="legal-section">
        <span className="legal-section__label">03 / INVENTORY</span>
        <h2>What is stored</h2>
        <div
          className="legal-storage-table"
          role="region"
          aria-label="Cookie and storage inventory"
        >
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type and purpose</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>fluxradar_session</code>
                </td>
                <td>An essential HTTP-only cookie for authentication and account security.</td>
                <td>
                  Until the browser session closes; if “Remember me” is selected, up to 7 days. The
                  server session always expires no later than 7 days.
                </td>
              </tr>
              <tr>
                <td>
                  <code>fluxradar.pendingCheckout</code>
                </td>
                <td>
                  Essential localStorage: associates an in-progress checkout with the account and
                  restores payment confirmation after a reload or return from FastSpring.
                </td>
                <td>Until the current checkout is confirmed, cancelled or cleared.</td>
              </tr>
              <tr>
                <td>
                  <code>fluxradar.cookieConsent</code>
                </td>
                <td>Essential localStorage: records your preferences and analytics choice.</td>
                <td>180 days, after which the choice is requested again.</td>
              </tr>
              <tr>
                <td>
                  <code>fluxradar.language</code>
                </td>
                <td>Optional localStorage: remembers the interface language on the device.</td>
                <td>
                  Until permission is withdrawn, browser storage is cleared or the saved value is
                  changed.
                </td>
              </tr>
              <tr>
                <td>
                  <code>_ga</code>
                </td>
                <td>
                  Optional Google Analytics 4 cookie, set only after you allow analytics: a random
                  identifier that tells visitors apart.
                </td>
                <td>
                  Up to 180 days from your last visit. Deleted as soon as you withdraw analytics, or
                  on your next visit after the permission expired.
                </td>
              </tr>
              <tr>
                <td>
                  <code>{GA_SESSION_COOKIE}</code>
                </td>
                <td>
                  Optional Google Analytics 4 cookie, set only after you allow analytics: the state
                  of the current visit.
                </td>
                <td>
                  The same as <code>_ga</code>.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section id="cookies-analytics" className="legal-section">
        <span className="legal-section__label">04 / GOOGLE ANALYTICS</span>
        <h2>Site analytics</h2>
        <p>
          Google Analytics 4 does not load until you allow analytics: before that, your browser does
          not contact Google at all. Once allowed, it shows us which pages are visited, where
          visitors come from and which steps they stop at — sign-up, starting a free check, starting
          checkout and a completed purchase (plan and price, never card details).
        </p>
        <p>
          Page addresses are reported without query strings or check identifiers, so email
          verification and password-reset links and the domains you audit never reach Google. Google
          Signals, ads personalization and remarketing are disabled, and user and event data are
          kept for 2 months. Google processes this data as our processor; see{' '}
          <a href="https://policies.google.com/technologies/partner-sites">
            how Google uses information from sites that use its services
          </a>
          .
        </p>
      </section>
      <section id="cookies-providers" className="legal-section">
        <span className="legal-section__label">05 / FASTSPRING</span>
        <h2>Third-party checkout</h2>
        <p>
          FastSpring is the separate merchant of record. Its checkout loads only when you
          intentionally begin a paid purchase. FastSpring may set its own necessary cookies and
          storage for checkout, fraud prevention, payment and tax calculation under its privacy
          policy. FluxRadar does not control FastSpring’s retention periods.
        </p>
      </section>
      <section id="cookies-controls" className="legal-section">
        <span className="legal-section__label">06 / CONTROLS</span>
        <h2>How to change your choice</h2>
        <p>
          Select “Cookie settings” below to turn preferences and analytics on or off. Until
          everything is allowed, the same button also sits at the bottom of every page. When you
          withdraw, FluxRadar removes the saved language, stops Google Analytics and deletes its
          cookies. You can also clear cookies and site data in your browser; deleting necessary
          storage may sign you out or interrupt recovery of an unfinished checkout.
        </p>
        <div className="button-row">
          <CookieSettingsButton language="en" />
        </div>
        <p>
          Send cookie questions or requests to <SupportLink />. The Ukrainian version controls;
          translations are provided for convenience.
        </p>
      </section>
    </article>
  );
}
