// One line of a section's check list: its result, what was checked, and the
// detail behind the result. Shared by every section body a report card opens.

export function CheckRow(props: {
  resultClass: string;
  resultLabel: string;
  title: string;
  detail?: string;
}) {
  return (
    <li className="module-checks__item">
      <span className={`module-checks__result module-checks__result--${props.resultClass}`}>
        {props.resultLabel}
      </span>
      <span className="module-checks__title">{props.title}</span>
      {props.detail === undefined ? null : (
        <small className="module-checks__detail">{props.detail}</small>
      )}
    </li>
  );
}
