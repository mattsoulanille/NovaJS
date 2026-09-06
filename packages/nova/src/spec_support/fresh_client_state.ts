import 'jasmine';
import { resetDiscovery } from '../nova_plugin/player/discovery_store.js';
import { SAVE_KEY, setActiveSaveKey } from '../nova_plugin/session/save_game.js';

/**
 * Every spec starts as a fresh client. Jasmine helper (jasmine.json), run
 * before each spec in the suite.
 *
 * NOTE: jasmine.json lists `helpers: ["spec_support/*.js"]`, which is
 * suite-global — ANY file in this directory is loaded before EVERY spec in
 * the package, whether or not the spec imports it. Put only things here
 * that every spec should see.
 *
 * The pieces of client state that outlive a game session BY DESIGN — the
 * active save key and the pilot's discovery record (discovery_store.ts:
 * localStorage-backed in the browser, so it must still answer after an
 * exit to the title; in node, where there is no storage, the in-memory
 * record is the whole record) — are one object per client, and under
 * jasmine the process is the client. Left alone between specs, a system a
 * mission session or a display world marked discovered leaked into a later
 * spec's whole-object save comparison depending purely on the shuffle seed
 * (seeds 22715, 35823 and 11111 each found a different pair). Every spec
 * file touching discovery used to guard itself; this is that guard once.
 */
beforeEach(() => {
    setActiveSaveKey(SAVE_KEY);
    resetDiscovery();
});
