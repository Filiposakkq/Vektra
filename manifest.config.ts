import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };
import { FULL_ENGINE } from './src/engine/fullEngine.ts';

export default defineManifest({
  manifest_version: 3,
  name: 'Vektra',
  description: 'Stockfish hints, optional autoplay and game analysis for chess.com.',
  version: pkg.version,
  // Fixes the extension ID (omhnocnlghbmiboddipdodbdikbgdabb) whatever folder
  // Vektra is loaded from, so settings survive a move and the updater helper
  // (public/updater) knows which extension may talk to it.
  key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwmPetwyqec7jrvIpQPzR0M4Dkn/LnIndWq4swf0wcu+dGiSXx2aBM5BWQCuAExKe5g7qJYRScEPjwYyovyNXv0eN2DG1jFcTZGHXVxsj4rCp58iA1i3RDFzavgO43aHXe9eTbLtas3FJp1Xpv1pvcIA44JQh8PFooNC2bPuFN/pBjBj59XnURGxP/Y2E5n061EVXY+YdKbwPhWqRk7GuWSQHxyWH6By+FJuwqwBlouWWNFyvXU6gBQJ1HupgJev4BUr9bDzmfSSvW2oCLDKau1UdJCbiYkna9uDJaRGm8jEaOH6XLbRpWkVxzsuRs7+UNkOYxvn6xblm2bjNewHjDwIDAQAB',
  // alarms: wait for a bot game to end before reloading after an update.
  // nativeMessaging: ask the updater helper to install an update.
  permissions: ['storage', 'offscreen', 'unlimitedStorage', 'alarms', 'nativeMessaging'],
  // VEKTRA_E2E_FULL_ENGINE grants the download hosts up front so the
  // full-engine end-to-end test can run without clicking a permission prompt.
  host_permissions: ['https://www.chess.com/*', ...(process.env.VEKTRA_E2E_FULL_ENGINE ? FULL_ENGINE.origins : [])],
  // Only requested when the user opts into downloading the full engine.
  optional_host_permissions: [...FULL_ENGINE.origins],
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  action: { default_popup: 'src/popup/index.html?launch=1', default_title: 'Vektra settings' },
  // Users can change these at chrome://extensions/shortcuts.
  commands: {
    'toggle-hints': {
      suggested_key: { default: 'Alt+Shift+H' },
      description: 'Turn hints on or off',
    },
    'show-hint': {
      suggested_key: { default: 'Alt+Shift+J' },
      description: 'Show hint now',
    },
    'toggle-autoplay': {
      suggested_key: { default: 'Alt+Shift+A' },
      description: 'Turn autoplay on or off',
    },
  },
  // Stockfish is WebAssembly, which needs wasm-unsafe-eval on extension pages
  // (the offscreen document and its worker).
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },
  // The display font is loaded into chess.com pages for the Vektra panel.
  web_accessible_resources: [
    { resources: ['src/popup/index.html', 'assets/*'], matches: ['https://www.chess.com/*'] },
  ],
  content_scripts: [
    {
      // Matches all of chess.com because the site navigates client-side between
      // pages. src/content/pageScope.ts decides whether Vektra may run.
      matches: ['https://www.chess.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
});
