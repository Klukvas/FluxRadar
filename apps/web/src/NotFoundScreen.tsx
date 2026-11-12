import { AppFrame } from './WorkspaceChrome';
import { Button, Window } from './components';
import type { AppModel } from './app-model';
import { siteChromeCopy } from './site-chrome-copy';

/**
 * What an address that names nothing shows. It is a plain window with a way
 * back, not the home page: a mistyped link must not look like a working page.
 * The server answers such addresses with a 404 status (deploy/nginx.conf).
 */
export function NotFoundScreen({ app }: { readonly app: AppModel }) {
  const { language, navigate } = app;
  const copy = siteChromeCopy[language].notFound;
  return (
    <AppFrame app={app} className="app-shell" active="desktop" signedIn={false}>
      <Window title={copy.title} terminal>
        <p>{copy.body}</p>
        <Button onClick={() => navigate('home')}>{copy.home}</Button>
      </Window>
    </AppFrame>
  );
}
