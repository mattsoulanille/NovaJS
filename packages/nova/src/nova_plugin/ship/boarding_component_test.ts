import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { ControlledByComponent } from '../player/ship_control.js';
import { PlayerShipSelector } from '../player/player_ship_plugin.js';
import {
    capturable,
    AXIS_ALIGN_TOLERANCE_RAD,
    axesAligned,
    BOARD_DISTANCE_SQUARED,
    BOARD_REL_SPEED_SQUARED,
    boardingBlockedReason,
    captureChance,
    CAPTURE_CHANCE_MAX,
    CAPTURE_CHANCE_MIN,
    creditBooty,
    CREDIT_BOOTY_FRACTION,
    fuelTransferAmount,
    planCargoPlunder,
    planAmmoPlunder,
    AmmoOutfitInfo,
    bayCaptureRoom,
    BoardedComponent,
    CaptureBayCandidate,
    chooseCaptureBay,
    clearPlunderRecord,
    plunderSpent,
} from './boarding_component.js';

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
        expect(capturable(new Entity())).toBeTrue();
    });

    it('a ship somebody is FLYING can never be taken', () => {
        // ControlledByComponent is what makes a hull a player's ship. A
        // captured one would answer escort commands from a captain who is
        // not aboard while its owner still flew it.
        const flown = new Entity();
        flown.components.set(ControlledByComponent, { peerId: 'some peer' });
        expect(capturable(flown)).toBeFalse();
    });

    it('is keyed on ControlledBy, NOT on the peer-local ship marker', () => {
        // PlayerShipSelector exists only on the peer whose player it is, so
        // gating on it would let peer A capture peer B's ship while B's own
        // simulation refused — a guaranteed desync. A hull carrying the
        // local marker but no controller is still capturable...
        const markedOnly = new Entity();
        markedOnly.components.set(PlayerShipSelector, undefined);
        expect(capturable(markedOnly)).toBeTrue();

        // ...and one carrying both is refused for the controller alone.
        const bothMarkers = new Entity();
        bothMarkers.components.set(PlayerShipSelector, undefined);
        bothMarkers.components.set(ControlledByComponent,
            { peerId: 'some peer' });
        expect(capturable(bothMarkers)).toBeFalse();
    });

    it('goes back to capturable if the controller is removed', () => {
        // Presence, not history: an abandoned hull is a hulk like any other.
        const ship = new Entity();
        ship.components.set(ControlledByComponent, { peerId: 'some peer' });
        expect(capturable(ship)).toBeFalse();
        ship.components.delete(ControlledByComponent);
        expect(capturable(ship)).toBeTrue();
    });
});

describe('axis alignment gate (Matthew\'s spec)', () => {
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
});

describe('boardingBlockedReason', () => {
    const ok = {
        hasTarget: true,
        targetDisabled: true,
        targetCrew: 2,
        distanceSquared: BOARD_DISTANCE_SQUARED - 1,
        relSpeedSquared: BOARD_REL_SPEED_SQUARED - 1,
        aligned: true,
    };

    it('allows a valid board', () => {
        expect(boardingBlockedReason(ok)).toBeNull();
    });

    it('reports reasons in priority order', () => {
        expect(boardingBlockedReason({ ...ok, hasTarget: false }))
            .toEqual('noTarget');
        expect(boardingBlockedReason({ ...ok, targetDisabled: false }))
            .toEqual('notDisabled');
        expect(boardingBlockedReason({ ...ok, targetCrew: 0 }))
            .toEqual('noCrew');
        expect(boardingBlockedReason({
            ...ok, distanceSquared: BOARD_DISTANCE_SQUARED,
        })).toEqual('tooFar');
        expect(boardingBlockedReason({
            ...ok, relSpeedSquared: BOARD_REL_SPEED_SQUARED,
        })).toEqual('tooFast');
        expect(boardingBlockedReason({ ...ok, aligned: false }))
            .toEqual('notAligned');
    });
});

describe('captureChance', () => {
    it('is a share of total crew, clamped', () => {
        expect(captureChance(10, 10)).toBeCloseTo(0.5, 9);
        expect(captureChance(30, 10)).toBeCloseTo(0.75, 9);
    });

    it('clamps to the min/max band', () => {
        expect(captureChance(1, 1000)).toEqual(CAPTURE_CHANCE_MIN);
        expect(captureChance(1000, 1)).toEqual(CAPTURE_CHANCE_MAX);
    });

    it('is zero for a crewless boarder (Bible: cannot capture)', () => {
        expect(captureChance(0, 5)).toEqual(0);
    });

    it('is deterministic for the same crew counts', () => {
        expect(captureChance(7, 3)).toEqual(captureChance(7, 3));
    });
});

describe('booty math', () => {
    it('derives money booty from purchase price', () => {
        expect(creditBooty(10_000))
            .toEqual(Math.floor(10_000 * CREDIT_BOOTY_FRACTION));
        expect(creditBooty(0)).toEqual(0);
        expect(creditBooty(-5)).toEqual(0);
    });

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
