import type { BrandingView } from './report-branding-api';

export function PrintBrand({ brand }: { brand: BrandingView }) {
  return (
    <div className="print-brand">
      {brand.logo === null ? null : (
        <img
          src={brand.logo.dataUrl}
          alt={brand.displayName}
          width={brand.logo.width}
          height={brand.logo.height}
          className="print-brand__logo"
        />
      )}
      <p className="print-brand__name">{brand.displayName}</p>
      {brand.contactLine === null ? null : <p className="muted">{brand.contactLine}</p>}
    </div>
  );
}
