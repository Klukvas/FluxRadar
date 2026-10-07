// Shared HTML shell for account emails (verification, password reset).
//
// Built as nested tables with inline styles on purpose: no external stylesheet,
// no webfont, no image, no script — the set of things an email client is
// guaranteed to render. The look mirrors the product's own "window floating on
// the desktop" composition (apps/web/src/styles/base.css `.desktop` / `.window`
// / `.terminal`) so an account email reads as unmistakably FluxRadar rather
// than a generic transactional template.

import { emailText } from './mailer.ts';
import { EMAIL_COLOR, EMAIL_MONO_FONT_STACK, EMAIL_UI_FONT_STACK } from './email-brand.ts';

export interface EmailLayoutOptions {
  readonly title: string;
  readonly preheader: string;
  readonly heading: string;
  readonly introText: string;
  readonly ctaLabel: string;
  readonly ctaUrl: string;
  readonly expiryNote: string;
  readonly ignoreNote: string;
}

/** Padding that keeps the preview-text snippet from falling back to page content. */
function preheaderPadding(): string {
  return '&nbsp;&zwnj;'.repeat(40);
}

export function renderEmailLayout(options: EmailLayoutOptions): string {
  const ctaUrl = emailText(options.ctaUrl);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${options.title}</title>
<!--[if mso]>
<style>table,td,div,h1,p,a{font-family:Arial,sans-serif;}</style>
<![endif]-->
<style>
  @media screen and (max-width: 480px) {
    .fr-card { padding: 24px 20px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_COLOR.desktop};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${options.preheader}${preheaderPadding()}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${EMAIL_COLOR.desktop};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
<tr>
<td style="background-color:${EMAIL_COLOR.terminalBg};border:1px solid ${EMAIL_COLOR.terminalBg};padding:14px 24px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:26px;height:26px;border:1px solid ${EMAIL_COLOR.terminalGreen};text-align:center;vertical-align:middle;font-family:${EMAIL_MONO_FONT_STACK};font-size:14px;line-height:26px;color:${EMAIL_COLOR.terminalGreen};font-weight:bold;">&gt;</td>
<td style="padding-left:10px;font-family:${EMAIL_MONO_FONT_STACK};font-size:16px;font-weight:bold;letter-spacing:0.04em;color:${EMAIL_COLOR.terminalGreen};">FluxRadar</td>
</tr></table>
</td>
</tr>
<tr>
<td class="fr-card" style="background-color:#ffffff;border:1px solid ${EMAIL_COLOR.ink900};border-top:0;padding:32px 28px;">
<h1 style="margin:0 0 16px;font-family:${EMAIL_UI_FONT_STACK};font-size:21px;line-height:1.3;color:${EMAIL_COLOR.ink900};">${options.heading}</h1>
<p style="margin:0 0 24px;font-family:${EMAIL_UI_FONT_STACK};font-size:14px;line-height:1.6;color:${EMAIL_COLOR.ink900};">${options.introText}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
<tr><td style="background-color:${EMAIL_COLOR.selection};border-radius:2px;">
<a href="${ctaUrl}" style="display:inline-block;padding:13px 30px;font-family:${EMAIL_UI_FONT_STACK};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:2px;">${options.ctaLabel}</a>
</td></tr>
</table>
<p style="margin:0 0 20px;font-family:${EMAIL_UI_FONT_STACK};font-size:13px;line-height:1.5;color:${EMAIL_COLOR.ink600};">${options.expiryNote}</p>
<p style="margin:0 0 6px;font-family:${EMAIL_UI_FONT_STACK};font-size:12px;color:${EMAIL_COLOR.ink600};">If the button doesn't work, copy this link into your browser:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
<tr><td style="background-color:${EMAIL_COLOR.plat50};border:1px solid ${EMAIL_COLOR.plat400};padding:10px 12px;font-family:${EMAIL_MONO_FONT_STACK};font-size:12px;line-height:1.5;color:${EMAIL_COLOR.linkInk};word-break:break-all;">${ctaUrl}</td></tr>
</table>
<p style="margin:0;font-family:${EMAIL_UI_FONT_STACK};font-size:12px;line-height:1.5;color:${EMAIL_COLOR.ink600};">${options.ignoreNote}</p>
</td>
</tr>
<tr>
<td style="background-color:${EMAIL_COLOR.plat50};border:1px solid ${EMAIL_COLOR.plat400};border-top:0;padding:12px 24px;text-align:center;font-family:${EMAIL_MONO_FONT_STACK};font-size:11px;letter-spacing:0.04em;color:${EMAIL_COLOR.ink600};">FluxRadar — automated site audits</td>
</tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
