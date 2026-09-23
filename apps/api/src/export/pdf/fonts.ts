// The fonts the PDF embeds, resolved from disk and never from the network.
//
// TWO REASONS THIS IS NOT PDFKIT'S BUILT-IN HELVETICA. The built-in fonts are
// WinAnsi-encoded, which has no Cyrillic: a Ukrainian report — the product ships
// one — would render as a page of question marks. And a font fetched at render
// time would make report generation depend on a third-party host and give a
// crafted report URL something to point at. DejaVu Sans ships as a TTF inside a
// dependency of this package, is resolved through Node's own module resolution,
// and is read from the local filesystem.
//
// PDFKit subsets an embedded TTF and writes a ToUnicode map for it, so the text
// stays selectable and searchable in the produced file.

import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);

/** The three faces the report uses. Nothing else is registered. */
export const REPORT_FONTS = {
  body: 'dejavu-fonts-ttf/ttf/DejaVuSans.ttf',
  bold: 'dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf',
  /** Evidence, URLs and rule identifiers, where alignment carries meaning. */
  mono: 'dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf',
} as const;

export type ReportFontName = keyof typeof REPORT_FONTS;

/**
 * Absolute paths to the font files, or a thrown error naming the missing one.
 *
 * Resolving eagerly is deliberate: a missing font must fail when the renderer is
 * built, with the package name in the message, rather than halfway through a
 * customer's download.
 */
export function resolveReportFonts(): Readonly<Record<ReportFontName, string>> {
  const entries = Object.entries(REPORT_FONTS).map(([name, specifier]) => {
    try {
      return [name, require_.resolve(specifier)] as const;
    } catch {
      throw new Error(
        `PDF report font ${specifier} could not be resolved; is dejavu-fonts-ttf installed?`,
      );
    }
  });
  return Object.fromEntries(entries) as Record<ReportFontName, string>;
}
