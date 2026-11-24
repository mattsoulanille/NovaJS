import 'jasmine';
import {
    STATUS_LINE_HOLD_MS, statusLineAlpha,
} from './status_message_plugin.js';

/**
 * How long a status-line message stays (docs/reference_experiments.md, "P1
 * wave 16", the status line): read frame by frame from a 10 fps recording,
 * eight distress lines each stayed 8.0-8.2 s, then the line went dark AT
 * ONCE, with no fade.
 */
describe('status line lifetime (reference P1 wave 16)', () => {
    it('holds a message 8 s', () => {
        expect(STATUS_LINE_HOLD_MS).toBe(8000);
        expect(statusLineAlpha(0)).toBe(1);
        expect(statusLineAlpha(STATUS_LINE_HOLD_MS - 1)).toBe(1);
    });

    it('then clears it at once, with no fade', () => {
        expect(statusLineAlpha(STATUS_LINE_HOLD_MS)).toBe(0);
        expect(statusLineAlpha(STATUS_LINE_HOLD_MS + 100)).toBe(0);
        expect(statusLineAlpha(STATUS_LINE_HOLD_MS + 60_000)).toBe(0);
    });

    it('shows nothing before the first message', () => {
        expect(statusLineAlpha(Infinity)).toBe(0);
    });
});
