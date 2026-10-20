import type { Language } from './i18n';
import { publicPagePath } from './public-page-routing';

export function AuditMethodology({ language }: { readonly language: Language }) {
  const uk = language === 'uk';
  return (
    <section id="methodology" className="legal-section">
      <h2>
        {uk
          ? 'Як FluxRadar проводить аудит і хто відповідає за сервіс'
          : 'How FluxRadar audits a site and who operates the service'}
      </h2>
      <p>
        {uk
          ? 'FluxRadar — онлайн-сервіс FluxLab для перевірки публічних сайтів. Він читає доступні сторінки без паролів до CMS, SSH чи бази даних. Complete також спостерігає публічні TLS-сертифікати та DNS TXT-політики. Це пасивні перевірки, а не тест на проникнення.'
          : 'FluxRadar is an online public website audit service operated by FluxLab. It reads accessible pages without CMS, SSH or database credentials. Complete also observes public TLS certificates and DNS TXT policies. These are passive checks, not penetration testing.'}
      </p>
      <p>
        {uk
          ? 'Обхід обмежений обраним пакетом, налаштуваннями, доступністю сайту та robots.txt. Звіт відокремлює знайдені проблеми від неперевірених і незастосовних сигналів. Для кожної знахідки він показує правило, доказ і рекомендоване виправлення; відсутність знахідок не є сертифікатом відповідності.'
          : 'The crawl is limited by the selected plan, settings, site availability and robots.txt. Reports distinguish findings from unverified and inapplicable signals. Each finding identifies a rule, evidence and a suggested fix; no findings is not a compliance certificate.'}
      </p>
      <p>
        {uk
          ? 'SEO-аудит описує технічні сигнали, а не гарантує індексацію чи позиції. Доступ AI-краулера та згадка бренду — різні вимірювання: відповіді моделей залежать від конкретних запитань, провайдера й часу запуску.'
          : 'An SEO audit describes technical signals and does not guarantee indexing or rankings. AI crawler access and brand mentions are separate measurements: model answers depend on the exact questions, provider and time of the run.'}
      </p>
      <p>
        {uk
          ? 'Basic: SEO, AI/GEO та план дій, до 5 000 URL. Complete: до 50 000 URL, додаткові модулі, історія й експорт. Це разова перевірка, а не автоматичний моніторинг.'
          : 'Basic includes SEO, AI/GEO and an Action Plan, up to 5,000 URLs. Complete supports up to 50,000 URLs, additional modules, history and export. Each purchase is one audit, not automatic monitoring.'}
      </p>
      <ul>
        <li>
          <a href={publicPagePath('exampleReport', language)}>
            {uk
              ? 'Приклад результату для вигаданого сайту'
              : 'Example deliverable for a fictional site'}
          </a>
        </li>
        <li>
          <a href="/knowledge-base/pokryttia-ta-bal">
            {uk ? 'Як читати покриття й оцінку' : 'Read coverage and scores (Ukrainian)'}
          </a>
        </li>
        <li>
          <a href="/knowledge-base/ai-kraulery">
            {uk
              ? 'Як перевірити видимість для AI без обіцянок цитування'
              : 'Check AI access without citation promises (Ukrainian)'}
          </a>
        </li>
        <li>
          <a href="/blog/uk/fluxradar-html-bez-javascript">
            {uk
              ? 'Власний кейс: що змінив повний HTML FluxRadar'
              : 'Our case: what full FluxRadar HTML changes (Ukrainian)'}
          </a>
        </li>
      </ul>
      <p>
        {uk
          ? 'Питання про методику або помилковий висновок: '
          : 'Questions about the method or a questionable finding: '}
        <a href="mailto:support@fluxradar.net">support@fluxradar.net</a>.{' '}
        <a href={publicPagePath('privacy', language)}>
          {uk ? 'Оператор і обробка даних' : 'Operator and data processing'}
        </a>
        .
      </p>
    </section>
  );
}
