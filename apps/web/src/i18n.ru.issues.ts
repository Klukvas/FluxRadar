// The Issue Center's own chrome, in Russian.
//
// The table around the findings: its heading, its filters, its column names
// and the labels over one finding's evidence. The finding itself — the rule's
// name, the excerpt, the recommendation — is written in the report's language
// and stays Ukrainian for a Russian reader (`report-language.ts`), and so does
// the problem view's own copy in `findings-copy.ts`.

import { takesRuSingular } from './i18n.ru.grammar';

export const russianIssuesCopy = {
  windowTitle: 'Центр проблем',
  noScan: 'без проверки',
  heading: 'Находки и доказательства',
  filterLabel: 'Фильтр',
  filterPlaceholder: 'правило, раздел, URL',
  severityLegendTerm: 'Серьёзность',
  severityLegendBody: 'показывает, когда браться за проблему.',
  emptyFiltered: 'Ни одна находка не подходит под фильтр',
  emptyFilteredBody:
    'Попробуйте другое правило, раздел или URL либо сбросьте фильтры и просмотрите всё.',
  clearFilters: 'Сбросить фильтры',
  emptyAll: 'В этом отчёте нет находок',
  emptyAllBody:
    'FluxRadar не обнаружил ничего, что стоило бы внимания, на страницах, которые смог прочитать.',
  columnSeverity: 'Серьёзность',
  columnRule: 'Правило',
  columnTarget: 'Страница',
  columnStatus: 'Статус',
  columnAction: 'Действие',
  details: 'Объяснение и доказательство',
  hideDetails: 'Скрыть объяснение',
  evidence: 'Доказательство',
  noExcerpt: 'Фрагмент недоступен',
  recommendation: 'Рекомендация',
  impact: 'Затронуто страниц',
  // The noun and the participle after «из» both follow the numeral: «из 1
  // страницы, проверенной на это», «из 2 страниц, проверенных на это».
  impactValue: (affected: number, applicable: number) =>
    takesRuSingular(applicable)
      ? `${affected} из ${applicable} страницы, проверенной на это`
      : `${affected} из ${applicable} страниц, проверенных на это`,
  impactTargets: 'Затронуто мест',
  impactTargetsValue: (affected: number, applicable: number) =>
    takesRuSingular(applicable)
      ? `${affected} из ${applicable} места, проверенного на это`
      : `${affected} из ${applicable} мест, проверенных на это`,
  scoreEffect: 'Влияние на оценку',
  scoreEffectValue: 'Снижает оценку этого раздела на {delta}',
  scoreEffectNone: 'Оценку не меняет',
  confidence: 'Насколько мы уверены в находке',
  ruleIdLabel: 'Код проверки, для поддержки',
  ruleNameLabel: 'Как называется эта проверка',
} as const;
