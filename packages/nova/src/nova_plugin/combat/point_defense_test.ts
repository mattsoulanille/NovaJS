import 'jasmine';
import {
    isPointDefenseCandidate, PointDefenseCandidate, PointDefenseFirer,
    pointDefenseMayDamage,
    selectPointDefenseTarget,
} from './point_defense.js';

/**
 * The point defense CHOICE, unit-tested away from the world: the Bible's
 * "incoming guided weapons and nearby ships" (wëap Guidance 9/10,
 * ~:3103) with missiles taking precedence, and with the eligibility
 * rules that keep a turret off its own side.
 */
describe('point defense target selection', () => {
    const FIRER: PointDefenseFirer = {
        owner: 'carrier',
        source: 'turretShip',
        rangeSquared: 100 ** 2,
    };

    function missile(uuid: string, distance: number,
        overrides: Partial<PointDefenseCandidate> = {}): PointDefenseCandidate {
        return {
            uuid,
            kind: 'missile',
            distanceSquared: distance ** 2,
            owner: 'enemy',
            target: 'carrier',
            hostile: false,
            inFlock: false,
            ...overrides,
        };
    }

    function fighter(uuid: string, distance: number,
        overrides: Partial<PointDefenseCandidate> = {}): PointDefenseCandidate {
        return {
            uuid,
            kind: 'fighter',
            distanceSquared: distance ** 2,
            owner: 'enemy',
            target: undefined,
            hostile: true,
            inFlock: false,
            ...overrides,
        };
    }

    describe('priority', () => {
        it('shoots the missile even when a fighter is closer', () => {
            const chosen = selectPointDefenseTarget(
                [fighter('fighter', 10), missile('missile', 90)], FIRER);
            expect(chosen?.uuid).toBe('missile');
        });

        it('takes the closest missile when several are incoming', () => {
            const chosen = selectPointDefenseTarget([
                missile('far', 90), missile('near', 20), missile('mid', 50),
            ], FIRER);
            expect(chosen?.uuid).toBe('near');
        });

        it('falls through to the closest hostile fighter with no missile in range',
            () => {
                const chosen = selectPointDefenseTarget([
                    fighter('far', 90), fighter('near', 20),
                    // Out of reach, so it cannot claim missile priority.
                    missile('outOfRange', 150),
                ], FIRER);
                expect(chosen?.uuid).toBe('near');
            });

        it('fires at nothing when the sky is empty', () => {
            expect(selectPointDefenseTarget([], FIRER)).toBeUndefined();
        });
    });

    describe('missile candidacy', () => {
        it('ignores a missile flying at somebody else', () => {
            expect(selectPointDefenseTarget(
                [missile('passingBy', 20, { target: 'someoneElse' })], FIRER))
                .toBeUndefined();
        });

        it('takes a missile aimed at the turret ship itself, not just its owner',
            () => {
                expect(selectPointDefenseTarget(
                    [missile('atTurret', 20, { target: 'turretShip' })], FIRER)
                    ?.uuid).toBe('atTurret');
            });

        it('never shoots our own side\'s missiles', () => {
            expect(selectPointDefenseTarget(
                [missile('ours', 20, { owner: 'carrier' })], FIRER))
                .toBeUndefined();
        });
    });

    describe('fighter candidacy', () => {
        it('shoots a hostile fighter that has not targeted us', () => {
            expect(selectPointDefenseTarget(
                [fighter('strafing', 20, { target: 'ourEscort' })], FIRER)
                ?.uuid).toBe('strafing');
        });

        it('does NOT shoot a non-hostile fighter merely for having us '
            + 'targeted (a player selecting us to hail)', () => {
            expect(selectPointDefenseTarget([
                fighter('hailing', 20, { hostile: false, target: 'carrier' }),
            ], FIRER)).toBeUndefined();
        });

        it('shoots that same fighter once it turns hostile', () => {
            expect(selectPointDefenseTarget([
                fighter('hailing', 20, { hostile: true, target: 'carrier' }),
            ], FIRER)?.uuid).toBe('hailing');
        });

        it('leaves a non-hostile fighter minding its own business alone', () => {
            expect(selectPointDefenseTarget([
                fighter('trader', 20, { hostile: false, target: 'someoneElse' }),
            ], FIRER)).toBeUndefined();
        });

        it('never shoots a fighter launched by our own carrier', () => {
            expect(selectPointDefenseTarget([
                // Same owner as the turret: our own wing, however
                // confused its target lock is.
                fighter('ourWing', 5, { owner: 'carrier', target: 'carrier' }),
            ], FIRER)).toBeUndefined();
        });

        it('never shoots a flock member (our escort\'s own fighters)', () => {
            expect(selectPointDefenseTarget([
                fighter('escortsFighter', 5,
                    { owner: 'ourEscort', inFlock: true, target: 'carrier' }),
            ], FIRER)).toBeUndefined();
        });

        it('never shoots the turret\'s own ship or its owner', () => {
            expect(selectPointDefenseTarget([
                fighter('turretShip', 0, { owner: 'turretShip', target: 'carrier' }),
                fighter('carrier', 1, { owner: 'carrier', target: 'carrier' }),
            ], FIRER)).toBeUndefined();
        });
    });

    describe('range', () => {
        it('takes a candidate exactly at the edge of reach', () => {
            expect(selectPointDefenseTarget([missile('edge', 100)], FIRER)
                ?.uuid).toBe('edge');
        });

        it('drops a candidate just past it', () => {
            const past = missile('past', 100);
            past.distanceSquared += 1;
            expect(selectPointDefenseTarget([past], FIRER)).toBeUndefined();
        });
    });

    /**
     * The whole point of a pure selection function: two peers whose
     * entity maps iterate in different orders must reach the same
     * verdict, so exact ties cannot be settled by "whoever came first".
     */
    describe('determinism', () => {
        it('breaks an exact distance tie toward the smaller uuid', () => {
            const candidates = [missile('bbb', 30), missile('aaa', 30)];
            expect(selectPointDefenseTarget(candidates, FIRER)?.uuid).toBe('aaa');
            expect(selectPointDefenseTarget([...candidates].reverse(), FIRER)
                ?.uuid).toBe('aaa');
        });

        it('breaks an exact fighter tie toward the smaller uuid', () => {
            const candidates = [fighter('zed', 30), fighter('alpha', 30)];
            expect(selectPointDefenseTarget(candidates, FIRER)?.uuid)
                .toBe('alpha');
            expect(selectPointDefenseTarget([...candidates].reverse(), FIRER)
                ?.uuid).toBe('alpha');
        });

        it('is independent of iteration order over a mixed sky', () => {
            const sky = [
                fighter('f1', 10), missile('m1', 40), fighter('f2', 5),
                missile('m2', 40), fighter('f3', 12), missile('m3', 80),
            ];
            const forward = selectPointDefenseTarget(sky, FIRER)?.uuid;
            const backward = selectPointDefenseTarget([...sky].reverse(), FIRER)
                ?.uuid;
            const shuffled = selectPointDefenseTarget(
                [sky[3], sky[0], sky[5], sky[2], sky[4], sky[1]], FIRER)?.uuid;
            expect(forward).toBe('m1');
            expect(backward).toBe('m1');
            expect(shuffled).toBe('m1');
        });
    });

    describe('isPointDefenseCandidate', () => {
        it('is the eligibility half of the rule on its own', () => {
            expect(isPointDefenseCandidate(missile('m', 20), FIRER)).toBeTrue();
            expect(isPointDefenseCandidate(fighter('f', 20), FIRER)).toBeTrue();
            expect(isPointDefenseCandidate(
                fighter('f', 20, { hostile: false }), FIRER)).toBeFalse();
        });
    });
});

describe('pointDefenseMayDamage (collision-time twin of candidacy)', () => {
    const FIRER_NO_RANGE = { owner: 'carrier', source: 'turretShip' };

    it('lets a PD shot hurt a hostile fighter and a missile aimed at us', () => {
        expect(pointDefenseMayDamage({
            uuid: 'f', kind: 'fighter', owner: 'f', hostile: true,
            inFlock: false, target: 'someoneElse',
        }, FIRER_NO_RANGE)).toBeTrue();
        expect(pointDefenseMayDamage({
            uuid: 'm', kind: 'missile', owner: 'enemy', hostile: false,
            inFlock: false, target: 'carrier',
        }, FIRER_NO_RANGE)).toBeTrue();
    });

    it('lets a stray PD shot PASS THROUGH a neutral fighter or somebody '
        + 'else\'s missile (no accidental wars)', () => {
        expect(pointDefenseMayDamage({
            uuid: 'trader', kind: 'fighter', owner: 'trader', hostile: false,
            inFlock: false, target: 'carrier',
        }, FIRER_NO_RANGE)).toBeFalse();
        expect(pointDefenseMayDamage({
            uuid: 'm', kind: 'missile', owner: 'enemy', hostile: false,
            inFlock: false, target: 'someoneElse',
        }, FIRER_NO_RANGE)).toBeFalse();
    });

    it('never hurts our own wing or flock', () => {
        expect(pointDefenseMayDamage({
            uuid: 'w', kind: 'fighter', owner: 'carrier', hostile: true,
            inFlock: false, target: 'x',
        }, FIRER_NO_RANGE)).toBeFalse();
        expect(pointDefenseMayDamage({
            uuid: 'e', kind: 'fighter', owner: 'e', hostile: true,
            inFlock: true, target: 'x',
        }, FIRER_NO_RANGE)).toBeFalse();
    });
});
