import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { GateArrivalComponent } from './gate_transit_plugin.js';
import {
    planGateTransitRecovery, planHyperspaceJumpRecovery,
} from './transit_recovery.js';

/**
 * A ship that has left a system exists only as the object the departure
 * event carried: the simulation deleted it before the client heard about
 * it. These are the answers to "the transition failed — now what?", and
 * "nothing" is never one of them.
 */
describe('failed-transit recovery', () => {
    function shipAt(destinationSpob: string | null) {
        const entity = new Entity('player');
        entity.components.set(GateArrivalComponent, {
            destinationSpob, emergenceAngle: null, randomDraw: 0.5,
        });
        return entity;
    }

    describe('a hypergate / wormhole transit', () => {
        it('goes back to the gate it left from', () => {
            const entity = shipAt('nova:HG-Koria');
            expect(planGateTransitRecovery(entity, 'nova:HG-V01'))
                .toEqual({ kind: 'gate', planetId: 'nova:HG-V01' });
        });

        it('drops the arrival claim, so nothing teleports the ship to a '
            + 'gate it never came through', () => {
                const entity = shipAt('nova:HG-Koria');
                planGateTransitRecovery(entity, 'nova:HG-V01');
                expect(entity.components.has(GateArrivalComponent))
                    .toBeFalse();
            });

        it('works on a ship that never had an arrival marker (a map pick '
            + 'that failed before one was written)', () => {
                const entity = new Entity('player');
                expect(planGateTransitRecovery(entity, 'nova:HG-V01'))
                    .toEqual({ kind: 'gate', planetId: 'nova:HG-V01' });
            });
    });

    describe('a hyperspace jump', () => {
        it('re-enters the system it LEFT, not the one it was going to',
            () => {
                const entity = new Entity('player');
                expect(planHyperspaceJumpRecovery(entity, 'nova:130'))
                    .toEqual({ kind: 'reenter', to: 'nova:130' });
            });

        it('drops any arrival marker: the jump reached nowhere', () => {
            // A ship can carry one from an earlier gate arrival; carried
            // into the origin world it would teleport the ship onto a gate
            // it is not coming out of.
            const entity = shipAt('nova:HG-Koria');
            planHyperspaceJumpRecovery(entity, 'nova:130');
            expect(entity.components.has(GateArrivalComponent)).toBeFalse();
        });

        it('reports the ship lost — rather than throwing — when there is '
            + 'no origin to return to', () => {
                const entity = new Entity('player');
                const plan = planHyperspaceJumpRecovery(entity, undefined);
                expect(plan.kind).toBe('lost');
                expect(plan.kind === 'lost' && plan.reason)
                    .toContain('origin system');
            });
    });
});
