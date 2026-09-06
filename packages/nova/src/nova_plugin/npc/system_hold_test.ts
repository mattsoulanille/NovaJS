import 'jasmine';
import { isLeft, isRight } from 'fp-ts/lib/Either.js';
import { Entity } from 'nova_ecs/entity';
import {
    SystemHoldComponent, SystemHoldReasonType, SystemHoldType,
} from './system_hold.js';

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

    it('a reason this build does not declare is a compile error at the '
        + 'producer', () => {
            // Type-level spec. ComponentMap.set / Entity.addComponent
            // take `NoInfer<Data>`, so the component's declared type wins
            // and a fresh literal is checked against the union instead of
            // widening the inference to {reason: string} (which is what
            // plain `data: Data` did: {reason: 'typo'} compiled). Each
            // expect-error directive below FAILS THE BUILD if its line
            // stops erroring, i.e. if the widening comes back.
            const held = new Entity();
            held.components.set(SystemHoldComponent, { reason: 'missionGoal' });
            expect(held.components.get(SystemHoldComponent))
                .toEqual({ reason: 'missionGoal' });
            // Never called: it exists to be type-checked, not run.
            const rejectedAtCompileTime = () => {
                // @ts-expect-error 'rescued' is not a SystemHoldReason.
                held.components.set(SystemHoldComponent, { reason: 'rescued' });
                // @ts-expect-error same guarantee on the chaining api.
                new Entity().addComponent(SystemHoldComponent, { reason: 'rescued' });
                // A value only known to be a string is refused too.
                const anyString: string = 'missionGoal';
                // @ts-expect-error string is wider than the declared members.
                held.components.set(SystemHoldComponent, { reason: anyString });
            };
            expect(rejectedAtCompileTime).toBeInstanceOf(Function);
        });
});
