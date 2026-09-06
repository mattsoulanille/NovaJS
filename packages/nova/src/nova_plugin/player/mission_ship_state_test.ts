import 'jasmine';
import {
    GOAL_BOARD,
    GOAL_CHASE_OFF,
    GOAL_DESTROY,
    GOAL_DISABLE,
    GOAL_ESCORT,
    GOAL_NONE,
    GOAL_OBSERVE,
    GOAL_RESCUE,
    goalSupported,
    objectiveAllowsCompletion,
    registerShip,
    shipBoarded,
    shipDeparted,
    shipDied,
    shipDisabled,
    shipObserved,
    ShipObjective,
    shipsToSpawn,
} from './mission_ship_state.js';

function makeObjective(goal: number, total = 2): ShipObjective {
    return {
        goal,
        systemId: 'nova:329',
        shipStart: 1,
        behavior: -1,
        dudeId: 'nova:240',
        total,
        satisfied: 0,
        complete: false,
        failed: false,
        shipDonePending: false,
        live: new Map(),
    };
}

describe('mission ship goal state machine', () => {
    it('supports every ship goal', () => {
        expect(goalSupported(GOAL_NONE)).toBe(true);
        expect(goalSupported(GOAL_DESTROY)).toBe(true);
        expect(goalSupported(GOAL_DISABLE)).toBe(true);
        expect(goalSupported(GOAL_ESCORT)).toBe(true);
        expect(goalSupported(GOAL_OBSERVE)).toBe(true);
        expect(goalSupported(GOAL_CHASE_OFF)).toBe(true);
        // Board is offered now that boarding is real end to end
        // (Matthew's ruling).
        expect(goalSupported(GOAL_BOARD)).toBe(true);
        // Rescue is supported too: "they start out disabled and stay
        // that way until you board them" (Bible, mïsn ShipGoal 5) is the
        // hulk state (makeHulk), lifted by the owner's boarding.
        expect(goalSupported(GOAL_RESCUE)).toBe(true);
    });

    describe('destroy', () => {
        it('completes when every ship has died', () => {
            const objective = makeObjective(GOAL_DESTROY);
            registerShip(objective, 'a');
            registerShip(objective, 'b');
            shipDied(objective, 'a');
            expect(objective.satisfied).toBe(1);
            expect(objective.complete).toBe(false);
            expect(objectiveAllowsCompletion(objective)).toBe(false);
            shipDied(objective, 'b');
            expect(objective.complete).toBe(true);
            expect(objective.shipDonePending).toBe(true);
            expect(objectiveAllowsCompletion(objective)).toBe(true);
        });

        it('does not credit departures; the ships respawn later', () => {
            const objective = makeObjective(GOAL_DESTROY);
            registerShip(objective, 'a');
            shipDeparted(objective, 'a');
            expect(objective.satisfied).toBe(0);
            expect(objective.live.size).toBe(0);
            expect(shipsToSpawn(objective)).toBe(2);
        });

        it('spawns only the remainder after partial progress', () => {
            const objective = makeObjective(GOAL_DESTROY, 3);
            registerShip(objective, 'a');
            shipDied(objective, 'a');
            expect(shipsToSpawn(objective)).toBe(2);
        });

        it('ignores deaths of untracked ships', () => {
            const objective = makeObjective(GOAL_DESTROY);
            shipDied(objective, 'never registered');
            expect(objective.satisfied).toBe(0);
        });
    });

    describe('disable', () => {
        it('counts each ship the moment it is disabled', () => {
            const objective = makeObjective(GOAL_DISABLE);
            registerShip(objective, 'a');
            registerShip(objective, 'b');
            shipDisabled(objective, 'a');
            shipDisabled(objective, 'a'); // idempotent
            expect(objective.satisfied).toBe(1);
            shipDisabled(objective, 'b');
            expect(objective.complete).toBe(true);
        });

        it('keeps credit for a disabled ship that is later destroyed', () => {
            const objective = makeObjective(GOAL_DISABLE, 1);
            registerShip(objective, 'a');
            shipDisabled(objective, 'a');
            shipDied(objective, 'a');
            expect(objective.failed).toBe(false);
            expect(objective.complete).toBe(true);
        });

        it('fails when a ship is destroyed before being disabled', () => {
            const objective = makeObjective(GOAL_DISABLE);
            registerShip(objective, 'a');
            shipDied(objective, 'a');
            expect(objective.failed).toBe(true);
            expect(objectiveAllowsCompletion(objective)).toBe(false);
        });
    });

    describe('board (seam)', () => {
        it('counts each ship the moment it is boarded', () => {
            const objective = makeObjective(GOAL_BOARD);
            registerShip(objective, 'a');
            registerShip(objective, 'b');
            shipBoarded(objective, 'a');
            shipBoarded(objective, 'a'); // idempotent
            expect(objective.satisfied).toBe(1);
            shipBoarded(objective, 'b');
            expect(objective.complete).toBe(true);
        });

        it('ignores boarding on non-board goals', () => {
            const objective = makeObjective(GOAL_DESTROY);
            registerShip(objective, 'a');
            shipBoarded(objective, 'a');
            expect(objective.satisfied).toBe(0);
        });
    });

    describe('observe', () => {
        it('completes when every ship has been observed', () => {
            const objective = makeObjective(GOAL_OBSERVE);
            registerShip(objective, 'a');
            registerShip(objective, 'b');
            shipObserved(objective, 'a');
            shipObserved(objective, 'a'); // idempotent
            expect(objective.satisfied).toBe(1);
            shipObserved(objective, 'b');
            expect(objective.complete).toBe(true);
        });

        it('loses nothing when an unobserved ship dies', () => {
            const objective = makeObjective(GOAL_OBSERVE);
            registerShip(objective, 'a');
            shipDied(objective, 'a');
            expect(objective.satisfied).toBe(0);
            expect(objective.failed).toBe(false);
            expect(shipsToSpawn(objective)).toBe(2);
        });
    });

    describe('chase off', () => {
        it('credits kills and departures alike', () => {
            const objective = makeObjective(GOAL_CHASE_OFF);
            registerShip(objective, 'a');
            registerShip(objective, 'b');
            shipDied(objective, 'a');
            expect(objective.satisfied).toBe(1);
            shipDeparted(objective, 'b');
            expect(objective.satisfied).toBe(2);
            expect(objective.complete).toBe(true);
        });
    });

    describe('escort', () => {
        it('never blocks completion while the ships live', () => {
            const objective = makeObjective(GOAL_ESCORT);
            registerShip(objective, 'a');
            expect(objective.complete).toBe(false);
            expect(objectiveAllowsCompletion(objective)).toBe(true);
        });

        it('fails the mission when an escorted ship dies', () => {
            const objective = makeObjective(GOAL_ESCORT);
            registerShip(objective, 'a');
            shipDied(objective, 'a');
            expect(objective.failed).toBe(true);
            expect(objectiveAllowsCompletion(objective)).toBe(false);
        });

        it('tolerates an escorted ship jumping out', () => {
            const objective = makeObjective(GOAL_ESCORT);
            registerShip(objective, 'a');
            shipDeparted(objective, 'a');
            expect(objective.failed).toBe(false);
        });

        it('always respawns the full complement', () => {
            const objective = makeObjective(GOAL_ESCORT);
            expect(shipsToSpawn(objective)).toBe(2);
        });
    });

    describe('no goal', () => {
        it('never blocks completion', () => {
            const objective = makeObjective(GOAL_NONE);
            registerShip(objective, 'a');
            shipDied(objective, 'a');
            expect(objectiveAllowsCompletion(objective)).toBe(true);
        });
    });

    it('spawns nothing once complete or failed', () => {
        const done = makeObjective(GOAL_DESTROY);
        done.satisfied = 2;
        done.complete = true;
        expect(shipsToSpawn(done)).toBe(0);
        const failed = makeObjective(GOAL_ESCORT);
        failed.failed = true;
        expect(shipsToSpawn(failed)).toBe(0);
    });
});
