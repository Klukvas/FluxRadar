import type { JSX } from 'react';

import { CookieSettingsButton } from '../CookieConsent';
import type { Language } from '../i18n';
import { EffectiveNotice, OperatorDetails, SupportLink } from './SharedLegal';

export function CookiePolicy({ language }: { readonly language: Language }): JSX.Element {
  return language === 'uk' ? <UkrainianCookiePolicy /> : <EnglishCookiePolicy />;
}

function UkrainianCookiePolicy(): JSX.Element {
  return (
    <article className="legal-document" lang="uk">
      <EffectiveNotice
        language="uk"
        documentName="Політика cookies і browser storage для FluxRadar, що надається під найменуванням FluxLab."
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
        <h2>Необхідне та preferences</h2>
        <p>
          Необхідні cookies і storage забезпечують вхід, безпеку, відновлення checkout та збереження
          самого вибору cookies. Вони працюють без окремої згоди, бо без них відповідна функція не
          може працювати належно. Preference storage запам’ятовує обрану мову лише після натискання
          «Дозволити preferences».
        </p>
        <p>
          FluxRadar зараз не завантажує Google Analytics 4, рекламні trackers, remarketing або
          Google Signals. Тому банер не містить удаваної категорії analytics. Якщо ми додамо
          необов’язкову аналітику, вона не запускатиметься до вашого дозволу, ця Політика буде
          оновлена, а в налаштуваннях з’явиться відповідний вибір. Для запланованої конфігурації
          Google Signals, ads personalization і remarketing мають бути вимкнені, а строк зберігання
          user/event data — 2 місяці.
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
                <td>Необхідний localStorage: записує ваш вибір щодо preferences.</td>
                <td>180 днів, після чого вибір запитується знову.</td>
              </tr>
              <tr>
                <td>
                  <code>fluxradar.language</code>
                </td>
                <td>Необов’язковий localStorage: запам’ятовує мову інтерфейсу на пристрої.</td>
                <td>До відкликання дозволу, очищення browser storage або зміни зберігання.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section id="cookies-providers" className="legal-section">
        <span className="legal-section__label">04 / FASTSPRING</span>
        <h2>Checkout стороннього провайдера</h2>
        <p>
          FastSpring є окремим merchant of record. Його checkout завантажується лише коли ви
          навмисно починаєте платну покупку. FastSpring може встановлювати власні необхідні cookies
          та storage для checkout, запобігання fraud, оплати й податкового розрахунку за своєю
          політикою приватності. FluxRadar не керує строками зберігання FastSpring.
        </p>
      </section>
      <section id="cookies-controls" className="legal-section">
        <span className="legal-section__label">05 / КЕРУВАННЯ</span>
        <h2>Як змінити вибір</h2>
        <p>
          Натисніть «Налаштування cookies» нижче, щоб дозволити або відкликати preferences. Поки
          preferences не дозволено, ця кнопка також є внизу кожної сторінки. Після відкликання
          FluxRadar видаляє збережену мову. Ви також можете очистити cookies та site data у
          браузері; видалення необхідного storage може завершити вхід або перервати відновлення
          незавершеного checkout.
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
        <h2>Necessary and preferences</h2>
        <p>
          Necessary cookies and storage support sign-in, security, checkout recovery and the cookie
          choice itself. They operate without separate consent because the requested function cannot
          work properly without them. Preference storage remembers the selected language only after
          you choose “Allow preferences”.
        </p>
        <p>
          FluxRadar does not currently load Google Analytics 4, advertising trackers, remarketing or
          Google Signals. The banner therefore does not display a fictitious analytics category. If
          we add optional analytics, it will not start before permission, this Policy will be
          updated and the corresponding choice will appear in cookie settings. The planned setup
          keeps Google Signals, ads personalization and remarketing disabled and sets user/event
          data retention to 2 months.
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
                <td>Essential localStorage: records your preference-storage choice.</td>
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
            </tbody>
          </table>
        </div>
      </section>
      <section id="cookies-providers" className="legal-section">
        <span className="legal-section__label">04 / FASTSPRING</span>
        <h2>Third-party checkout</h2>
        <p>
          FastSpring is the separate merchant of record. Its checkout loads only when you
          intentionally begin a paid purchase. FastSpring may set its own necessary cookies and
          storage for checkout, fraud prevention, payment and tax calculation under its privacy
          policy. FluxRadar does not control FastSpring’s retention periods.
        </p>
      </section>
      <section id="cookies-controls" className="legal-section">
        <span className="legal-section__label">05 / CONTROLS</span>
        <h2>How to change your choice</h2>
        <p>
          Select “Cookie settings” below to allow or withdraw preferences. Until preferences are
          allowed, the same button also sits at the bottom of every page. FluxRadar removes the
          saved language when permission is withdrawn. You can also clear cookies and site data in
          your browser; deleting necessary storage may sign you out or interrupt recovery of an
          unfinished checkout.
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
