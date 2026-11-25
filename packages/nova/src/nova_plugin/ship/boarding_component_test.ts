import 'jasmine';
import { Angle, Vector } from 'nova_ecs/datatypes/vector';
import { Position } from 'nova_ecs/datatypes/position';
import { Entity } from 'nova_ecs/entity';
import { MovementState } from 'nova_ecs/plugins/movement_plugin';
import { GovtComponent } from '../core/index.js';
import { ControlledByComponent } from '../player/index.js';
import { PlayerShipSelector } from '../player/index.js';
import {
    capturable,
    AXIS_ALIGN_TOLERANCE_RAD,
    axesAligned,
    BOARD_RANGE_DEFAULT_SPRITE_WIDTH,
    boardingBlockedReason,
    boardingDistance,
    BoardingGovtLookup,
    boardingRange,
    captureChance,
    CAPTURE_CHANCE_MAX, CAPTURE_CHANCE_MIN,
    creditBooty,
    creditBootyBase,
    creditBootyRandomSteps,
    fuelTransferAmount,
    isDerelict,
    planCargoPlunder,
    planAmmoPlunder,
    AmmoOutfitInfo,
    bayCaptureRoom,
    BoardedComponent,
    CaptureBayCandidate,
    chooseCaptureBay,
    clearPlunderRecord,
    matchBoardedVelocity,
    plunderSpent,
} from './boarding_component.js';

/** A government table with one derelict govt (Flags1 0x0800) and one
 * ordinary one; any other id is unknown. */
const DERELICT_GOVT = 'nova:378';
const LIVE_GOVT = 'nova:363';
const govts: BoardingGovtLookup = id =>
    id === DERELICT_GOVT ? { flags: { startsDisabled: true } }
        : id === LIVE_GOVT ? { flags: { startsDisabled: false } }
            : undefined;

function shipOf(govt?: string): Entity {
    const ship = new Entity();
    if (govt !== undefined) {
        ship.components.set(GovtComponent, { id: govt });
    }
    return ship;
}

/**
 * The one predicate that decides whether a boarded ship can be TAKEN.
 *
 * Both capture routes consult it (the instant bay-capture gate and the
 * plunder session's capture roll) and the dialog greys its Capture Ship
 * button off it, so it had integration coverage on three sides and no
 * direct coverage of its own. These are that: the rule stated once,
 * cheaply, where a change to it fails immediately rather than through
 * whichever live-world spec happens to notice.
 */
describe('capturable', () => {
    it('a crewless hulk can be taken', () => {
        expect(capturable(new Entity(), govts)).toBeTrue();
    });

    it('a ship somebody is FLYING can never be taken', () => {
        // ControlledByComponent is what makes a hull a player's ship. A
        // captured one would answer escort commands from a captain who is
        // not aboard while its owner still flew it.
        const flown = new Entity();
        flown.components.set(ControlledByComponent, { peerId: 'some peer' });
        expect(capturable(flown, govts)).toBeFalse();
    });

    it('is keyed on ControlledBy, NOT on the peer-local ship marker', () => {
        // PlayerShipSelector exists only on the peer whose player it is, so
        // gating on it would let peer A capture peer B's ship while B's own
        // simulation refused — a guaranteed desync. A hull carrying the
        // local marker but no controller is still capturable...
        const markedOnly = new Entity();
        markedOnly.components.set(PlayerShipSelector, undefined);
        expect(capturable(markedOnly, govts)).toBeTrue();

        // ...and one carrying both is refused for the controller alone.
        const bothMarkers = new Entity();
        bothMarkers.components.set(PlayerShipSelector, undefined);
        bothMarkers.components.set(ControlledByComponent,
            { peerId: 'some peer' });
        expect(capturable(bothMarkers, govts)).toBeFalse();
    });

    it('goes back to capturable if the controller is removed', () => {
        // Presence, not history: an abandoned hull is a hulk like any other.
        const ship = new Entity();
        ship.components.set(ControlledByComponent, { peerId: 'some peer' });
        expect(capturable(ship, govts)).toBeFalse();
        ship.components.delete(ControlledByComponent);
        expect(capturable(ship, govts)).toBeTrue();
    });

    /**
     * Ruling #378 ("U9 wave 8", item 5): every one of 29 boards of a
     * derelict-govt hulk read "Capture Odds: 0%" with Capture greyed;
     * the same hull of the neutral govt 363, disabled by the player,
     * could be captured.
     */
    it('a DERELICT (gövt Flags1 0x0800) can never be taken', () => {
        expect(isDerelict(shipOf(DERELICT_GOVT), govts)).toBeTrue();
        expect(capturable(shipOf(DERELICT_GOVT), govts)).toBeFalse();
    });

    it('a hulk of an ordinary government can be', () => {
        expect(isDerelict(shipOf(LIVE_GOVT), govts)).toBeFalse();
        expect(capturable(shipOf(LIVE_GOVT), govts)).toBeTrue();
        // No government, or one the lookup does not know: not a derelict.
        expect(capturable(shipOf(), govts)).toBeTrue();
        expect(capturable(shipOf('nova:999'), govts)).toBeTrue();
    });
});

/** Degrees to radians, for the measured heading gaps. */
const deg = (d: number) => d * Math.PI / 180;

describe('axis alignment gate (the original\'s, ruling #378)', () => {
    const zero = new Angle(0);

    it('accepts parallel axes (same facing)', () => {
        expect(axesAligned(zero, new Angle(0))).toBeTrue();
        expect(axesAligned(new Angle(1), new Angle(1))).toBeTrue();
    });

    it('accepts anti-parallel axes (exactly opposite)', () => {
        expect(axesAligned(zero, new Angle(Math.PI))).toBeTrue();
        expect(axesAligned(new Angle(0.5), new Angle(0.5 + Math.PI)))
            .toBeTrue();
    });

    it('accepts within tolerance of parallel and anti-parallel', () => {
        const inside = AXIS_ALIGN_TOLERANCE_RAD * 0.9;
        expect(axesAligned(zero, new Angle(inside))).toBeTrue();
        expect(axesAligned(zero, new Angle(-inside))).toBeTrue();
        expect(axesAligned(zero, new Angle(Math.PI - inside))).toBeTrue();
    });

    it('rejects perpendicular axes', () => {
        expect(axesAligned(zero, new Angle(Math.PI / 2))).toBeFalse();
        expect(axesAligned(zero, new Angle(-Math.PI / 2))).toBeFalse();
    });

    it('rejects just outside the tolerance', () => {
        const outside = AXIS_ALIGN_TOLERANCE_RAD * 1.1;
        expect(axesAligned(zero, new Angle(outside))).toBeFalse();
        expect(axesAligned(zero, new Angle(Math.PI - outside))).toBeFalse();
    });

    it('boards at every gap the original boarded at, either way', () => {
        // "U9 wave 8", item 1: boards straight from a stop at gaps 0, 5,
        // 7, 9, 13, 17, 24 and 28; sweeps opened at about 25 (three times).
        for (const gap of [0, 5, 7, 9, 13, 17, 24, 25, 28]) {
            expect(axesAligned(zero, new Angle(deg(gap))))
                .withContext(`same way, gap ${gap}`).toBeTrue();
            expect(axesAligned(zero, new Angle(deg(180 - gap))))
                .withContext(`opposite, gap ${gap}`).toBeTrue();
        }
        // The real headings, not just the gaps: hulk -50, player 113.
        expect(axesAligned(new Angle(deg(-50)), new Angle(deg(113))))
            .toBeTrue();
    });

    it('stays silent at the gaps that stayed silent', () => {
        // Silent at 30 (three sweeps), 40, 50, 60, 70 and 80.
        for (const gap of [30, 40, 50, 60, 70, 80]) {
            expect(axesAligned(zero, new Angle(deg(gap))))
                .withContext(`same way, gap ${gap}`).toBeFalse();
            expect(axesAligned(zero, new Angle(deg(180 - gap))))
                .withContext(`opposite, gap ${gap}`).toBeFalse();
        }
    });
});

describe('boarding range (the original\'s square, ruling #378)', () => {
    /** Whether the hulk's centre at (dx, dy) from the boarder's is inside
     * the board square. */
    const inRange = (target: number, boarder: number, dx: number,
        dy: number) => boardingDistance(dx, dy)
            <= boardingRange(target, boarder);

    it('is a square, max(|dx|, |dy|), not a circle', () => {
        expect(boardingDistance(-10, 10)).toEqual(10);
        expect(boardingDistance(3.6, -12.1)).toEqual(12.1);
        // 14.2 px away on the diagonal boarded; 12.7 px away nearly
        // straight down did not: no circle fits that pair.
        expect(inRange(24, 24, -10, 10)).toBeTrue();
        expect(inRange(24, 24, 3.6, 12.1)).toBeFalse();
    });

    it('a 24 px hulk from a 24 px ring: half-side 12', () => {
        expect(boardingRange(24, 24)).toEqual(12);
        for (const [dx, dy] of [[12.0, 2.7], [-10, 10], [6.9, 7.7],
            [-8.8, 1.6]]) {
            expect(inRange(24, 24, dx, dy)).withContext(`${dx}, ${dy}`)
                .toBeTrue();
        }
        for (const [dx, dy] of [[3.6, 12.1], [-12.1, 10], [-12.2, 4.7],
            [0.5, -14.2]]) {
            expect(inRange(24, 24, dx, dy)).withContext(`${dx}, ${dy}`)
                .toBeFalse();
        }
    });

    it('grows with the TARGET\'s sprite (96 px hulk, 24 px ring)', () => {
        expect(inRange(96, 24, -38.9, -23.7)).toBeTrue();
        expect(inRange(96, 24, -47.6, -28.6)).toBeFalse();
    });

    it('grows a little with the BOARDER\'s (24 px hulk, 96 px ring)', () => {
        expect(inRange(24, 96, 10.5, -11.5)).toBeTrue();
        expect(inRange(24, 96, 15.5, -17.5)).toBeFalse();
        expect(boardingRange(24, 96)).toBeGreaterThan(boardingRange(24, 24));
        // The 48 px Lightning (waves 6-7, about 15 / 15.5-16 by centroid):
        // between the 24 px and 96 px rings.
        expect(boardingRange(24, 48)).toBeGreaterThan(boardingRange(24, 24));
        expect(boardingRange(24, 48)).toBeLessThan(15.5);
    });

    it('treats a hull with no frame size as the default width', () => {
        expect(boardingRange(0, 0)).toEqual(boardingRange(
            BOARD_RANGE_DEFAULT_SPRITE_WIDTH,
            BOARD_RANGE_DEFAULT_SPRITE_WIDTH));
    });
});

describe('boardingBlockedReason (the original\'s order, ruling #378)', () => {
    /** A valid board: on top of a 24 px hulk, at rest, aligned. */
    const ok = {
        hasTarget: true,
        targetDisabled: true,
        targetCrew: 2,
        distance: 0,
        range: boardingRange(24, 24),
        relSpeedSquared: 0,
        aligned: true,
    };
    const atSpeed = (pxPerSecond: number) => pxPerSecond * pxPerSecond;

    it('allows a valid board', () => {
        expect(boardingBlockedReason(ok)).toBeNull();
    });

    it('reports the target reasons first', () => {
        expect(boardingBlockedReason({ ...ok, hasTarget: false }))
            .toEqual('noTarget');
        expect(boardingBlockedReason({ ...ok, targetDisabled: false }))
            .toEqual('notDisabled');
        expect(boardingBlockedReason({ ...ok, targetCrew: 0 }))
            .toEqual('noCrew');
    });

    it('is "not close enough" outside the square', () => {
        expect(boardingBlockedReason({ ...ok, distance: ok.range }))
            .toBeNull();
        expect(boardingBlockedReason({ ...ok, distance: ok.range + 0.1 }))
            .toEqual('tooFar');
    });

    it('boards at the speeds the original boarded at', () => {
        // "U9 wave 7": plunder dialog at 3.4, 6.2 and 7.3 px/s.
        for (const speed of [3.4, 6.2, 7.3]) {
            expect(boardingBlockedReason({
                ...ok, distance: 10, relSpeedSquared: atSpeed(speed),
            })).withContext(`${speed} px/s`).toBeNull();
        }
    });

    it('says "not close enough" between the two speed gates, even on top',
        () => {
            // Refused at 7.8 (128 presses), 9.2 and 11 px/s, every press
            // "not close enough", with the ships on top of each other.
            for (const speed of [7.8, 9.2, 11]) {
                expect(boardingBlockedReason({
                    ...ok, distance: 0, relSpeedSquared: atSpeed(speed),
                })).withContext(`${speed} px/s`).toEqual('tooFar');
            }
            // 11 px/s far out is "not close enough" too.
            expect(boardingBlockedReason({
                ...ok, distance: 67, relSpeedSquared: atSpeed(11),
            })).toEqual('tooFar');
        });

    it('checks "too fast" BEFORE the distance', () => {
        // Every press at 16 and 22 px/s said "too fast", 67-70 px from
        // the hulk included, and on top of it.
        for (const speed of [16, 22]) {
            for (const distance of [0, 3.6, 67, 70]) {
                expect(boardingBlockedReason({
                    ...ok, distance, relSpeedSquared: atSpeed(speed),
                })).withContext(`${speed} px/s at ${distance} px`)
                    .toEqual('tooFast');
            }
        }
    });

    it('refuses a misaligned board last, only once everything else holds',
        () => {
            expect(boardingBlockedReason({ ...ok, aligned: false }))
                .toEqual('notAligned');
            // Out of range or in the speed band, the answer is still
            // "not close enough" (wave 8: out-of-range stops said so
            // whatever the heading).
            expect(boardingBlockedReason({
                ...ok, aligned: false, distance: 20,
            })).toEqual('tooFar');
            expect(boardingBlockedReason({
                ...ok, aligned: false, relSpeedSquared: atSpeed(9),
            })).toEqual('tooFar');
        });
});

describe('captureChance (the original\'s odds, ruling #378)', () => {
    /** As the plunder dialog shows it. */
    const shown = (attacker: number, defender: number) =>
        Math.round(captureChance(attacker, defender) * 100);

    it('reads the measured odds for a crew-10 boarder', () => {
        // "U9 wave 8", item 5: crew 10 against 1 / 5 / 10 / 15 / 20 / 40.
        expect(shown(10, 1)).toEqual(75);
        expect(shown(10, 5)).toEqual(34);
        expect(shown(10, 10)).toEqual(20);
        expect(shown(10, 15)).toEqual(18);
        expect(shown(10, 20)).toBeGreaterThanOrEqual(17);
        expect(shown(10, 20)).toBeLessThanOrEqual(18);
        expect(shown(10, 40)).toEqual(7);
    });

    it('tops out at 75%', () => {
        // Crew 500 against crew 1 read 75% too.
        expect(captureChance(500, 1)).toEqual(CAPTURE_CHANCE_MAX);
        expect(CAPTURE_CHANCE_MAX).toEqual(0.75);
        expect(captureChance(1000, 0)).toEqual(CAPTURE_CHANCE_MAX);
    });

    it('rises with the boarders and falls with the defenders', () => {
        let last = 0;
        for (let attacker = 1; attacker <= 200; attacker++) {
            const chance = captureChance(attacker, 20);
            expect(chance).toBeGreaterThanOrEqual(last);
            expect(chance).toBeLessThanOrEqual(CAPTURE_CHANCE_MAX);
            last = chance;
        }
        expect(captureChance(10, 1000)).toEqual(CAPTURE_CHANCE_MIN);
    });

    it('never offers less than 1% to a crewed boarder (Matthew, 2026-11-23)', () => {
        expect(CAPTURE_CHANCE_MIN).toEqual(0.01);
        for (const defender of [1, 40, 1000, 1e6]) {
            expect(captureChance(1, defender))
                .toBeGreaterThanOrEqual(CAPTURE_CHANCE_MIN);
        }
        expect(Math.round(captureChance(1, 1e6) * 100)).toEqual(1);
    });

    it('is zero for a crewless boarder (Bible: cannot capture)', () => {
        expect(captureChance(0, 5)).toEqual(0);
    });

    it('is deterministic for the same crew counts', () => {
        expect(captureChance(7, 3)).toEqual(captureChance(7, 3));
    });
});

describe('money booty (the original\'s, ruling #378)', () => {
    /** Every amount a hull of this price can pay, over every k. */
    function reachable(price: number): number[] {
        const steps = Math.max(1, creditBootyRandomSteps(price));
        return [...Array(steps).keys()].map(k =>
            creditBooty(price, (k + 0.5) / steps));
    }

    it('pays the 1,000 floor for cheap hulls', () => {
        for (const roll of [0, 0.5, 0.999]) {
            expect(creditBooty(2_000, roll)).toEqual(1_000);
            expect(creditBooty(20_000, roll)).toEqual(1_000);
            expect(creditBooty(0, roll)).toEqual(1_000);
            expect(creditBooty(-5, roll)).toEqual(1_000);
        }
    });

    it('pays exactly price / 40 for the 50,000 hull, every board', () => {
        // 24 boards of 50,000 hulls, all 1,250.
        for (const roll of [0, 0.25, 0.5, 0.75, 0.999999]) {
            expect(creditBooty(50_000, roll)).toEqual(1_250);
        }
    });

    it('can pay every amount the original paid', () => {
        const boards: [number, number[]][] = [
            [100_000, [2_500]],
            [200_000, [5_000, 7_000]],
            [300_000, [12_500, 11_500]],
            [500_000, [19_500, 21_500]],
            [750_000, [35_750, 32_750]],
            [1_000_000, [26_000, 45_000]],
            [2_000_000, [87_000]],
        ];
        for (const [price, paid] of boards) {
            const amounts = reachable(price);
            for (const amount of paid) {
                expect(amounts).withContext(`${price}: ${amount}`)
                    .toContain(amount);
            }
        }
    });

    it('stays a multiple of 250 between price / 40 and price / 20', () => {
        for (const price of [50_000, 100_000, 123_456, 200_000, 300_000,
            500_000, 750_000, 1_000_000, 2_000_000, 7_777_777]) {
            for (const amount of reachable(price)) {
                expect(amount % 250).withContext(`${price}`).toEqual(0);
                expect(amount).toBeGreaterThanOrEqual(
                    creditBootyBase(price));
                expect(amount).toBeLessThan(price / 20);
            }
        }
        // The base is price / 40, rounded down to 250.
        expect(creditBootyBase(750_000)).toEqual(18_750);
        expect(creditBootyBase(123_456)).toEqual(3_000);
    });

    it('750,000\'s 35,750 is its very top step', () => {
        expect(creditBooty(750_000, 0.999999)).toEqual(35_750);
        expect(creditBooty(750_000, 0)).toEqual(18_750);
    });
});

describe('booty math', () => {
    it('transfers fuel clamped by victim tank and boarder headroom', () => {
        // Boarder headroom (max - current) is the binding limit.
        expect(fuelTransferAmount(500, 80, 100)).toEqual(20);
        // Victim tank is the binding limit.
        expect(fuelTransferAmount(15, 0, 100)).toEqual(15);
        // Already full.
        expect(fuelTransferAmount(500, 100, 100)).toEqual(0);
        // Never negative.
        expect(fuelTransferAmount(0, 120, 100)).toEqual(0);
    });

    it('plans a cargo plunder capped by free space, in sorted order', () => {
        const cargo = new Map([['cargo:2', 5], ['cargo:0', 4], ['junk:9', 3]]);
        // Free space 6: fills sorted keys cargo:0 (4), then cargo:2 (2).
        expect(planCargoPlunder(cargo, 6)).toEqual([['cargo:0', 4],
            ['cargo:2', 2]]);
        // Free space beyond the load takes all, still sorted.
        expect(planCargoPlunder(cargo, 100)).toEqual([['cargo:0', 4],
            ['cargo:2', 5], ['junk:9', 3]]);
        // No free space takes nothing.
        expect(planCargoPlunder(cargo, 0)).toEqual([]);
    });
});

describe('planAmmoPlunder', () => {
    // Two ammo outfits feed weapon w1 (capacity 10), one feeds w2 (cap 4),
    // and one is ammo for a weapon the boarder doesn't mount (undefined).
    const info = (id: string): AmmoOutfitInfo | undefined => ({
        'ammo:a': { ammoFor: 'w1', capacity: 10 },
        'ammo:b': { ammoFor: 'w1', capacity: 10 },
        'ammo:c': { ammoFor: 'w2', capacity: 4 },
    }[id]);

    it('takes compatible ammo up to remaining capacity, sorted', () => {
        const victim = new Map([['ammo:a', 6], ['ammo:c', 9], ['junk:x', 3]]);
        // Boarder already holds 2 rounds of w1 (cap 10 -> 8 room) and 0 of w2.
        const boarderRounds = new Map([['w1', 2]]);
        expect(planAmmoPlunder(victim, boarderRounds, info))
            // ammo:a: min(6, 10-2)=6; ammo:c: min(9, 4-0)=4; junk:x skipped.
            .toEqual([['ammo:a', 6], ['ammo:c', 4]]);
    });

    it('shares capacity across outfits feeding the same weapon', () => {
        // Both ammo:a and ammo:b feed w1 (cap 10), boarder holds none. First
        // takes 7, leaving only 3 room for the second even though 8 available.
        const victim = new Map([['ammo:a', 7], ['ammo:b', 8]]);
        expect(planAmmoPlunder(victim, new Map(), info))
            .toEqual([['ammo:a', 7], ['ammo:b', 3]]);
    });

    it('takes nothing when the boarder is already full or has no launcher', () => {
        // w1 already full (10/10) and ammo:d has no matching launcher.
        const victim = new Map([['ammo:a', 5], ['ammo:d', 5]]);
        expect(planAmmoPlunder(victim, new Map([['w1', 10]]), info))
            .toEqual([]);
    });
});

describe('bay-capture shortcut gate', () => {
    function bay(overrides: Partial<CaptureBayCandidate> = {}):
        CaptureBayCandidate {
        return {
            bayWeaponId: 'weap:bay',
            shipId: 'ship:fighter',
            maxAmmo: 2,
            mounted: 1,
            held: 0,
            deployed: 0,
            ...overrides,
        };
    }

    it('has room while magazine plus deployed is under capacity', () => {
        expect(bayCaptureRoom(bay({ held: 0, deployed: 0 }))).toBeTrue();
        expect(bayCaptureRoom(bay({ held: 1, deployed: 0 }))).toBeTrue();
        // 1 aboard + 1 out = 2 = MaxAmmo x 1 bay: full.
        expect(bayCaptureRoom(bay({ held: 1, deployed: 1 }))).toBeFalse();
        expect(bayCaptureRoom(bay({ held: 2 }))).toBeFalse();
        expect(bayCaptureRoom(bay({ deployed: 2 }))).toBeFalse();
    });

    it('counts capacity per mounted bay', () => {
        // 2 bays x MaxAmmo 2 = 4.
        expect(bayCaptureRoom(bay({ mounted: 2, held: 2, deployed: 1 })))
            .toBeTrue();
        expect(bayCaptureRoom(bay({ mounted: 2, held: 2, deployed: 2 })))
            .toBeFalse();
    });

    it('treats MaxAmmo <= 0 as unbounded, like refundFighterToBay', () => {
        expect(bayCaptureRoom(bay({ maxAmmo: 0, held: 99, deployed: 99 })))
            .toBeTrue();
    });

    it('never fits a bay the boarder does not mount', () => {
        expect(bayCaptureRoom(bay({ mounted: 0 }))).toBeFalse();
    });

    it('picks no bay when none launches that ship class', () => {
        expect(chooseCaptureBay('ship:cruiser', [bay()])).toBeUndefined();
    });

    it('picks no bay when the only matching one is full', () => {
        expect(chooseCaptureBay('ship:fighter', [bay({ held: 2 })]))
            .toBeUndefined();
    });

    it('prefers the lowest-sorted bay weapon id among bays that fit', () => {
        // Deliberately supplied out of order: the pick must not depend on
        // iteration order of the boarder's weapons.
        expect(chooseCaptureBay('ship:fighter', [
            bay({ bayWeaponId: 'weap:b' }),
            bay({ bayWeaponId: 'weap:a' }),
            bay({ bayWeaponId: 'weap:c' }),
        ])).toEqual('weap:a');
    });

    it('skips a full bay in favor of one with room', () => {
        // A full bay is not a reason to ignore an empty one, even when it
        // sorts first.
        expect(chooseCaptureBay('ship:fighter', [
            bay({ bayWeaponId: 'weap:a', held: 2 }),
            bay({ bayWeaponId: 'weap:b' }),
        ])).toEqual('weap:b');
    });

    it('ignores bays that launch a different ship class', () => {
        expect(chooseCaptureBay('ship:fighter', [
            bay({ bayWeaponId: 'weap:a', shipId: 'ship:drone' }),
            bay({ bayWeaponId: 'weap:b' }),
        ])).toEqual('weap:b');
    });
});

/**
 * The DURABLE plunder record: a hulk gets one plunder per life segment,
 * and the segment ends when it lands and departs or jumps (Matthew's
 * ruling; the Bible's booty model is stateless, so this is entirely
 * NovaJS's rule). These are the two readings of that record every caller
 * shares.
 */
describe('the one-plunder record', () => {
    it('reads a hulk nobody has boarded as unspent', () => {
        expect(plunderSpent(undefined)).toBeFalse();
    });

    it('does not read a MERE boarding mark as spent', () => {
        // Presence is the mission-goal seam; `plundered` is the lock. A
        // record that somehow carries neither must not lock the hulk out.
        expect(plunderSpent({ boarder: 'someone' })).toBeFalse();
        expect(plunderSpent({ boarder: 'someone', active: true }))
            .toBeFalse();
    });

    it('reads a spent hulk as spent, whoever spent it', () => {
        expect(plunderSpent({ boarder: 'the player', plundered: true }))
            .toBeTrue();
        expect(plunderSpent({ boarder: 'npc:pirate', plundered: true }))
            .toBeTrue();
    });

    it('clears the whole record at a life-segment boundary', () => {
        const hulk = new Entity('hulk');
        hulk.components.set(BoardedComponent, {
            boarder: 'the player', plundered: true, creditsTaken: true,
        });
        clearPlunderRecord(hulk);
        expect(hulk.components.has(BoardedComponent)).toBeFalse();
        expect(plunderSpent(hulk.components.get(BoardedComponent)))
            .toBeFalse();
    });

    it('is a no-op on a ship that was never boarded', () => {
        const ship = new Entity('ship');
        clearPlunderRecord(ship);
        expect(ship.components.has(BoardedComponent)).toBeFalse();
    });
});

describe('matchBoardedVelocity (Matthew 2026-11-24)', () => {
    function state(velocity: Vector, targetSpeed?: number): MovementState {
        return {
            position: new Position(10, 20), velocity,
            rotation: new Angle(1), turning: 0.5, turnBack: false,
            accelerating: 0,
            ...(targetSpeed === undefined ? {} : { targetSpeed }),
        };
    }

    it('copies the velocity as a new vector and nothing else', () => {
        const hulkVelocity = new Vector(3, -4);
        const boarder = state(new Vector(7, 0));
        const before = { ...boarder };
        matchBoardedVelocity(boarder, { velocity: hulkVelocity });
        expect(boarder.velocity.x).toBe(3);
        expect(boarder.velocity.y).toBe(-4);
        expect(boarder.velocity).not.toBe(hulkVelocity);
        expect(boarder.position).toBe(before.position);
        expect(boarder.rotation).toBe(before.rotation);
        expect(boarder.turning).toBe(before.turning);
        expect('targetSpeed' in boarder).toBeFalse();
    });

    it('brings an inertialess boarder\'s targetSpeed to the new speed',
        () => {
            const boarder = state(new Vector(7, 0), 7);
            matchBoardedVelocity(boarder,
                { velocity: new Vector(3, -4) });
            expect(boarder.targetSpeed).toBe(5);
        });
});
