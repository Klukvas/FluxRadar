import type { JSX } from 'react';

import { CookieSettingsButton } from '../CookieConsent';
import { EffectiveNotice, OperatorDetails, SupportLink, type EffectiveDate } from './SharedLegal';

// The Russian Cookie Policy, one of the three documents `CookiePolicy.tsx`
// chooses between. Moved out when the third locale took that file past the size
// anyone reviews; what the document says, and when it last changed, is recorded
// there.
//
// The effective date and the measurement-stream cookie name arrive as props
// rather than being read back out of `CookiePolicy.tsx`, so the dependency runs
// one way and the three documents cannot disagree about either.

export function RussianCookiePolicy({
  effectiveOn,
  sessionCookie,
}: {
  readonly effectiveOn: EffectiveDate;
  /** The GA cookie named after the measurement stream, which the inventory names exactly. */
  readonly sessionCookie: string;
}): JSX.Element {
  return (
    <article className="legal-document" lang="ru">
      <EffectiveNotice
        language="ru"
        documentName="Политика cookies и browser storage для FluxRadar, предоставляемого под наименованием FluxLab."
        effectiveOn={effectiveOn}
      />
      <section id="cookies-controller" className="legal-section">
        <span className="legal-section__label">01 / КТО ОТВЕЧАЕТ</span>
        <h2>Оператор и сфера действия</h2>
        <p>
          Эта Политика объясняет, какие cookies и browser storage использует FluxRadar на
          fluxradar.net, зачем они нужны, сколько хранятся и как ими управлять. Оператором сервиса
          является:
        </p>
        <OperatorDetails language="ru" />
      </section>
      <section id="cookies-categories" className="legal-section">
        <span className="legal-section__label">02 / КАТЕГОРИИ</span>
        <h2>Необходимое, preferences и аналитика</h2>
        <p>
          Необходимые cookies и storage обеспечивают вход, безопасность, восстановление checkout и
          сохранение самого выбора cookies. Они работают без отдельного согласия, потому что без них
          соответствующая функция не может работать должным образом.
        </p>
        <p>
          Две другие категории необязательны. «Принять всё» разрешает обе, а «Только необходимое»
          выключает их одним нажатием. «Настроить» открывает отдельные параметры и кнопку «Сохранить
          выбор». До вашего решения необязательное хранилище и аналитика не действуют. Preferences
          запоминают язык интерфейса. Аналитика загружает Google Analytics 4, см. раздел 04; сюда
          входит и измерение того, пришёл ли ваш визит из рекламы Google. FluxRadar не ведёт
          remarketing, не персонализирует рекламу и не включает Google Signals.
        </p>
        <p>
          Вне этих категорий мы считаем посещения без cookies через Plausible, см. раздел 05. Эта
          статистика не попадает в выбор выше, потому что не сохраняет в вашем браузере ничего, что
          потом можно прочитать, поэтому выключать в настройках cookies нечего. Её правовое
          основание не согласие, а наш законный интерес, и возразить против неё можно так, как
          описано в разделе 07.
        </p>
      </section>
      <section id="cookies-inventory" className="legal-section">
        <span className="legal-section__label">03 / РЕЕСТР</span>
        <h2>Что именно хранится</h2>
        <div className="legal-storage-table" role="region" aria-label="Реестр cookies и storage">
          <table>
            <thead>
              <tr>
                <th>Название</th>
                <th>Тип и цель</th>
                <th>Срок</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>fluxradar_session</code>
                </td>
                <td>Необходимый HTTP-only cookie для аутентификации и защиты аккаунта.</td>
                <td>
                  До закрытия browser session. Серверная сессия в любом случае истекает не позже чем
                  через 7 дней.
                </td>
              </tr>
              <tr>
                <td>
                  <code>fluxradar.pendingCheckout</code>
                </td>
                <td>
                  Необходимый localStorage: привязывает текущий checkout к аккаунту и позволяет
                  восстановить подтверждение платежа после reload или возврата со страницы checkout
                  Creem.
                </td>
                <td>До подтверждения, отмены или очистки текущего checkout.</td>
              </tr>
              <tr>
                <td>
                  <code>fluxradar.cookieConsent</code>
                </td>
                <td>Необходимый localStorage: записывает ваш выбор по preferences и аналитике.</td>
                <td>180 дней, после чего выбор запрашивается снова.</td>
              </tr>
              <tr>
                <td>
                  <code>fluxradar.verifyBannerHidden</code>
                </td>
                <td>
                  Необходимый sessionStorage: запоминает, что вы скрыли сообщение «подтвердите
                  email», и хранит идентификатор аккаунта, который его скрыл.
                </td>
                <td>До закрытия вкладки или сеанса браузера.</td>
              </tr>
              <tr>
                <td>
                  <code>fluxradar.language</code>
                </td>
                <td>Необязательный localStorage: запоминает язык интерфейса на устройстве.</td>
                <td>До отзыва разрешения, очистки browser storage или смены хранения.</td>
              </tr>
              <tr>
                <td>
                  <code>_ga</code>
                </td>
                <td>
                  Необязательный cookie Google Analytics 4 после разрешения аналитики: случайный
                  идентификатор, который отличает посетителей.
                </td>
                <td>
                  До 180 дней от последнего визита. Удаляется, как только вы отзываете аналитику,
                  или при следующем визите после того, как разрешение истекло.
                </td>
              </tr>
              <tr>
                <td>
                  <code>{sessionCookie}</code>
                </td>
                <td>
                  Необязательный cookie Google Analytics 4 после разрешения аналитики: состояние
                  текущего визита.
                </td>
                <td>
                  Так же, как <code>_ga</code>.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section id="cookies-analytics" className="legal-section">
        <span className="legal-section__label">04 / GOOGLE ANALYTICS</span>
        <h2>Аналитика сайта</h2>
        <p>
          Google Analytics 4 не загружается, пока вы не разрешите аналитику: до этого браузер даже
          не обращается к Google. После разрешения мы видим, какие страницы посещают, откуда
          приходят посетители и на каких шагах они останавливаются: регистрация и вход, запуск
          проверки, завершённая проверка, просмотр отчёта, выбор или смена тарифа, начало оплаты,
          завершённая покупка (тариф и цена, без данных карты).
        </p>
        <p>
          Мы запускаем поисковую рекламу Google. Когда вы переходите из объявления, Google добавляет
          к ссылке свой идентификатор клика (gclid), и Google Analytics 4 считывает его из адреса
          страницы, на которую вы попали. Именно так визит распознаётся как рекламный, и Google
          Analytics передаёт это измерение в Google Ads, чтобы приписать кампании регистрации и
          покупки, которые она принесла. Идентификатор есть только в адресе этой первой страницы, а
          последующие страницы передаются без него. Мы не ведём remarketing и не персонализируем
          рекламу, Google Signals остаётся выключенным, рекламный тег Google Ads на сайт не
          загружается, и ничего из этого никому не продаётся.
        </p>
        <p>
          Кроме этого идентификатора, адреса страниц передаются без query string и идентификаторов
          проверок, поэтому ссылки для подтверждения email или восстановления пароля и домены,
          которые вы проверяете, в Google не попадают. Google Signals, ads personalization и
          remarketing выключены, а user и event data хранятся 2 месяца. Google обрабатывает эти
          данные как наш обработчик; см.{' '}
          <a href="https://policies.google.com/technologies/partner-sites">
            как Google использует данные сайтов, которые пользуются его сервисами
          </a>
          .
        </p>
      </section>
      <section id="cookies-plausible" className="legal-section">
        <span className="legal-section__label">05 / PLAUSIBLE</span>
        <h2>Подсчёт посещений без cookies</h2>
        <p>
          Plausible считает посещения сайта для всех и не спрашивает согласия, потому что не
          устанавливает cookies и вообще ничего не записывает в ваш браузер. На устройстве он читает
          только отметку
          <code> plausible_ignore</code> в localStorage, которой вы сами можете отказаться от
          подсчёта. Статистику обрабатывает Plausible Insights OÜ (Эстония); данные хранятся и
          обрабатываются только в ЕС.
        </p>
        <p>
          Передаётся адрес страницы без query string и идентификаторов проверок, сайт, с которого вы
          перешли, страна, регион и город по IP‑адресу, тип устройства, браузер, операционная
          система и размер экрана, а также время на странице и глубина прокрутки. Кроме просмотров
          страниц, Plausible подсчитывает три шага в продукте: завершённую регистрацию, запрос
          бесплатной проверки и завершённую покупку. Каждый из них передаётся как название шага и
          страница, на которой он произошёл, с теми же деталями посещения, что и просмотр страницы.
          Параметров нет никаких: ни тарифа, ни цены, ни того, вошли ли вы в аккаунт, и вообще
          ничего о вас. IP‑адрес и user agent нужны только чтобы вычислить дневной идентификатор как
          хеш с секретной солью; сама соль уничтожается каждые 24 часа, а ни IP‑адрес, ни user agent
          не сохраняются. Поэтому тот же человек на следующий день уже не распознаётся, и между
          сайтами или устройствами его не отслеживают. Идентификатор клика Google (gclid) в
          Plausible не передаётся.
        </p>
        <p>
          Правовым основанием является наш законный интерес по пункту (f) части 1 статьи 6 GDPR: мы
          хотим знать, сколько посещений у сайта и какие страницы читают. Сводная статистика
          посещений хранится в Plausible, пока FluxRadar им пользуется, и мы удаляем её, когда
          прекращаем пользоваться сервисом или по запросу. В ней нет ни IP‑адресов, ни cookies, ни
          идентификаторов, поэтому связать её с человеком невозможно. Браузер обращается к Plausible
          только через домен fluxradar.net, потому что и скрипт, и события проходят через наш
          сервер. См. <a href="https://plausible.io/data-policy">Data Policy Plausible</a>.
        </p>
      </section>
      <section id="cookies-providers" className="legal-section">
        <span className="legal-section__label">06 / CREEM</span>
        <h2>Checkout стороннего провайдера</h2>
        <p>
          Creem является отдельным merchant of record. Оплата происходит на странице checkout,
          которую Creem размещает на собственном домене: FluxRadar перенаправляет вас туда только
          когда вы намеренно начинаете платную покупку, а после оплаты возвращает на fluxradar.net.
          На страницах FluxRadar Creem не загружает скриптов и не устанавливает cookies. На
          собственных страницах Creem может устанавливать необходимые cookies и storage для
          checkout, предотвращения fraud, оплаты и налогового расчёта по своей{' '}
          <a href="https://creem.io/privacy">политике приватности</a>. FluxRadar не управляет
          сроками хранения Creem.
        </p>
      </section>
      <section id="cookies-controls" className="legal-section">
        <span className="legal-section__label">07 / УПРАВЛЕНИЕ</span>
        <h2>Как изменить выбор</h2>
        <p>
          Нажмите «Настройки cookies» ниже, чтобы включить или выключить preferences и аналитику.
          Пока разрешено не всё, эта кнопка также есть внизу каждой страницы. После отзыва FluxRadar
          удаляет сохранённый язык, останавливает Google Analytics и удаляет его cookies. Вы также
          можете очистить cookies и site data в браузере; удаление необходимого storage может
          завершить вход или прервать восстановление незавершённого checkout.
        </p>
        <p>
          Подсчёт посещений без cookies в эту кнопку не входит, потому что не зависит от согласия.
          Отказаться от него в конкретном браузере можно так, как это описывает Plausible: откройте
          консоль разработчика на fluxradar.net и выполните{' '}
          <code>localStorage.plausible_ignore=true</code>. После этого Plausible перестаёт считать
          ваши посещения в этом браузере, а вернуть подсчёт можно командой{' '}
          <code>delete localStorage.plausible_ignore</code>. Отметку нужно ставить в каждом браузере
          отдельно, см.{' '}
          <a href="https://plausible.io/docs/excluding-localstorage">
            инструкцию Plausible по localStorage
          </a>
          . Можно также написать на <SupportLink /> и возразить против этой обработки.
        </p>
        <div className="button-row">
          <CookieSettingsButton language="ru" />
        </div>
        <p>
          Вопросы или запросы по cookies отправляйте на <SupportLink />. Украинская версия имеет
          юридический приоритет; переводы предоставляются для удобства.
        </p>
      </section>
    </article>
  );
}
