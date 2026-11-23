// Slides two to five of the home page slider: what the made-up salon's report
// says about AI assistants, security, the action plan and the developer
// message. The salon's data is `example-offer-fixture.ts`; the counts and plan
// names are `hero-offer-content.ts`; this file only lays them out, in the
// platinum window's own finding rows so the five slides read as one report.

import { actionPlanCopy } from './action-plan-copy';
import { exampleProblemTitles } from './example-report-content';
import {
  EXAMPLE_AI_ANSWERS,
  EXAMPLE_AI_QUESTION,
  EXAMPLE_DEVELOPER_TASK,
  EXAMPLE_PLAN_STEPS,
  EXAMPLE_SECURITY_ROWS,
  type ExampleSecurityRow,
} from './example-offer-fixture';
import { Button } from './components';
import { useClipboardCopy } from './FindingExplainer';
import { findingsCopy } from './findings-copy';
import { geoProviderLabel } from './geo-provider-label';
import { SlideHead, SlideIncludes } from './HeroOfferSlideParts';
import {
  AI_ASKED_COUNT,
  AI_OPTIONAL_COUNT,
  optionalAssistantsLabel,
  paidPlansWithActionPlan,
  paidPlansWithModule,
  plansCaption,
  SECURITY_CHECK_COUNT,
} from './hero-offer-content';
import { heroOfferCopy } from './hero-offer-copy';
import type { Language } from './i18n';

export function AiAnswersSlide(props: { language: Language }) {
  const t = heroOfferCopy[props.language].ai;
  return (
    <>
      <SlideHead title={t.title} lead={t.lead} />
      <p className="hero-offer__asked">
        <span>{t.questionLabel}</span> «{EXAMPLE_AI_QUESTION[props.language]}»
      </p>
      <ul className="home-hero__findings" role="list">
        {EXAMPLE_AI_ANSWERS.map((answer) => (
          <li key={answer.provider} className="home-hero__finding home-hero__finding--ok">
            <div className="hero-offer__row">
              <strong>{geoProviderLabel(answer.provider, props.language)}</strong>
              <span className="home-hero__chip">{t.mentioned}</span>
            </div>
            <p className="home-hero__todo">{t.cited(answer.citedPage)}</p>
          </li>
        ))}
        <li className="home-hero__finding home-hero__finding--off">
          <div className="hero-offer__row">
            <strong>{optionalAssistantsLabel(props.language)}</strong>
            <span className="home-hero__chip">{t.optInChip}</span>
          </div>
          <p className="home-hero__todo">{t.optInDetail}</p>
        </li>
      </ul>
      <SlideIncludes
        lead={t.includes(AI_ASKED_COUNT, AI_OPTIONAL_COUNT)}
        plans={plansCaption(paidPlansWithModule('AI SEO / GEO'), props.language)}
      />
    </>
  );
}

function SecurityRow(props: { row: ExampleSecurityRow; language: Language }) {
  const t = heroOfferCopy[props.language].security;
  const finding = t.rows[props.row.ruleId];
  if (finding === undefined) {
    throw new Error(`the home slider has no ${props.language} words for ${props.row.ruleId}`);
  }
  return (
    <li className="home-hero__finding home-hero__finding--ok">
      <span className="home-hero__chip">{t.passed}</span>
      <p className="home-hero__problem">{finding}</p>
    </li>
  );
}

export function SecuritySlide(props: { language: Language }) {
  const t = heroOfferCopy[props.language].security;
  return (
    <>
      <SlideHead title={t.title} lead={t.lead} />
      <ul className="home-hero__findings" role="list">
        {EXAMPLE_SECURITY_ROWS.map((row) => (
          <SecurityRow key={row.ruleId} row={row} language={props.language} />
        ))}
      </ul>
      <SlideIncludes
        lead={t.includes(SECURITY_CHECK_COUNT)}
        plans={plansCaption(paidPlansWithModule('Security'), props.language)}
      />
    </>
  );
}

export function ActionPlanSlide(props: { language: Language }) {
  const t = heroOfferCopy[props.language].plan;
  const titles = exampleProblemTitles[props.language];
  return (
    <>
      <SlideHead title={t.title} lead={t.lead} />
      <ol className="hero-offer__steps">
        {EXAMPLE_PLAN_STEPS.map((step) => (
          <li key={step.ruleId} className="hero-offer__step">
            <p className="home-hero__problem">{titles[step.ruleId] ?? step.ruleId}</p>
            <p className="home-hero__todo">
              {actionPlanCopy[props.language].openIssues(step.open, step.total)}
            </p>
          </li>
        ))}
      </ol>
      <SlideIncludes
        lead={t.includes}
        plans={plansCaption(paidPlansWithActionPlan(), props.language)}
      />
    </>
  );
}

/** Logged with a refused copy, in place of the rule id a report's button logs. */
const EXAMPLE_TASK_LOG_ID = 'home-slider-example';

/**
 * What the copy button did, in a line whose height is reserved from the start:
 * every message it can say sits in the same grid cell, hidden, so the slide
 * is as tall before a click as after it and the window never grows.
 */
function CopyStatus(props: { message: string; messages: readonly string[] }) {
  return (
    <div className="hero-offer__copy-status">
      <p role="status">{props.message}</p>
      {props.messages.map((message) => (
        <p key={message} className="hero-offer__copy-sizer" aria-hidden="true">
          {message}
        </p>
      ))}
    </div>
  );
}

export function DeveloperTaskSlide(props: { language: Language }) {
  const t = heroOfferCopy[props.language].developer;
  const task = EXAMPLE_DEVELOPER_TASK[props.language];
  const taskCopy = findingsCopy[props.language].task;
  const { state, copy } = useClipboardCopy(task.text, EXAMPLE_TASK_LOG_ID);
  const isFailed = state === 'failed';
  const message = state === 'copied' ? taskCopy.copied : isFailed ? t.copyFailed : '';
  return (
    <>
      <SlideHead title={t.title} lead={t.lead} />
      {/* On a refused copy the whole message, selectable, covers the extract
          in the same box: the box keeps the extract's size, so the slide
          does not grow, and the message scrolls inside it. */}
      <div className="hero-offer__note">
        <div
          className={isFailed ? 'hero-offer__note-extract is-covered' : 'hero-offer__note-extract'}
        >
          <p>
            <b>{task.heading}</b>
          </p>
          <p>{task.where}</p>
          <p>{task.whatToDo}</p>
        </div>
        {isFailed ? (
          <textarea
            className="hero-offer__note-full"
            aria-label={taskCopy.textLabel}
            readOnly
            value={task.text}
            onFocus={(event) => event.currentTarget.select()}
          />
        ) : null}
      </div>
      {/* The report's own button: the slide shows an extract, and the button
          copies the whole message. */}
      <div className="hero-offer__copy-row">
        <Button onClick={() => void copy()}>{taskCopy.copy}</Button>
        <CopyStatus message={message} messages={[taskCopy.copied, t.copyFailed]} />
      </div>
      <SlideIncludes lead={t.includes} />
    </>
  );
}
