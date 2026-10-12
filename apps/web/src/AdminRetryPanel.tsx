// The owner dashboard's "could not be loaded" panel, shared by the numbers and
// the Accounts list so a failure reads, and recovers, the same way in both.

import { Button, Panel } from './components';

export function RetryPanel(props: { title: string; message: string; onRetry: () => void }) {
  return (
    <Panel title={props.title}>
      <p className="muted" role="alert">
        {props.message}
      </p>
      <div className="button-row">
        <Button variant="primary" onClick={props.onRetry}>
          Try again
        </Button>
      </div>
    </Panel>
  );
}
