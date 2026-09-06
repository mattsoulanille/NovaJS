import 'jasmine';
import { isLeft, isRight } from 'fp-ts/lib/Either.js';
import { SystemHoldReasonType, SystemHoldType } from './system_hold.js';

/**
 * The SystemHold wire shape. The reason is an OPEN enum (review r14 M4):
 * every reason this build writes decodes to itself, an unknown one from a
 * newer peer still decodes the component, and the encoded bytes are the
 * plain string they always were.
 */
describe('SystemHoldType', () => {
    it('decodes every reason this build writes', () => {
        for (const reason of SystemHoldReasonType.members) {
            const decoded = SystemHoldType.decode({ reason });
            if (isLeft(decoded)) {
                fail(`${reason} did not decode`);
                return;
            }
            expect(decoded.right).toEqual({ reason });
        }
        expect(SystemHoldReasonType.members)
            .toEqual(['shipOffer', 'rescue', 'missionGoal']);
    });

    it('encodes a reason as the bare string it was before', () => {
        expect(SystemHoldType.encode({ reason: 'rescue' }))
            .toEqual({ reason: 'rescue' });
    });

    it('still decodes a reason it does not know (additive wire shape)',
        () => {
            const decoded = SystemHoldType.decode({ reason: 'quarantine' });
            expect(isRight(decoded)).toBeTrue();
            if (isRight(decoded)) {
                expect(decoded.right.reason as string).toBe('quarantine');
            }
        });

    it('rejects a component whose reason is not a string', () => {
        expect(isLeft(SystemHoldType.decode({ reason: 1 }))).toBeTrue();
        expect(isLeft(SystemHoldType.decode({}))).toBeTrue();
    });
});
