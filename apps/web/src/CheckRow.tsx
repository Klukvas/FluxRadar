// One line of a section's check list: its result, what was checked, and the
// detail behind the result. Shared by every section body a report card opens.

export function CheckRow(props: {
  resultClass: string;
  resultLabel: string;
  title: string;
  detail?: string;
  /** Opens this rule's recorded findings when the row represents a problem. */
  onOpenProblem?: () => void;
}) {
  const content = (
    <>
      <span className={`module-checks__result module-checks__result--${props.resultClass}`}>
        {props.resultLabel}
      </span>
      <span className="module-checks__title">{props.title}</span>
      {props.detail === undefined ? null : (
        <small className="module-checks__detail">{props.detail}</small>
      )}
    </>
  );
  if (props.onOpenProblem !== undefined) {
    return (
      <li>
        <button
          className="module-checks__item module-checks__item--problem"
          onClick={props.onOpenProblem}
        >
          {content}
        </button>
      </li>
    );
  }
  return <li className="module-checks__item">{content}</li>;
}
