// The action plan, on its own page after the summary: what the plan covers,
// what the scan could not see, then one card per action.
//
// Nothing here prints when the loader returns null: the no-plan and not-ready
// documents are the same document, byte for byte.

import { brandedProvenance } from './branding.ts';
import type { ReportCopy } from './copy.ts';
import type { ReportDocument } from './document.ts';
import { storedTimestamp } from './report-format.ts';
import type { ActionPlanAction, ActionPlanProjection, RenderReportOptions } from './render.ts';

const CIRCLE_RADIUS = 9;
const CARD_INDENT = 28;
const STEP_INDENT = 36;
const CARD_RESERVE_CAP = 160;
const PILL = { minWidth: 88, height: 13, radius: 6, padding: 16 } as const;
const REACH_BAR_WIDTH = 100;
const LINK_LINE_HEIGHT = 14;

/**
 * The ready plan for this scan, account and language, or null. Read before
 * page one is drawn, because page one says whether a plan follows.
 */
export async function loadPlan(options: RenderReportOptions): Promise<ActionPlanProjection | null> {
  const plan = await options.loadActionPlan?.({
    scanId: options.scan.id,
    accountId: options.scan.accountId,
    language: options.language,
  });
  return plan === undefined || plan === null || plan.actions.length === 0 ? null : plan;
}

/** Writes the plan from a new page; returns that page's number. */
export function actionPlanSection(
  doc: ReportDocument,
  plan: ActionPlanProjection,
  copy: ReportCopy,
): number {
  doc.newPage();
  const page = doc.pageNumber;
  doc.heading(copy.actionPlanHeading, 2);
  doc.text(plan.overview, { size: 10, lineGap: 5 });
  doc.moveTo(doc.y + 6);
  // What the plan does NOT cover, stated before the actions rather than after:
  // a plan that addresses a fifth of the open findings is useful, and a reader
  // who thinks it addresses all of them has been misled by its confidence.
  // A plan over zero open findings has no reach to state.
  if (plan.reach.totalOpenIssues > 0) reachRow(doc, plan, copy);
  // And what the scan could not see at all when the plan was written. The web
  // report states these above the plan; a document that dropped them would read
  // as the more confident of the two for no reason.
  if (plan.caveats.length > 0) doc.bullets(plan.caveats, { colour: 'muted', size: 9 });
  doc.moveTo(doc.y + 6);
  plan.actions.forEach((action, index) => actionCard(doc, action, index + 1, copy));
  // Who wrote it and when, in the reader's words. Model and prompt ids are
  // ours to keep: they mean nothing to the reader and name the vendor.
  const provenance = brandedProvenance(copy, storedTimestamp(plan.metadata.generatedAt));
  doc.text(provenance, { size: 8, colour: 'muted' });
  return page;
}

function reachRow(doc: ReportDocument, plan: ActionPlanProjection, copy: ReportCopy): void {
  const sentence = copy.actionPlanReach(plan.reach.addressedOpenIssues, plan.reach.totalOpenIssues);
  const textWidth = doc.contentWidth - REACH_BAR_WIDTH - 30;
  const height = Math.max(26, doc.heightOf(sentence, { size: 8.5, width: textWidth }) + 16);
  doc.reserve(height + 8);
  const top = doc.y;
  const left = doc.contentLeft;
  doc.fillRect(left, top, doc.contentWidth, height, 'band', 3);
  doc.textAt(sentence, left + 10, top + 8, { size: 8.5, colour: 'muted', width: textWidth });
  const barX = left + doc.contentWidth - REACH_BAR_WIDTH - 10;
  const barY = top + height / 2 - 3.5;
  const total = plan.reach.totalOpenIssues;
  const share = total > 0 ? Math.min(1, plan.reach.addressedOpenIssues / total) : 0;
  doc.fillRect(barX, barY, REACH_BAR_WIDTH, 7, 'rule', 2);
  if (share > 0) doc.fillRect(barX, barY, Math.max(7, REACH_BAR_WIDTH * share), 7, 'structure', 2);
  doc.moveTo(top + height + 8);
}

function cardHeight(doc: ReportDocument, action: ActionPlanAction): number {
  const width = doc.contentWidth - CARD_INDENT;
  const stepWidth = doc.contentWidth - STEP_INDENT;
  const steps = action.steps.reduce(
    (sum, step) =>
      sum + doc.heightOf(`•  ${step}`, { size: 9.5, width: stepWidth, lineGap: 2 }) + 1,
    0,
  );
  return (
    doc.heightOf(action.title, { font: 'bold', size: 11, width }) +
    3 +
    doc.heightOf(action.why, { size: 9.5, width, lineGap: 2 }) +
    4 +
    steps +
    LINK_LINE_HEIGHT +
    PILL.height +
    30
  );
}

/** One action: numbered circle, title, why, steps, then effort and progress. */
function actionCard(
  doc: ReportDocument,
  action: ActionPlanAction,
  number: number,
  copy: ReportCopy,
): void {
  doc.reserve(Math.min(cardHeight(doc, action), CARD_RESERVE_CAP));
  const top = doc.y;
  const left = doc.contentLeft;
  doc.fillCircle(left + CIRCLE_RADIUS, top + 7, CIRCLE_RADIUS, 'structure');
  doc.textAt(String(number), left, top + 2.5, {
    font: 'bold',
    size: 9,
    colour: 'white',
    width: CIRCLE_RADIUS * 2,
    align: 'center',
  });
  doc.text(action.title, { font: 'bold', size: 11, indent: CARD_INDENT });
  doc.moveTo(doc.y + 3);
  doc.text(action.why, { size: 9.5, indent: CARD_INDENT, lineGap: 2 });
  doc.moveTo(doc.y + 4);
  for (const step of action.steps) {
    doc.reserve(16);
    doc.text(`•  ${step}`, { size: 9.5, indent: STEP_INDENT, lineGap: 2 });
    doc.moveTo(doc.y + 1);
  }
  linkLine(doc, action, copy);
  doc.moveTo(doc.y + 4);
  effortRow(doc, action, copy);
}

/**
 * The link from the plan to the findings: which rule ids the action closes
 * (the developer looks them up under Findings) and, while some of its
 * findings are closed already, how many are still open.
 */
function linkLine(doc: ReportDocument, action: ActionPlanAction, copy: ReportCopy): void {
  const parts = [
    ...(action.ruleIds.length > 0 ? [copy.actionPlanCovers(action.ruleIds.join(', '))] : []),
    ...progressText(action, copy),
  ];
  if (parts.length === 0) return;
  doc.moveTo(doc.y + 2);
  doc.text(parts.join(' · '), { size: 8, colour: 'muted', indent: CARD_INDENT });
}

function effortRow(doc: ReportDocument, action: ActionPlanAction, copy: ReportCopy): void {
  doc.reserve(PILL.height + 30);
  const y = doc.y;
  const x = doc.contentLeft + CARD_INDENT;
  const effort = copy.actionPlanEffort[action.effort];
  const pillWidth = Math.max(PILL.minWidth, doc.widthOf(effort, 'body', 7.5) + PILL.padding);
  doc.strokeRect(x, y - 1, pillWidth, PILL.height, {
    radius: PILL.radius,
    colour: 'muted',
    lineWidth: 0.6,
  });
  doc.textAt(effort, x, y + 1.5, { size: 7.5, colour: 'muted', width: pillWidth, align: 'center' });
  const ruleY = y + PILL.height + 9;
  doc.line([doc.contentLeft, ruleY], [doc.contentLeft + doc.contentWidth, ruleY], 'rule', 0.5);
  doc.moveTo(ruleY + 14);
}

/** How far along the action is; nothing while every one of its findings is open. */
function progressText(action: ActionPlanAction, copy: ReportCopy): readonly string[] {
  if (action.settled) return [copy.actionPlanSettled];
  if (action.openIssues < action.totalIssues) {
    return [copy.actionPlanProgress(action.openIssues, action.totalIssues)];
  }
  return [];
}
