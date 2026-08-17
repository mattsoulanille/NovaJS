import 'jasmine';
import { TurretBlindSpots } from 'novadatainterface/blind_spots';
import { GuidanceType } from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import {
    blindSpotBlocksFiring, blindSpotBlocksQuadrant, combineBlindSpots,
    getQuadrant, isBlindQuadrant, isTurretedGuidance, Quadrant,
} from './blind_spots.js';

const ORIGIN = new Position(0, 0);
// Nova's angle convention: 0 faces -y (Angle.getUnitVector is
// (sin θ, -cos θ)), and Vector.angle is atan2(x, -y). So a ship at the
// origin with rotation 0 is looking "up" the screen.
const FACING_UP = new Angle(0);

function spots(over: Partial<TurretBlindSpots> = {}): TurretBlindSpots {
    return { front: false, sides: false, rear: false, ...over };
}

describe('getQuadrant', () => {
    it('puts a target dead ahead in the front quadrant', () => {
        expect(getQuadrant(ORIGIN, FACING_UP, new Position(0, -100)))
            .toEqual('frontQuadrant');
    });

    it('puts a target dead astern in the rear quadrant', () => {
        expect(getQuadrant(ORIGIN, FACING_UP, new Position(0, 100)))
            .toEqual('rearQuadrant');
    });

    it('puts a target abeam in the sides quadrant, either side', () => {
        expect(getQuadrant(ORIGIN, FACING_UP, new Position(100, 0)))
            .toEqual('sidesQuadrant');
        expect(getQuadrant(ORIGIN, FACING_UP, new Position(-100, 0)))
            .toEqual('sidesQuadrant');
    });

    // The three sectors have to partition the circle exactly, because a
    // blind-spot test and a quadrant-turret test both read this function
    // and must never disagree about a bearing. Both 45° boundaries
    // belong to the sides.
    it('assigns both quadrant boundaries to the sides', () => {
        // Exactly 45° off the bow, port and starboard.
        expect(getQuadrant(ORIGIN, FACING_UP, new Position(100, -100)))
            .toEqual('sidesQuadrant');
        expect(getQuadrant(ORIGIN, FACING_UP, new Position(-100, -100)))
            .toEqual('sidesQuadrant');
        // Exactly 135°: 45° off the tail.
        expect(getQuadrant(ORIGIN, FACING_UP, new Position(100, 100)))
            .toEqual('sidesQuadrant');
        expect(getQuadrant(ORIGIN, FACING_UP, new Position(-100, 100)))
            .toEqual('sidesQuadrant');
    });

    it('is measured relative to the ship\'s heading, not the world', () => {
        // Same target position; the ship has turned to face it.
        const target = new Position(100, 0);
        expect(getQuadrant(ORIGIN, new Angle(Math.PI / 2), target))
            .toEqual('frontQuadrant');
        expect(getQuadrant(ORIGIN, new Angle(-Math.PI / 2), target))
            .toEqual('rearQuadrant');
        expect(getQuadrant(ORIGIN, new Angle(Math.PI), target))
            .toEqual('sidesQuadrant');
    });

    it('reads a heading given outside [-pi, pi) the same way', () => {
        // Angle normalizes, so a ship that has wrapped past ±180° is not
        // suddenly blind on the wrong side.
        expect(getQuadrant(ORIGIN, new Angle(2 * Math.PI),
            new Position(0, -100))).toEqual('frontQuadrant');
    });
});

describe('isTurretedGuidance', () => {
    it('covers full turrets and both quadrant turrets', () => {
        for (const guidance of ['turret', 'beamTurret', 'frontQuadrant',
            'rearQuadrant'] as GuidanceType[]) {
            expect(isTurretedGuidance(guidance)).withContext(guidance).toBeTrue();
        }
    });

    // The Bible words both flag sets as being about TURRETS, and the
    // stock data does set the bits on fixed guns anyway (nova:128 Light
    // Blaster is 'unguided' with side+rear set, nova:146 Pulse Laser is
    // a fixed 'beam' with rear set). Those weapons shoot in every
    // direction in the original game, so a fixed mount must ignore them.
    it('excludes fixed mounts, guided weapons and bays', () => {
        for (const guidance of ['unguided', 'beam', 'guided', 'rocket',
            'freefallBomb', 'bay'] as GuidanceType[]) {
            expect(isTurretedGuidance(guidance)).withContext(guidance).toBeFalse();
        }
    });

    // Point defense picks its own victim out of the world every frame
    // rather than tracking the ship's target, and the Bible attaches no
    // blind-spot rule to it.
    it('excludes point defense', () => {
        expect(isTurretedGuidance('pointDefense')).toBeFalse();
        expect(isTurretedGuidance('pointDefenseBeam')).toBeFalse();
    });
});

describe('combineBlindSpots', () => {
    it('ORs the ship set with the weapon set', () => {
        expect(combineBlindSpots(spots({ rear: true }), spots({ sides: true })))
            .toEqual(spots({ sides: true, rear: true }));
    });

    it('lets neither set re-open a sector the other closes', () => {
        // Both are restrictions, so `false` never wins over `true`.
        expect(combineBlindSpots(spots({ front: true }), spots()))
            .toEqual(spots({ front: true }));
        expect(combineBlindSpots(spots(), spots({ front: true })))
            .toEqual(spots({ front: true }));
    });

    it('treats a missing set as no blind spots', () => {
        expect(combineBlindSpots(undefined, spots({ rear: true })))
            .toEqual(spots({ rear: true }));
        expect(combineBlindSpots(spots({ rear: true }), undefined))
            .toEqual(spots({ rear: true }));
        expect(combineBlindSpots(undefined, undefined)).toEqual(spots());
    });
});

describe('isBlindQuadrant', () => {
    it('maps each sector to its own flag', () => {
        const pairs: Array<[keyof TurretBlindSpots, Quadrant]> = [
            ['front', 'frontQuadrant'],
            ['sides', 'sidesQuadrant'],
            ['rear', 'rearQuadrant'],
        ];
        for (const [flag, quadrant] of pairs) {
            expect(isBlindQuadrant(spots({ [flag]: true }), quadrant))
                .withContext(`${flag} blocks ${quadrant}`).toBeTrue();
            for (const [, other] of pairs.filter(([f]) => f !== flag)) {
                expect(isBlindQuadrant(spots({ [flag]: true }), other))
                    .withContext(`${flag} leaves ${other} open`).toBeFalse();
            }
        }
    });
});

describe('blindSpotBlocksQuadrant', () => {
    function blocks(over: {
        guidance?: GuidanceType,
        weaponBlindSpots?: TurretBlindSpots,
        shipBlindSpots?: TurretBlindSpots,
        targetQuadrant?: Quadrant,
    } = {}) {
        return blindSpotBlocksQuadrant({
            guidance: 'turret',
            weaponBlindSpots: spots(),
            shipBlindSpots: spots(),
            targetQuadrant: 'frontQuadrant',
            ...over,
        });
    }

    it('blocks a turret whose target is in a blind sector', () => {
        expect(blocks({
            weaponBlindSpots: spots({ rear: true }),
            targetQuadrant: 'rearQuadrant',
        })).toBeTrue();
    });

    it('lets a turret fire at a target in a live sector', () => {
        expect(blocks({
            weaponBlindSpots: spots({ rear: true }),
            targetQuadrant: 'frontQuadrant',
        })).toBeFalse();
        expect(blocks({
            weaponBlindSpots: spots({ rear: true }),
            targetQuadrant: 'sidesQuadrant',
        })).toBeFalse();
    });

    it('applies the ship\'s blind spots to a weapon that has none', () => {
        // The Fed Destroyer / Aurora Cruiser case: the SHIP is rear
        // blind, so every turret it mounts is, whatever the wëap says.
        expect(blocks({
            shipBlindSpots: spots({ rear: true }),
            targetQuadrant: 'rearQuadrant',
        })).toBeTrue();
    });

    it('unions the two sets rather than letting one override', () => {
        // Weapon blind to the rear, ship blind to the sides: only the
        // front is left.
        const args = {
            weaponBlindSpots: spots({ rear: true }),
            shipBlindSpots: spots({ sides: true }),
        };
        expect(blocks({ ...args, targetQuadrant: 'frontQuadrant' })).toBeFalse();
        expect(blocks({ ...args, targetQuadrant: 'sidesQuadrant' })).toBeTrue();
        expect(blocks({ ...args, targetQuadrant: 'rearQuadrant' })).toBeTrue();
    });

    it('never blocks a non-turreted weapon', () => {
        // nova:128 Light Blaster really does carry side+rear in the
        // stock data while being an 'unguided' fixed gun.
        expect(blocks({
            guidance: 'unguided',
            weaponBlindSpots: spots({ sides: true, rear: true }),
            targetQuadrant: 'rearQuadrant',
        })).toBeFalse();
        // ...and a ship-level set must not reach a fixed gun either.
        expect(blocks({
            guidance: 'unguided',
            shipBlindSpots: spots({ front: true, sides: true, rear: true }),
            targetQuadrant: 'rearQuadrant',
        })).toBeFalse();
    });

    it('never blocks point defense', () => {
        expect(blocks({
            guidance: 'pointDefense',
            shipBlindSpots: spots({ front: true, sides: true, rear: true }),
            targetQuadrant: 'rearQuadrant',
        })).toBeFalse();
    });

    it('blocks nothing when there is no target to be blind to', () => {
        // A quadrant turret with no target "fires straight ahead"
        // (Bible, wëap Guidance 7); there is no bearing to test.
        expect(blocks({
            guidance: 'frontQuadrant',
            weaponBlindSpots: spots({ front: true, sides: true, rear: true }),
            targetQuadrant: undefined,
        })).toBeFalse();
    });

    it('blocks every sector for an all-blind turret', () => {
        // extra-outfits 324-326 ("Soldier/Engineer/Ensign Quarters") are
        // real: guidance 'turret' with all three bits set, which is how
        // that plug-in builds a crew outfit that never shoots.
        const allBlind = spots({ front: true, sides: true, rear: true });
        for (const quadrant of ['frontQuadrant', 'sidesQuadrant',
            'rearQuadrant'] as Quadrant[]) {
            expect(blocks({ weaponBlindSpots: allBlind, targetQuadrant: quadrant }))
                .withContext(quadrant).toBeTrue();
        }
    });
});

describe('blindSpotBlocksFiring', () => {
    function blocks(targetPosition: Position | undefined,
        blindSpots: TurretBlindSpots) {
        return blindSpotBlocksFiring({
            guidance: 'turret',
            weaponBlindSpots: blindSpots,
            shipBlindSpots: undefined,
            sourcePosition: ORIGIN,
            sourceRotation: FACING_UP,
            targetPosition,
        });
    }

    it('derives the sector from the target\'s bearing', () => {
        const rearBlind = spots({ rear: true });
        expect(blocks(new Position(0, 100), rearBlind)).toBeTrue();
        expect(blocks(new Position(0, -100), rearBlind)).toBeFalse();
        expect(blocks(new Position(100, 0), rearBlind)).toBeFalse();
    });

    it('ignores the aiming angle: only the target\'s bearing counts', () => {
        // The odd original-game rule. A rear-blind turret on a ship
        // facing "up" with its target dead ahead may lead the shot
        // arbitrarily far around — even to an angle inside the rear
        // cone — and still fires, because the TARGET is forward.
        // Everything about the firing angle is settled after this
        // predicate runs, so there is nothing for it to look at.
        expect(blocks(new Position(0, -100), spots({ rear: true }))).toBeFalse();
    });

    it('blocks nothing with no target', () => {
        expect(blocks(undefined, spots({ front: true, sides: true, rear: true })))
            .toBeFalse();
    });
});
