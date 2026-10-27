import type { PrismaClient, ReportBranding } from '@prisma/client';

export type ReportBrand = Readonly<{
  displayName: string;
  accent: string | null;
  contactLine: string | null;
  logo: Readonly<{ png: Uint8Array; width: number; height: number }> | null;
}>;

export function brandingView(row: ReportBranding): object {
  return {
    enabled: row.enabled,
    displayName: row.displayName,
    accentColor: row.accentColor,
    contactLine: row.contactLine,
    logo:
      row.logoPng !== null && row.logoWidth !== null && row.logoHeight !== null
        ? {
            dataUrl: `data:image/png;base64,${Buffer.from(row.logoPng).toString('base64')}`,
            width: row.logoWidth,
            height: row.logoHeight,
            byteLength: row.logoPng.byteLength,
          }
        : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function loadReportBrand(
  prisma: PrismaClient,
  accountId: string,
): Promise<ReportBrand | null> {
  const row = await prisma.reportBranding.findUnique({ where: { accountId } });
  if (row === null || !row.enabled) return null;
  return {
    displayName: row.displayName,
    accent: row.accentColor,
    contactLine: row.contactLine,
    logo:
      row.logoPng !== null && row.logoWidth !== null && row.logoHeight !== null
        ? {
            png: row.logoPng,
            width: row.logoWidth,
            height: row.logoHeight,
          }
        : null,
  };
}
