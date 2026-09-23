// How this deployment starts a browser for JS-rendered crawls.
//
// Rendering is optional infrastructure: the `playwright` package and a Chromium
// binary have to be installed for it to work, and a deployment that has not
// done so must say "unavailable" rather than pretend. Everything here is
// therefore a switch and two paths — never a credential.

import { startPlaywrightRuntime, type RenderRuntimeResult } from '@fluxradar/crawler';

/** Set to `true` to allow scans to open a browser in this deployment. */
export const RENDER_ENABLED_ENV = 'FLUXRADAR_RENDER_ENABLED';
/** Chromium flags a container needs, comma-separated (e.g. `--no-sandbox`). */
export const RENDER_ARGS_ENV = 'FLUXRADAR_RENDER_CHROMIUM_ARGS';
/** Browser binary, when it is not where Playwright installed it. */
export const RENDER_EXECUTABLE_ENV = 'FLUXRADAR_RENDER_CHROMIUM_PATH';

export function isRenderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[RENDER_ENABLED_ENV] === 'true';
}

/**
 * Starts the browser, or returns the reason there is none.
 *
 * A deployment that has not switched rendering on is reported the same way a
 * missing package is — as an explicit unavailability with a reason the report
 * can show — because from the reader's point of view they are the same fact.
 */
export async function createRenderRuntime(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RenderRuntimeResult> {
  if (!isRenderEnabled(env)) {
    return {
      kind: 'unavailable',
      reason: 'RuntimeNotInstalled',
      detail: `JS rendering is switched off in this deployment (${RENDER_ENABLED_ENV} is not "true")`,
    };
  }
  const launchArgs = (env[RENDER_ARGS_ENV] ?? '')
    .split(',')
    .map((argument) => argument.trim())
    .filter((argument) => argument !== '');
  const executablePath = env[RENDER_EXECUTABLE_ENV];
  return startPlaywrightRuntime({
    ...(launchArgs.length > 0 ? { launchArgs } : {}),
    ...(executablePath !== undefined && executablePath !== '' ? { executablePath } : {}),
  });
}
