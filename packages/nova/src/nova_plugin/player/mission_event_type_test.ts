import 'jasmine';
import { isLeft, isRight } from 'fp-ts/lib/Either.js';
import { MissionEventTypeType } from './mission_event_type.js';
import { PendingMissionNoticeType } from './player_state_plugin.js';

/**
 * The pending-notice wire shape's event type. It was a plain string, so a
 * saved notice of every kind this build writes must decode unchanged, one
 * a newer build writes must still decode (the landing popups show its
 * text either way), and the encoded bytes must be the same string.
 */
describe('PendingMissionNoticeType.type', () => {
    const notice = <T>(type: T) => ({
        missionId: 'nova:128', missionName: 'Delivery', type, text: 'Done.',
    });

    it('lists the event kinds the mission machinery produces', () => {
        expect([...MissionEventTypeType.members].sort()).toEqual([
            'aborted', 'accepted', 'autoAborted', 'cargoDropped',
            'cargoLoaded', 'completed', 'failed', 'shipDone',
        ]);
    });

    it('decodes every event kind as the string that was saved', () => {
        for (const type of MissionEventTypeType.members) {
            const decoded = PendingMissionNoticeType.decode(notice(type));
            if (isLeft(decoded)) {
                fail(`${type} did not decode`);
                return;
            }
            expect(decoded.right.type).toBe(type);
            expect(PendingMissionNoticeType.encode(decoded.right))
                .toEqual(notice(type));
        }
    });

    it('carries an event kind it does not know through untouched', () => {
        const decoded = PendingMissionNoticeType.decode(notice('rescued'));
        expect(isRight(decoded)).toBeTrue();
        if (isRight(decoded)) {
            expect(decoded.right.type as string).toBe('rescued');
            expect(PendingMissionNoticeType.encode(decoded.right))
                .toEqual(notice('rescued'));
        }
    });

    it('rejects a notice whose type is not a string', () => {
        expect(isLeft(PendingMissionNoticeType.decode(notice(4)))).toBeTrue();
        expect(isLeft(PendingMissionNoticeType.decode(notice(undefined))))
            .toBeTrue();
    });
});
