import 'jasmine';
import { noteGateContext } from '../test_support/nova_data_gate.js';

/**
 * Tells the Nova_Data gate whether jasmine is inside a spec or outside one
 * (spec-file loading, beforeAll, afterAll), so the gate can refuse a real
 * data load from a `beforeAll` that has no `novaDataInstalled()` guard —
 * the trap that turns "no game data" into suite failures on CI while every
 * checkout WITH the data stays green (issue #334; see
 * test_support/nova_data_gate.ts).
 *
 * A jasmine helper (jasmine.json `helpers`), so it is registered before
 * any spec file loads. Reporter callbacks are awaited by the runner before
 * the next hook, so `specStarted` precedes every beforeEach and `specDone`
 * follows every afterEach.
 */
noteGateContext('hook');
jasmine.getEnv().addReporter({
    jasmineStarted: () => noteGateContext('hook'),
    suiteStarted: () => noteGateContext('hook'),
    specStarted: () => noteGateContext('spec'),
    specDone: () => noteGateContext('hook'),
    suiteDone: () => noteGateContext('hook'),
});
