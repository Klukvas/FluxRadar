# FluxRadar Accessibility Audit

## Product decision

Accessibility is a first-class Complete Scan module with **WCAG 2.2 AA** as the
target. WCAG 2.2 is the current W3C recommendation and adds criteria for focus
visibility, dragging, target size, consistent help, redundant entry and
accessible authentication.

FluxRadar reports an automated audit, not legal certification. Every result is
interpreted as `Passed`, `Failed`, or a case that requires manual review. A
static crawler cannot prove behavior that depends on JavaScript, computed
styles, viewport geometry, focus movement, assistive technology output, or a
multi-step form state.

## Implemented automated checks

| Rule | WCAG area | Automated oracle |
|---|---|---|
| A11Y-001 | 1.4.3 Contrast (Minimum) | Explicit inline foreground/background color pairs below the applicable threshold. External and computed CSS remains manual review. |
| A11Y-002 | 1.1.1 Non-text Content | Content images without `alt`; explicit empty `alt` remains valid for decorative images. |
| A11Y-003 | 1.3.1, 2.4.6, 3.1.1 | Missing document language, zero/multiple `h1`, or skipped heading levels. |
| A11Y-004 | 1.3.1, 3.3.2 | Form controls without `label`, wrapping label, `aria-label`, or `aria-labelledby`. |
| A11Y-005 | 2.1.1, 2.1.2, 2.5.7 | Positive `tabindex` and mouse-only inline handlers on non-interactive elements. |
| A11Y-006 | 2.4.7, 2.4.11 | Focus outline explicitly removed without a detectable border or shadow replacement. |
| A11Y-007 | 4.1.2 | Unknown role, broken ARIA ID reference, or focusable content hidden with `aria-hidden`. |
| A11Y-008 | 2.4.4, 4.1.2 | Missing `href` or accessible name on links, buttons, summaries, and submit-like inputs. |
| A11Y-009 | 3.3.1, 3.3.3 | `aria-invalid="true"` without an associated error description. |
| A11Y-010 | 1.2.2, 1.3.1 | Missing/duplicate `main`, unnamed repeated navigation, iframe title, or video captions. |
| A11Y-011 | Reporting contract | Keeps the report transparent about automation boundaries and non-legal status without creating a penalty issue. |

Rules produce normal FluxRadar evidence: target URL, stable selector,
excerpt, recommendation, severity and fingerprint. The Accessibility module is
included in Complete; existing Free and Basic tariff boundaries are unchanged.

## Manual-review boundary

The report explicitly calls out the cases that cannot be established from a
public HTTP crawl alone:

- computed contrast, reflow, target size and focus obscured by fixed overlays;
- keyboard-only completion, focus order and keyboard traps;
- screen-reader announcements and accessible names after runtime DOM updates;
- drag alternatives, consistent help, redundant entry and authentication flows;
- client-side validation messages and error recovery after submission;
- SPA routes or content that only appears after JavaScript interaction.

EN 301 549 and Section 508 are report profiles mapped to the same automated
WCAG evidence; they do not create a second duplicate rule engine. The next
rendering phase can add a browser-backed runner (viewport profiles,
computed styles, screenshots and axe-compatible checks), but it must remain
separate from the deterministic HTTP rule engine and retain the same
`Passed`/`Failed`/`Needs manual review` semantics.

## Acceptance criteria

- Every A11Y-001..011 rule has a stable descriptor and implementation.
- Positive and negative tests cover each automated oracle.
- Existing issue fingerprints, severity resolution and score contracts remain
  deterministic.
- Complete results show the WCAG 2.2 AA scope and non-certification notice.
- Missing runtime evidence never becomes a false pass or an artificial score
  penalty.
