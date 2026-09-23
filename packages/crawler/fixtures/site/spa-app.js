// The client-rendered half of spa.html. Loaded as a real subresource, so a
// test that finds this content in the DOM has proven three things at once: the
// script was fetched through the render's own guard, the browser executed it,
// and the resulting DOM — not the empty shell — is what the crawl read.

document.title = 'Rendered Shell — Fixture Site';

/**
 * Whether an egress API was taken away by the render's isolation script.
 *
 * Only our replacement throws with 'FluxRadar' in the message, so any other
 * outcome is read as "still available" — the conservative answer for a test
 * whose whole job is to catch a control that silently did not apply.
 */
function blockedByRender(name) {
  const api = globalThis[name];
  if (typeof api !== 'function') return true;
  try {
    Reflect.construct(api, ['https://example.invalid/']);
  } catch (error) {
    return String(error && error.message).includes('FluxRadar');
  }
  return false;
}

const egressApis = ['RTCPeerConnection', 'SharedWorker', 'EventSource', 'WebTransport'];

const app = document.getElementById('app');
app.dataset.egressBlocked = egressApis.filter(blockedByRender).join(',');
app.dataset.beaconRefused = String(navigator.sendBeacon('https://example.invalid/b') === false);

// A socket is not removed from the page — it is routed and closed — so the
// attempt has to be made for the render to have anything to refuse.
try {
  const socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/live');
  socket.addEventListener('close', (event) => {
    app.dataset.websocketClose = String(event.code);
  });
} catch {
  app.dataset.websocketClose = 'threw';
}
app.innerHTML += [
  '<h1 data-rendered="yes">Rendered by JavaScript</h1>',
  '<p>This paragraph exists only after the page scripts have run.</p>',
  '<a href="/spa-linked.html">A link the static HTML never contained</a>',
].join('');
