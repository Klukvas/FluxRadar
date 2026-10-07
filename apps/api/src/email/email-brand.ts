// Inline-CSS tokens for transactional email HTML, kept separate from
// apps/web/src/styles/tokens.css because email needs email-safe font stacks
// (no Chicago/Charcoal, no system-ui) while matching the same brand colors —
// see apps/web/src/styles/tokens.css and the `.terminal` component it feeds.

export const EMAIL_COLOR = {
  desktop: '#66799b',
  terminalBg: '#101410',
  terminalGreen: '#33ff66',
  ink900: '#111111',
  ink600: '#555555',
  plat50: '#efefef',
  plat400: '#888888',
  selection: '#333399',
  linkInk: '#16327a',
} as const;

// Single-quoted multi-word names: these stacks are interpolated into
// double-quoted HTML style="" attributes, where a literal `"` would close
// the attribute early and corrupt the rest of the tag.
export const EMAIL_MONO_FONT_STACK =
  "'SFMono-Regular', Consolas, Menlo, Monaco, 'Courier New', monospace";

export const EMAIL_UI_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
