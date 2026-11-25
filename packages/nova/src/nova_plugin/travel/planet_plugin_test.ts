import 'jasmine';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import {
    getIntegrationGameData, getSyntheticGameData,
} from '../../communication/simulation_test_fixture.js';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { GameDataAggregator } from '../../server/parsing/game_data_aggregator.js';
import { completeEntity } from '../spawn/index.js';
import { makeShip } from '../ship/index.js';
import { makeSystem } from '../make_system.js';
import { PlayerShipSelector } from '../player/index.js';
import { applyControlEvents } from '../player/index.js';
import {
    applySetPlanetTarget, holdsGateClearance, HYPERGATE_SELECT_RANGE,
    inLandingZone, LAND_RANGE_CAP, LANDING_REQUEST_FORMS,
    LAND_RANGE_PER_FRAME_WIDTH, LAND_SPEED_SQUARED, LandEvent,
    LandingBlockedEvent, LandingClearedEvent, landingDistance, landingRange,
    LandingRequest, LandingRequestEvent, landingRequestForm,
    PlanetComponent, selectPlanetTarget,
    PlanetDataComponent, PlanetTargetComponent, StellarBribesComponent, STELLAR_BRIBE_MS, stellarClearanceFor,
    stellarLandingRange, StellarHaggleComponent,
} from './planet_plugin.js';
import { getDefaultPlanetData, PlanetData } from 'novadatainterface/planet_data';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { applyHail } from '../encounters/index.js';
import { prepareCarriedEntitiesForFreshWorld } from '../pilot/index.js';
import { CreditsComponent, GameDateComponent } from '../player/index.js';
import {
    bribeDay, GovtsResource, LegalRecordsComponent, planetLowerPriceCounters,
    planetRefusesBribe,
} from '../reputation/index.js';
import { landable } from '../core/index.js';
import {
    clearanceDeniedMessage, hypergateClearedMessage, landingBlockedMessage,
    landingRequestMessage,
} from '../../display/status_bar_content.js';

// Thessaly Reach holds four stellars, in this order: Port Amberline (a
// full-service port anyone may land on), the Sallow Moon (landable,
// uninhabited), Coldharbour (MinStatus 0, govt Amber Compact, whose worlds
// take bribes at the larger rate) and the Ossian Giant (unlandable).
const SYSTEM = SYNTHETIC.systems.thessaly;
/** The unlandable gas giant of the starting system. */
const GIANT = `planet ${SYNTHETIC.planets.giant}`;
const SHIP_UUID = 'landing test ship';

async function makeHarness(
    dataSource: Promise<GameDataAggregator> = getSyntheticGameData(),
    systemId: string = SYSTEM) {
    const gameData = await dataSource;
    const ids = await gameData.ids;
    const world = await makeSystem(systemId, gameData);

    const shipId = [...ids.Ship].sort()[0]!;
    const shipData = await gameData.data.Ship.get(shipId);
    const ship = makeShip(shipData);
    ship.components.set(PlayerShipSelector, undefined);
    await completeEntity(world, ship);
    world.entities.set(SHIP_UUID, ship);

    // One step so the providers attach PlanetTargetComponent to the ship.
    world.step();
    return { world, ship };
}

function stellars(world: World): { uuid: string, position: Position }[] {
    const out: { uuid: string, position: Position }[] = [];
    for (const [uuid, entity] of world.entities) {
        if (entity.components.has(PlanetComponent)) {
            out.push({
                uuid,
                position: entity.components.get(MovementStateComponent)!.position,
            });
        }
    }
    return out;
}

function place(ship: Entity, position: Position, velocity = new Vector(0, 0)) {
    const movement = ship.components.get(MovementStateComponent)!;
    movement.position = position;
    movement.velocity = velocity;
}

function pressLand(world: World) {
    const lands: { id: string, uuid: string }[] = [];
    const blocked: { reason: string, isStation: boolean, entities?: unknown,
        stellarName?: string, gateKind?: 'hypergate' | 'wormhole' }[] = [];
    world.events.get(LandEvent).subscribe(({ data }) => lands.push(data));
    world.events.get(LandingBlockedEvent).subscribe(({ data, entities }) =>
        blocked.push({ ...data, entities }));
    applyControlEvents(world, undefined, [{ action: 'land', state: 'start' }]);
    world.step();
    return { lands, blocked };
}

describe('AttemptLandingSystem', () => {
    it('selects the nearest stellar when nothing is targeted', async () => {
        const { world, ship } = await makeHarness();
        const planets = stellars(world);
        // Sitting exactly on one stellar makes it unambiguously nearest.
        // (planets[0] is Port Amberline, the system's first stellar.)
        place(ship, planets[0].position);
        expect(ship.components.get(PlanetTargetComponent)!.target)
            .toBeUndefined();

        const { lands } = pressLand(world);

        expect(ship.components.get(PlanetTargetComponent)!.target)
            .toEqual(planets[0].uuid);
        // First press only selects; it never lands.
        expect(lands).toEqual([]);
    }, 30_000);

    it('skips stellars that are not ports when picking the nearest '
        + '(sitting on the gas giant, "l" selects the nearest LANDABLE '
        + 'stellar)',
        async () => {
            const { world, ship } = await makeHarness();
            const giant = [...world.entities].find(([, e]) => {
                const data = e.components.get(PlanetDataComponent);
                return data !== undefined && !landable(data);
            });
            expect(giant).toBeDefined();
            const [giantUuid, giantEntity] = giant!;
            place(ship, giantEntity.components
                .get(MovementStateComponent)!.position);

            pressLand(world);

            const target = ship.components.get(PlanetTargetComponent)!.target;
            expect(target).toBeDefined();
            expect(target).not.toEqual(giantUuid);
            expect(landable(world.entities.get(target!)!.components
                .get(PlanetDataComponent)!)).toBeTrue();
        }, 30_000);

    it('lands on the ALREADY-selected stellar when in range and slow', async () => {
        const { world, ship } = await makeHarness();
        const planets = stellars(world);
        const target = planets[0];
        ship.components.get(PlanetTargetComponent)!.target = target.uuid;
        place(ship, target.position);

        const { lands, blocked } = pressLand(world);

        expect(blocked).toEqual([]);
        expect(lands.length).toBe(1);
        expect(lands[0].uuid).toEqual(target.uuid);
        // The selection is unchanged: it lands on the target, never retargets.
        expect(ship.components.get(PlanetTargetComponent)!.target)
            .toEqual(target.uuid);
    }, 30_000);

    it('does NOT retarget to the nearest when a far stellar is selected', async () => {
        const { world, ship } = await makeHarness();
        const planets = stellars(world);
        const near = planets[0];
        const selected = planets[1];
        // Sit on the near stellar, but keep the far one selected.
        ship.components.get(PlanetTargetComponent)!.target = selected.uuid;
        place(ship, new Position(selected.position.x + 5000,
            selected.position.y));

        const { lands, blocked } = pressLand(world);

        // Feedback, no land, and crucially the selection stays put.
        expect(lands).toEqual([]);
        expect(blocked.length).toBe(1);
        expect(blocked[0].reason).toEqual('tooFar');
        expect(ship.components.get(PlanetTargetComponent)!.target)
            .toEqual(selected.uuid);
        expect(ship.components.get(PlanetTargetComponent)!.target)
            .not.toEqual(near.uuid);
    }, 30_000);

    it('reports too-fast when over the selected stellar but moving', async () => {
        const { world, ship } = await makeHarness();
        const planets = stellars(world);
        const target = planets[0];
        ship.components.get(PlanetTargetComponent)!.target = target.uuid;
        // On the stellar (in range) but well above the landing speed gate.
        place(ship, target.position, new Vector(100, 0));

        const { lands, blocked } = pressLand(world);

        expect(lands).toEqual([]);
        expect(blocked.length).toBe(1);
        expect(blocked[0].reason).toEqual('tooFast');
    }, 30_000);

    it('refuses to land on an UNLANDABLE stellar (the gas giant) even from '
        + 'a dead stop right on top of it', async () => {
            const { world, ship } = await makeHarness();
            // The Ossian Giant has the spöb can-land bit clear.
            const giant = stellars(world).find(p => p.uuid === GIANT)!;
            ship.components.get(PlanetTargetComponent)!.target = giant.uuid;
            place(ship, giant.position);

            const { lands, blocked } = pressLand(world);

            expect(lands).toEqual([]);
            expect(blocked.length).toBe(1);
            expect(blocked[0].reason).toEqual('unlandable');
            expect(blocked[0].entities).toEqual([SHIP_UUID]);
            expect((blocked[0] as { stellarName?: string }).stellarName)
                .toEqual('Ossian Giant');
        }, 30_000);

    it('still reports the approach window first for an unlandable stellar',
        async () => {
            // Range and speed are what the original answers first; the
            // "unable to land" refusal is the answer to a request you were
            // actually close enough to make.
            const { world, ship } = await makeHarness();
            const giant = stellars(world).find(p => p.uuid === GIANT)!;
            ship.components.get(PlanetTargetComponent)!.target = giant.uuid;
            place(ship, new Position(giant.position.x + 5000,
                giant.position.y));

            const { blocked } = pressLand(world);

            expect(blocked.length).toBe(1);
            expect(blocked[0].reason).toEqual('tooFar');
        }, 30_000);

    it('still lands on an ordinary port in the same system', async () => {
        const { world, ship } = await makeHarness();
        const port = stellars(world)
            .find(p => p.uuid === `planet ${SYNTHETIC.planets.port}`)!;
        ship.components.get(PlanetTargetComponent)!.target = port.uuid;
        place(ship, port.position);

        const { lands, blocked } = pressLand(world);

        expect(blocked).toEqual([]);
        expect(lands.length).toBe(1);
    }, 30_000);

    it('targets the player ship with the blocked feedback event', async () => {
        const { world, ship } = await makeHarness();
        const planets = stellars(world);
        ship.components.get(PlanetTargetComponent)!.target = planets[1].uuid;
        place(ship, new Position(planets[1].position.x + 5000,
            planets[1].position.y));

        const { blocked } = pressLand(world);

        expect(blocked.length).toBe(1);
        expect(blocked[0].entities).toEqual([SHIP_UUID]);
    }, 30_000);
});

/**
 * The landing zone measured on the original (docs/reference_experiments.md,
 * "U9 wave 6: landing range of the tiny stations", which re-reads wave 4's
 * runs): a SQUARE, max(|dx|, |dy|) <= R, R = min(1.7 W, 212) from the
 * frame's width W; the speed gate is an absolute 20 px/s ("U9 wave 4").
 */
describe('landingRange', () => {
    it('is 1.7 x the frame WIDTH, capped at 212 px', () => {
        expect(LAND_RANGE_PER_FRAME_WIDTH).toBe(1.7);
        expect(LAND_RANGE_CAP).toBe(212);
        expect(landingRange([40, 40])).toBeCloseTo(68, 9);
        expect(landingRange([112, 112])).toBeCloseTo(190.4, 9);
        expect(landingRange([250, 250])).toBe(212);
        expect(landingRange([325, 325])).toBe(212);
    });

    it('reads the width, never the height (tall and wide stations)', () => {
        // 15x21 -> 25.5 and 17x31 -> 28.9, not 35.7 and 52.7; 35x22 ->
        // 59.5, not 37.4.
        expect(landingRange([15, 21])).toBeCloseTo(25.5, 9);
        expect(landingRange([17, 31])).toBeCloseTo(28.9, 9);
        expect(landingRange([35, 22])).toBeCloseTo(59.5, 9);
        expect(landingRange([315, 200])).toBe(212);
    });

    it('measures the zone as a square (max(|dx|, |dy|), inclusive)', () => {
        expect(landingDistance(-28, -22)).toBe(28);
        expect(landingDistance(3, -40)).toBe(40);
        expect(inLandingZone(50, 50, 50)).toBeTrue();
        expect(inLandingZone(50, 50.01, 50)).toBeFalse();
        expect(inLandingZone(-50, 0, 50)).toBeTrue();
    });

    it('gives the default PlanetData, and unknown data, the 50 px frame\'s '
        + '85 px zone', () => {
            expect(stellarLandingRange(getDefaultPlanetData())).toBe(85);
            expect(stellarLandingRange(undefined)).toBe(85);
            // Game-data JSON written before the field existed.
            const old: Partial<PlanetData> = getDefaultPlanetData();
            delete old.spriteFrameSize;
            expect(stellarLandingRange(old as PlanetData)).toBe(85);
        });

    it('gates speed at 20 px/s', () => {
        expect(LAND_SPEED_SQUARED).toBe(400);
    });
});

/**
 * Every measured bracket of "U9 waves 4 and 6" against the rule, pressed
 * through the real AttemptLandingSystem at rest: the stop that landed must
 * land, the stop before it must be "too far". Port Amberline stands in for
 * every stellar with its sprite frame swapped (the station flag changes
 * nothing measurable: wave 6 finding 3).
 */
describe('AttemptLandingSystem square zone vs the measured brackets', () => {
    const PORT = `planet ${SYNTHETIC.planets.port}`;
    /** One measured stop: the stellar's offset (dx, dy) from the player,
     * screen axes, and what the original answered there. */
    type Stop = [dx: number, dy: number];

    /** One harness for many presses: each press re-sizes the frame and
     * re-places the ship, then presses land once. */
    async function presser() {
        const { world, ship } = await makeHarness();
        const planet = world.entities.get(PORT)!;
        const centre = planet.components.get(MovementStateComponent)!.position;
        const lands: unknown[] = [];
        const blocked: string[] = [];
        world.events.get(LandEvent).subscribe(({ data }) => lands.push(data));
        world.events.get(LandingBlockedEvent).subscribe(({ data }) =>
            blocked.push(data.reason));
        return (frame: [number, number], [dx, dy]: Stop) => {
            planet.components.set(PlanetDataComponent, {
                ...planet.components.get(PlanetDataComponent)!,
                spriteFrameSize: frame,
            });
            ship.components.get(PlanetTargetComponent)!.target = PORT;
            // The stellar sits at (dx, dy) from the player.
            place(ship, new Position(centre.x - dx, centre.y - dy));
            lands.length = 0;
            blocked.length = 0;
            applyControlEvents(world, undefined,
                [{ action: 'land', state: 'start' }]);
            world.step();
            return lands.length === 1 && blocked.length === 0
                ? 'landed' : blocked.join(',');
        };
    }

    // Wave 6's runs, with the offsets of each stop ("U9 wave 6" first
    // table): too far at, landed at.
    const runs: Array<[string, [number, number], Stop, Stop]> = [
        ['15x21 station, coarse', [15, 21], [30.5, -14], [17.5, -9]],
        ['17x31 station, coarse (34.5 px straight below: too far)',
            [17, 31], [-6, 34], [-8, 22]],
        ['17x31 station, fine (35.6 px on the diagonal: landed)',
            [17, 31], [-34, -28], [-28, -22]],
        ['17x31 art with planet flags, fine', [17, 31], [-19, 35], [-16, 28]],
        ['35x22 station, coarse', [35, 22], [54, 70], [38, 48]],
        ['35x22 station, fine', [35, 22], [10, 63], [9, 55]],
        ['40x40 planet, Mini hull control', [40, 40], [-7, -88], [-5, -61]],
    ];
    for (const [name, frame, tooFar, landed] of runs) {
        it(`matches wave 6's ${name}`, async () => {
            const press = await presser();
            expect(press(frame, tooFar)).toEqual('tooFar');
            expect(press(frame, landed)).toEqual('landed');
        }, 30_000);
    }

    it('lands the 17x31 diagonal stop that is FARTHER than the straight '
        + 'stop it refuses (a square, not a circle)', async () => {
            const press = await presser();
            const diagonal: Stop = [-28, -22];
            const straight: Stop = [-6, 34];
            expect(Math.hypot(...diagonal))
                .toBeGreaterThan(Math.hypot(...straight));
            expect(press([17, 31], diagonal)).toEqual('landed');
            expect(press([17, 31], straight)).toEqual('tooFar');
        }, 30_000);

    // The second table: every at-rest bracket of waves 4 and 6 as
    // max(|dx|, |dy|) (too far / landed), by frame. Pressed straight out
    // along x, where the square distance is the plain distance.
    const brackets: Array<[[number, number], number, number]> = [
        [[15, 21], 28, 20],
        [[17, 31], 34, 28],
        [[35, 22], 63, 55],
        [[40, 40], 87, 63],
        [[72, 72], 131, 103],
        [[80, 80], 140, 117.5],
        [[88, 88], 167, 146],
        [[96, 96], 175.5, 154.5],
        [[112, 112], 201.5, 177.5],
        [[250, 250], 235.5, 209.5],
        [[325, 325], 213, 199],
    ];
    it('matches every square bracket of waves 4 and 6', async () => {
        const press = await presser();
        for (const [frame, tooFar, landed] of brackets) {
            expect(press(frame, [tooFar, 0]))
                .withContext(`${frame} too far at ${tooFar}`)
                .toEqual('tooFar');
            expect(press(frame, [0, -landed]))
                .withContext(`${frame} landed at ${landed}`)
                .toEqual('landed');
        }
    }, 30_000);

    it('misses the 315x200 art\'s 213.5 px landing by 1.5 px, inside the '
        + 'big sprites\' 2-5 px centre error, as any cap must', async () => {
            // 315x200 landed at 213.5 while the 325 px art was too far at
            // 213: no single cap fits both, so the two are one bracket read
            // within the error of a clipped sprite's centre.
            const press = await presser();
            expect(press([315, 200], [229.5, 0])).toEqual('tooFar');
            expect(press([315, 200], [213.5 - 2, 0])).toEqual('landed');
            expect(213.5 - LAND_RANGE_CAP).toBeLessThanOrEqual(2);
        }, 30_000);

    it('agrees with wave 4\'s circular (Euclidean) brackets', () => {
        // Wave 4 measured distance from the centre, not the offsets. A stop
        // at Euclidean distance d has max(|dx|, |dy|) between d / sqrt 2
        // and d, so the square agrees with a bracket exactly when the
        // landed stop could be inside (d / sqrt 2 <= R) and the too-far
        // stop outside (d > R). (Wave 4's moving runs are not landings: no
        // ship that fast lands, finding 2.)
        const circle: Array<[[number, number], number, number]> = [
            [[40, 40], 99, 72],
            [[72, 72], 131, 103],
            [[80, 80], 178, 150],
            [[88, 88], 210, 182],
            [[96, 96], 238, 211],
            [[112, 112], 233, 205],
            [[150, 150], 277, 235],
            [[250, 250], 255, 229],
            [[315, 200], 308, 280],
            [[325, 325], 275, 247],
        ];
        for (const [frame, tooFar, landed] of circle) {
            const range = landingRange(frame);
            expect(landed / Math.SQRT2).withContext(`${frame} landed`)
                .toBeLessThanOrEqual(range);
            expect(tooFar).withContext(`${frame} too far`)
                .toBeGreaterThan(range);
        }
    });
});

describe('AttemptLandingSystem landing window', () => {
    const PORT = `planet ${SYNTHETIC.planets.port}`;
    const MOON = `planet ${SYNTHETIC.planets.moon}`;

    async function atStellar(uuid: string, spriteFrameSize?: [number, number]) {
        const harness = await makeHarness();
        const stellar = stellars(harness.world).find(p => p.uuid === uuid)!;
        harness.ship.components.get(PlanetTargetComponent)!.target = uuid;
        if (spriteFrameSize) {
            // A copy: the component holds the shared cached PlanetData.
            const planet = harness.world.entities.get(uuid)!;
            planet.components.set(PlanetDataComponent, {
                ...planet.components.get(PlanetDataComponent)!,
                spriteFrameSize,
            });
        }
        return { ...harness, stellar };
    }

    /** Presses land with the ship `offset` px east of the stellar's centre. */
    async function pressAt(uuid: string, offset: number,
        velocity = new Vector(0, 0), spriteFrameSize?: [number, number]) {
        const { world, ship, stellar } = await atStellar(uuid, spriteFrameSize);
        place(ship, new Position(stellar.position.x + offset,
            stellar.position.y), velocity);
        return pressLand(world);
    }

    it('reads the range from the stellar\'s sprite: Port Amberline\'s '
        + '40 px frame lands within 68 px', async () => {
            const { world } = await atStellar(PORT);
            const data = world.entities.get(PORT)!
                .components.get(PlanetDataComponent)!;
            expect(data.spriteFrameSize).toEqual([40, 40]);
            expect(stellarLandingRange(data)).toBeCloseTo(68, 9);

            const inside = await pressAt(PORT, 67);
            expect(inside.blocked).toEqual([]);
            expect(inside.lands.length).toBe(1);

            const outside = await pressAt(PORT, 69);
            expect(outside.lands).toEqual([]);
            expect(outside.blocked.map(b => b.reason)).toEqual(['tooFar']);
        }, 30_000);

    it('gives a smaller sprite a smaller range: the Sallow Moon\'s 28 px '
        + 'frame lands within 47.6 px', async () => {
            expect((await pressAt(MOON, 47)).lands.length).toBe(1);
            expect((await pressAt(MOON, 48)).blocked.map(b => b.reason))
                .toEqual(['tooFar']);
        }, 30_000);

    it('lands on a big planet from far out (a 325 px frame lands within '
        + '212 px)', async () => {
            const big: [number, number] = [325, 325];
            expect((await pressAt(PORT, 211, undefined, big)).lands.length)
                .toBe(1);
            expect((await pressAt(PORT, 213, undefined, big)).blocked
                .map(b => b.reason)).toEqual(['tooFar']);
        }, 30_000);

    it('lands below 20 px/s and refuses at or above it, whatever the hull',
        async () => {
            // Moving across the radius, so the step barely changes the
            // distance.
            const slow = await pressAt(PORT, 40, new Vector(0, 19));
            expect(slow.blocked).toEqual([]);
            expect(slow.lands.length).toBe(1);

            const fast = await pressAt(PORT, 40, new Vector(0, 21));
            expect(fast.lands).toEqual([]);
            expect(fast.blocked.map(b => b.reason)).toEqual(['tooFast']);
        }, 30_000);

    it('answers "too far" before "too fast"', async () => {
        const { blocked } = await pressAt(PORT, 120, new Vector(0, 100));
        expect(blocked.map(b => b.reason)).toEqual(['tooFar']);
    }, 30_000);
});

/**
 * Landing CLEARANCE: Coldharbour is an Amber Compact world with MinStatus
 * 0, so it admits a clean pilot and shuts out a criminal.
 */
describe('AttemptLandingSystem landing clearance', () => {
    const COLDHARBOUR = `planet ${SYNTHETIC.planets.coldharbour}`;

    /** Puts the ship on Coldharbour, at a dead stop, with it selected. */
    function overColdharbour(world: World, ship: Entity) {
        const stellar = stellars(world).find(p => p.uuid === COLDHARBOUR)!;
        ship.components.get(PlanetTargetComponent)!.target = stellar.uuid;
        place(ship, stellar.position);
        return stellar;
    }

    it('refuses a criminal landing clearance with the original\'s message',
        async () => {
            const { world, ship } = await makeHarness();
            overColdharbour(world, ship);
            // A record below Coldharbour's MinStatus of 0.
            ship.components.set(LegalRecordsComponent,
                new Map([[SYSTEM, -1]]));

            const { lands, blocked } = pressLand(world);

            expect(lands).toEqual([]);
            expect(blocked.length).toBe(1);
            expect(blocked[0].reason).toEqual('denied');
            expect(blocked[0].entities).toEqual([SHIP_UUID]);
            // STR# 2002 index 82, verbatim (Coldharbour is a planet, not a
            // station, so it is the landing form).
            expect(blocked[0].isStation).toBeFalse();
            expect(clearanceDeniedMessage(blocked[0].isStation))
                .toEqual('Landing request denied.');
        }, 30_000);

    it('clears the same pilot once the record is back at MinStatus',
        async () => {
            const { world, ship } = await makeHarness();
            overColdharbour(world, ship);
            ship.components.set(LegalRecordsComponent,
                new Map([[SYSTEM, 0]]));

            const { lands, blocked } = pressLand(world);

            expect(blocked).toEqual([]);
            expect(lands.length).toBe(1);
        }, 30_000);

    it('answers the approach window BEFORE the clearance refusal', async () => {
        const { world, ship } = await makeHarness();
        const stellar = overColdharbour(world, ship);
        ship.components.set(LegalRecordsComponent,
            new Map([[SYSTEM, -1000]]));
        place(ship,
            new Position(stellar.position.x + 5000, stellar.position.y));

        const { blocked } = pressLand(world);

        expect(blocked.length).toBe(1);
        expect(blocked[0].reason).toEqual('tooFar');
    }, 30_000);

    // REAL data: HG-V01 (nova:1400, VNP-001 nova:427) is a working gate of
    // MinStatus 32767, shut to a pilot without the hypergate rank. The
    // original's `l` there said "Hypergate usage denied." (STR# 2002 index
    // 80; reference "Stellar hail graphic, wave 23"), so the refusal carries
    // the gate kind for the status line to pick that line.
    it('refuses a working hypergate as a hypergate', async () => {
        const { world, ship } = await makeHarness(getIntegrationGameData(),
            'nova:427');
        const gate = stellars(world).find(p => world.entities.get(p.uuid)
            ?.components.get(PlanetComponent)?.id === 'nova:1400')!;
        expect(gate).toBeDefined();
        ship.components.get(PlanetTargetComponent)!.target = gate.uuid;
        place(ship, gate.position);

        const { lands, blocked } = pressLand(world);

        expect(lands).toEqual([]);
        expect(blocked.length).toBe(1);
        expect(blocked[0].reason).toEqual('denied');
        expect(blocked[0].gateKind).toEqual('hypergate');
        expect(landingBlockedMessage('denied', blocked[0].isStation,
            blocked[0].stellarName, blocked[0].gateKind))
            .toEqual('Hypergate usage denied.');
    }, 30_000);

    // ... and wave 23's `l` there was the FIRST one (vnp/*/03-l1.png): the
    // press that targets a hypergate answers with its clearance at once.
    it('refuses a working hypergate on the first `l`', async () => {
        const { world, ship } = await makeHarness(getIntegrationGameData(),
            'nova:427');
        const gate = stellars(world).find(p => world.entities.get(p.uuid)
            ?.components.get(PlanetComponent)?.id === 'nova:1400')!;
        expect(gate).toBeDefined();
        ship.components.get(PlanetTargetComponent)!.target = undefined;
        place(ship, gate.position);
        const cleared: unknown[] = [];
        world.events.get(LandingClearedEvent)
            .subscribe(({ data }) => cleared.push(data));

        const { lands, blocked } = pressLand(world);

        expect(ship.components.get(PlanetTargetComponent)!.target)
            .toEqual(gate.uuid);
        expect(lands).toEqual([]);
        expect(cleared).toEqual([]);
        expect(blocked.map(b => [b.reason, b.gateKind]))
            .toEqual([['denied', 'hypergate']]);
    }, 30_000);

    // Stays on REAL data (Sol): the exemption is about the STOCK
    // hypergates' MinStatus 32767, a value the synthetic scenario has no
    // stellar for — its gates are ordinary MinStatus -32767 rings.
    it('lets a criminal through the working hypergates, whose MinStatus '
        + '32767 is not a shut port', async () => {
            const SOL = 'nova:130';
            const { world } = await makeHarness(getIntegrationGameData(),
                'nova:130');
            // Sol's stellars include the collapsed HG-Aldebaran; find any
            // stellar that IS a live gate to confirm the exemption applies to
            // the parsed data, not just to the pure predicate.
            const gate = [...world.entities].find(([, e]) =>
                e.components.get(PlanetDataComponent)?.minStatus === 32767);
            if (!gate) {
                // Sol carries no live hypergate; the exemption is pinned in
                // stellar_clearance_test against the whole stock set.
                return;
            }
            const data = gate[1].components.get(PlanetDataComponent)!;
            expect(stellarClearanceFor({
                planetData: data,
                gameData: (await getIntegrationGameData()) as never,
                records: new Map([[SOL, -30000]]),
                planetId: gate[1].components.get(PlanetComponent)!.id,
                systemId: SOL,
                now: 0,
            }).cleared).toBeTrue();
        }, 30_000);
});

describe('planet bribes', () => {
    /** Coldharbour: MinStatus 0, and its govt's worlds take bribes. */
    const PORT = `planet ${SYNTHETIC.planets.coldharbour}`;
    const PORT_ID = SYNTHETIC.planets.coldharbour;

    async function shutOutHarness() {
        const { world, ship } = await makeHarness();
        const stellar = stellars(world).find(p => p.uuid === PORT)!;
        ship.components.get(PlanetTargetComponent)!.target = stellar.uuid;
        place(ship, stellar.position);
        ship.components.set(LegalRecordsComponent,
            new Map([[SYSTEM, -1]]));
        ship.components.set(CreditsComponent, { credits: 100_000 });
        return { world, ship, stellar };
    }

    it('grants temporary clearance, charges for it, and then the landing '
        + 'succeeds', async () => {
            const { world, ship } = await shutOutHarness();

            // Refused before paying.
            expect(pressLand(world).blocked[0].reason).toEqual('denied');

            applyHail(world, undefined, { kind: 'bribe', target: PORT });

            // Charged: the Amber Compact sets largerBribes, so its planet
            // asks 4,000 (hail.ts's planetBribePrice, reference "R7 bribe
            // price, wave 22"; no growth under 1M, a third of 100,000 is
            // no cap).
            expect(ship.components.get(CreditsComponent)!.credits)
                .toEqual(100_000 - 4_000);
            const bribes = ship.components.get(StellarBribesComponent)!;
            // Keyed by the stellar's NOVA id, not its entity uuid.
            expect(bribes.get(PORT_ID)).toBeDefined();

            const { lands, blocked } = pressLand(world);
            expect(blocked).toEqual([]);
            expect(lands.length).toBe(1);
        }, 30_000);

    it('expires: the same stellar refuses again once the reprieve lapses',
        async () => {
            const { world, ship } = await shutOutHarness();
            applyHail(world, undefined, { kind: 'bribe', target: PORT });
            const bribes = ship.components.get(StellarBribesComponent)!;
            // Wind the clearance back into the past rather than the clock
            // forward: expiry is a pure comparison against TimeResource.
            bribes.set(PORT_ID, -1);

            expect(pressLand(world).blocked[0].reason).toEqual('denied');
            // ...and the reprieve really was STELLAR_BRIBE_MS long.
            applyHail(world, undefined, { kind: 'bribe', target: PORT });
            expect(bribes.get(PORT_ID)).toBeGreaterThanOrEqual(
                STELLAR_BRIBE_MS);
        }, 30_000);

    it('will not sell clearance the player already has', async () => {
        const { world, ship } = await makeHarness();
        ship.components.set(CreditsComponent, { credits: 10_000 });
        ship.components.set(LegalRecordsComponent, new Map([[SYSTEM, 0]]));

        applyHail(world, undefined, { kind: 'bribe', target: PORT });

        expect(ship.components.get(CreditsComponent)!.credits).toEqual(10_000);
        expect(ship.components.has(StellarBribesComponent)).toBeFalse();
    }, 30_000);

    it('a third of the cash caps the price; a pilot under the 1,000 floor '
        + 'cannot pay it at all (R7 wave 22, finding 2)', async () => {
            const { world, ship } = await shutOutHarness();
            // 4,000 capped to a third of 9,000.
            ship.components.set(CreditsComponent, { credits: 9_000 });
            applyHail(world, undefined, { kind: 'bribe', target: PORT });
            expect(ship.components.get(CreditsComponent)!.credits)
                .toEqual(6_000);
            expect(pressLand(world).blocked).toEqual([]);

            // 300 credits are asked 1,000 (hail.ts BRIBE_MINIMUM), as the
            // original asked; nothing is taken and the port stays shut.
            const poor = await shutOutHarness();
            poor.ship.components.set(CreditsComponent, { credits: 300 });
            applyHail(poor.world, undefined, { kind: 'bribe', target: PORT });
            expect(poor.ship.components.get(CreditsComponent)!.credits)
                .toEqual(300);
            expect(pressLand(poor.world).blocked[0].reason)
                .toEqual('denied');
        }, 30_000);

    it('takes nothing from a penniless pilot and leaves the port shut',
        async () => {
            const { world, ship } = await shutOutHarness();
            ship.components.set(CreditsComponent, { credits: 0 });

            applyHail(world, undefined, { kind: 'bribe', target: PORT });

            expect(ship.components.get(CreditsComponent)!.credits).toEqual(0);
            expect(ship.components.has(StellarBribesComponent)).toBeFalse();
            expect(pressLand(world).blocked[0].reason).toEqual('denied');
        }, 30_000);

    it('an ordinary (0x4000) port sometimes refuses outright: nothing is '
        + 'charged and the port stays shut (reference "R7 bribe price above '
        + '1M, wave 27")', async () => {
            // Coldharbour's govt as a PLAIN bargainer (0x4000 without
            // 0x8000, whose planets always take bribes). A per-world copy:
            // the cached govt data is shared.
            const plainPort = async (day: number) => {
                const harness = await shutOutHarness();
                const govts = harness.world.resources.get(GovtsResource)!;
                const id = SYNTHETIC.govts.compact;
                const govt = govts.get(id)!;
                govts.set(id, { ...govt, flags: { ...govt.flags,
                    planetsTakeBribes: true, largerBribes: false } });
                harness.ship.components.set(GameDateComponent,
                    { day, month: 1, year: 1177 });
                return harness;
            };
            // The draw is per planet, pilot and day: refused on the 3rd,
            // priced on the 2nd.
            expect(planetRefusesBribe(PORT, SHIP_UUID, false,
                { day: 3, month: 1, year: 1177 })).toBeTrue();
            expect(planetRefusesBribe(PORT, SHIP_UUID, false,
                { day: 2, month: 1, year: 1177 })).toBeFalse();

            const refused = await plainPort(3);
            applyHail(refused.world, undefined,
                { kind: 'bribe', target: PORT });
            expect(refused.ship.components.get(CreditsComponent)!.credits)
                .toEqual(100_000);
            expect(refused.ship.components.has(StellarBribesComponent))
                .toBeFalse();
            expect(pressLand(refused.world).blocked[0].reason)
                .toEqual('denied');

            const priced = await plainPort(2);
            applyHail(priced.world, undefined,
                { kind: 'bribe', target: PORT });
            // A plain planet's 3,000 (no growth under 1M).
            expect(priced.ship.components.get(CreditsComponent)!.credits)
                .toEqual(100_000 - 3_000);
            expect(pressLand(priced.world).blocked).toEqual([]);
        }, 30_000);

    /** The first day of Jan 1177 on which this port's first Lower Price
     * counters (or withdraws): the draw is per planet, pilot and day. */
    function dayWhere(counters: boolean) {
        for (let day = 1; day <= 31; day++) {
            const date = { day, month: 1, year: 1177 };
            if (planetLowerPriceCounters(PORT, SHIP_UUID, bribeDay(date))
                === counters) {
                return date;
            }
        }
        throw new Error('no such day');
    }

    it('Lower Price counters with 3/4, and Accept Price then pays the '
        + 'counter (reference "R7 bribe price, wave 22": 3,000 -> 2,200)',
        async () => {
            const { world, ship } = await shutOutHarness();
            const date = dayWhere(true);
            ship.components.set(GameDateComponent, date);
            applyHail(world, undefined, { kind: 'lowerPrice', target: PORT });
            expect(ship.components.get(StellarHaggleComponent)!.get(PORT_ID))
                .toEqual({ countered: true, withdrawn: false });
            // Nothing is charged for haggling.
            expect(ship.components.get(CreditsComponent)!.credits)
                .toEqual(100_000);

            applyHail(world, undefined, { kind: 'bribe', target: PORT });
            // The 0x8000 port's 4,000 -> 3,000.
            expect(ship.components.get(CreditsComponent)!.credits)
                .toEqual(100_000 - 3_000);
            // The haggle is over; the clearance is bought.
            expect(ship.components.get(StellarHaggleComponent)!.has(PORT_ID))
                .toBeFalse();
            expect(pressLand(world).blocked).toEqual([]);
        }, 30_000);

    it('a withdrawal refuses every later offer in the system visit, the '
        + 'next day too, and the crossing into another system ends it '
        + '(reference "R7 planet bribe withdrawal, wave 29")',
        async () => {
            const { world, ship } = await shutOutHarness();
            const date = dayWhere(false);
            ship.components.set(GameDateComponent, date);
            applyHail(world, undefined, { kind: 'lowerPrice', target: PORT });
            expect(ship.components.get(StellarHaggleComponent)!.get(PORT_ID))
                .toEqual({ countered: false, withdrawn: true });

            // Eleven later offers that day: all refused, nothing charged.
            for (let i = 0; i < 11; i++) {
                applyHail(world, undefined, { kind: 'bribe', target: PORT });
                applyHail(world, undefined,
                    { kind: 'lowerPrice', target: PORT });
            }
            expect(ship.components.get(CreditsComponent)!.credits)
                .toEqual(100_000);
            expect(ship.components.has(StellarBribesComponent)).toBeFalse();
            expect(pressLand(world).blocked[0].reason).toEqual('denied');

            // A landing elsewhere in the system and a take-off move the
            // date a day; the ship carries its haggle down and back up, so
            // the planet still refuses (wave 29's bribe_q run).
            ship.components.set(GameDateComponent,
                { ...date, day: date.day + 1 });
            applyHail(world, undefined, { kind: 'bribe', target: PORT });
            expect(ship.components.get(CreditsComponent)!.credits)
                .toEqual(100_000);
            expect(pressLand(world).blocked[0].reason).toEqual('denied');

            // A jump out and back: the crossing into a fresh world drops the
            // haggle (wave 29's bribe_stay run: a fresh price).
            ship.components.set(GameDateComponent,
                { ...date, day: date.day + 3 });
            prepareCarriedEntitiesForFreshWorld(ship, SHIP_UUID, []);
            expect(ship.components.has(StellarHaggleComponent)).toBeFalse();
            applyHail(world, undefined, { kind: 'bribe', target: PORT });
            expect(ship.components.get(CreditsComponent)!.credits)
                .toEqual(100_000 - 4_000);
        }, 30_000);

    it('a second Lower Price on a counter withdraws (reference "R7 planet '
        + 'bribe withdrawal, wave 29": "Yeah, you wish."), on a later day '
        + 'of the visit too', async () => {
        for (const nextDay of [false, true]) {
            const { world, ship } = await shutOutHarness();
            const date = dayWhere(true);
            ship.components.set(GameDateComponent, date);
            applyHail(world, undefined, { kind: 'lowerPrice', target: PORT });
            expect(ship.components.get(StellarHaggleComponent)!.get(PORT_ID))
                .toEqual({ countered: true, withdrawn: false });
            if (nextDay) {
                // A landing and take-off in the system: the counter stays
                // on the table, and the day's fresh draw is not re-made.
                ship.components.set(GameDateComponent,
                    { ...date, day: date.day + 1 });
            }
            applyHail(world, undefined, { kind: 'lowerPrice', target: PORT });
            expect(ship.components.get(StellarHaggleComponent)!.get(PORT_ID))
                .toEqual({ countered: false, withdrawn: true });
            applyHail(world, undefined, { kind: 'bribe', target: PORT });
            expect(ship.components.get(CreditsComponent)!.credits)
                .toEqual(100_000);
        }
    }, 30_000);

    it('does not haggle over a price the pilot cannot pay, nor at a port '
        + 'that is not refusing him', async () => {
            const poor = await shutOutHarness();
            poor.ship.components.set(CreditsComponent, { credits: 300 });
            applyHail(poor.world, undefined,
                { kind: 'lowerPrice', target: PORT });
            expect(poor.ship.components.has(StellarHaggleComponent))
                .toBeFalse();

            const { world, ship } = await makeHarness();
            ship.components.set(CreditsComponent, { credits: 10_000 });
            ship.components.set(LegalRecordsComponent,
                new Map([[SYSTEM, 0]]));
            applyHail(world, undefined, { kind: 'lowerPrice', target: PORT });
            expect(ship.components.has(StellarHaggleComponent)).toBeFalse();
        }, 30_000);

    it('is a deterministic function of synced state: two independent worlds '
        + 'reach the same verdict and the same price', async () => {
            const a = await shutOutHarness();
            const b = await shutOutHarness();

            applyHail(a.world, undefined, { kind: 'bribe', target: PORT });
            applyHail(b.world, undefined, { kind: 'bribe', target: PORT });

            expect(a.ship.components.get(CreditsComponent))
                .toEqual(b.ship.components.get(CreditsComponent)!);
            expect([...a.ship.components.get(StellarBribesComponent)!])
                .toEqual([...b.ship.components.get(StellarBribesComponent)!]);
            expect(pressLand(a.world).lands.length)
                .toEqual(pressLand(b.world).lands.length);
        }, 30_000);
});

describe('StellarBribesComponent wiring', () => {
    it('round-trips through the serializer, so a bribe survives a snapshot '
        + 'and reaches a joining peer', async () => {
            const { world, ship } = await makeHarness();
            const serializer = world.resources.get(SerializerResource)!;
            ship.components.set(StellarBribesComponent,
                new Map([['nova:128', 12_345], ['nova:133', 6_000]]));

            const encoded = serializer.encodeComponent(StellarBribesComponent,
                ship.components.get(StellarBribesComponent)!);
            const decoded = serializer.decodeComponent('StellarBribes',
                encoded) as { _tag: string, right: [unknown, unknown] };

            expect(decoded?._tag).toEqual('Right');
            expect([...(decoded.right[1] as Map<string, number>)])
                .toEqual([['nova:128', 12_345], ['nova:133', 6_000]]);
        }, 30_000);

    it('is delta-registered, so the display world sees the same bribes the '
        + 'simulation charged for', async () => {
            const { world } = await makeHarness();
            const delta = world.resources.get(DeltaResource)!;
            expect(delta.componentDeltas.has(
                StellarBribesComponent as never)).toBeTrue();
        }, 30_000);

    it('carries the planet haggle (StellarHaggle) through the serializer '
        + 'and the delta stream too', async () => {
            const { world } = await makeHarness();
            const serializer = world.resources.get(SerializerResource)!;
            const haggle = new Map([
                ['nova:128', { countered: true, withdrawn: false }],
                ['nova:133', { countered: false, withdrawn: true }],
            ]);
            const encoded = serializer.encodeComponent(StellarHaggleComponent,
                haggle);
            const decoded = serializer.decodeComponent('StellarHaggle',
                encoded) as { _tag: string, right: [unknown, unknown] };
            expect(decoded?._tag).toEqual('Right');
            expect([...(decoded.right[1] as typeof haggle)])
                .toEqual([...haggle]);
            expect(world.resources.get(DeltaResource)!.componentDeltas.has(
                StellarHaggleComponent as never)).toBeTrue();
        }, 30_000);
});

describe('applySetPlanetTarget', () => {
    it('selects, rejects invalid, and clears the stellar target', async () => {
        const { world, ship } = await makeHarness();
        const planets = stellars(world);
        const target = ship.components.get(PlanetTargetComponent)!;

        applySetPlanetTarget(world, undefined, planets[0].uuid);
        expect(target.target).toEqual(planets[0].uuid);

        // A non-stellar uuid is dropped, leaving the selection untouched.
        applySetPlanetTarget(world, undefined, 'not a real entity');
        expect(target.target).toEqual(planets[0].uuid);

        applySetPlanetTarget(world, undefined, null);
        expect(target.target).toBeUndefined();
    }, 30_000);
});

// Measured: reference "Gate approach lines, wave 25". At a gate the window
// lines name the gate ("... enter this hypergate." / "... enter this
// wormhole.", stock STR# 2002 one-based 65 / 66 and 69 / 70), and a
// wormhole answers the FIRST `l`, where a hypergate's first `l` only
// selects (its clearance step). On the synthetic Kestrel Gate (a hypergate
// in Kestrel Drift) and Ossory Rift (a wormhole in Ossory Shoal).
describe('the gate approach lines', () => {
    const KESTREL_GATE = `planet ${SYNTHETIC.planets.kestrelGate}`;
    const OSSORY_RIFT = `planet ${SYNTHETIC.planets.ossoryRift}`;

    async function atGate(systemId: string, gateUuid: string) {
        const { world, ship } = await makeHarness(getSyntheticGameData(),
            systemId);
        const gate = stellars(world).find(p => p.uuid === gateUuid)!;
        expect(gate).toBeDefined();
        return { world, ship, gate };
    }

    function message(blocked: ReturnType<typeof pressLand>['blocked'][0]) {
        return landingBlockedMessage(blocked.reason as 'tooFar',
            blocked.isStation, blocked.stellarName, blocked.gateKind);
    }

    for (const [kind, systemId, gateUuid] of [
        ['hypergate', SYNTHETIC.systems.kestrel, KESTREL_GATE],
        ['wormhole', SYNTHETIC.systems.ossory, OSSORY_RIFT],
    ] as const) {
        it(`says "You're too far away to enter this ${kind}."`, async () => {
            const { world, ship, gate } = await atGate(systemId, gateUuid);
            ship.components.get(PlanetTargetComponent)!.target = gate.uuid;
            place(ship, new Position(gate.position.x - 2000, gate.position.y));

            const { lands, blocked } = pressLand(world);

            expect(lands).toEqual([]);
            expect(blocked.length).toBe(1);
            expect(blocked[0].reason).toEqual('tooFar');
            expect(blocked[0].gateKind).toEqual(kind);
            expect(message(blocked[0]))
                .toEqual(`You're too far away to enter this ${kind}.`);
        }, 30_000);

        it(`says "You're moving too fast to enter this ${kind}."`,
            async () => {
                const { world, ship, gate } = await atGate(systemId, gateUuid);
                ship.components.get(PlanetTargetComponent)!.target = gate.uuid;
                place(ship, gate.position, new Vector(100, 0));

                const { lands, blocked } = pressLand(world);

                expect(lands).toEqual([]);
                expect(blocked.length).toBe(1);
                expect(blocked[0].reason).toEqual('tooFast');
                expect(blocked[0].gateKind).toEqual(kind);
                expect(message(blocked[0]))
                    .toEqual(`You're moving too fast to enter this ${kind}.`);
            }, 30_000);
    }

    it('keeps the planet / station lines at a planet or station', () => {
        expect(landingBlockedMessage('tooFar', true))
            .toEqual("You're too far away to dock at this station.");
        expect(landingBlockedMessage('tooFast', false))
            .toEqual("You're moving too fast to land on this planet.");
    });

    it('answers a wormhole\'s FIRST `l` at once: too far', async () => {
        const { world, ship, gate } = await atGate(SYNTHETIC.systems.ossory,
            OSSORY_RIFT);
        // Nothing selected; the rift is the nearest port but far off.
        place(ship, new Position(gate.position.x - 2000, gate.position.y));

        const { lands, blocked } = pressLand(world);

        expect(ship.components.get(PlanetTargetComponent)!.target)
            .toEqual(gate.uuid);
        expect(lands).toEqual([]);
        expect(blocked.map(b => [b.reason, b.gateKind]))
            .toEqual([['tooFar', 'wormhole']]);
        // A second `l` repeats it.
        expect(pressLand(world).blocked.map(b => b.reason))
            .toEqual(['tooFar']);
    }, 30_000);

    it('answers a wormhole\'s FIRST `l` at once: too fast', async () => {
        const { world, ship, gate } = await atGate(SYNTHETIC.systems.ossory,
            OSSORY_RIFT);
        place(ship, gate.position, new Vector(100, 0));

        const { lands, blocked } = pressLand(world);

        expect(lands).toEqual([]);
        expect(blocked.map(b => [b.reason, b.gateKind]))
            .toEqual([['tooFast', 'wormhole']]);
    }, 30_000);

    it('goes through a wormhole on the FIRST `l` in its window', async () => {
        const { world, ship, gate } = await atGate(SYNTHETIC.systems.ossory,
            OSSORY_RIFT);
        place(ship, gate.position);

        const { lands, blocked } = pressLand(world);

        expect(blocked).toEqual([]);
        expect(lands.map(l => l.uuid)).toEqual([gate.uuid]);
    }, 30_000);

    // Measured: reference "Gate map, wave 27", the first `l` at Kit Gate N1
    // (on the gate, at rest) said "You are cleared for hypergate entry.";
    // the window lines come from the second `l` ("Gate approach lines, wave
    // 25"). The selecting press clears only INSIDE the entry window (by
    // distance alone: wave 28's coasting ship 250 px off was cleared);
    // farther out it requests ("Hypergate `l` range and the request lines,
    // wave 29", below).
    it('answers a hypergate\'s first `l` inside its entry window with its '
        + 'clearance, never the window, and does not go through',
        async () => {
            const { world, ship, gate } = await atGate(
                SYNTHETIC.systems.kestrel, KESTREL_GATE);
            const range = stellarLandingRange(world.entities.get(gate.uuid)!
                .components.get(PlanetDataComponent));
            for (const [position, velocity] of [
                [gate.position, new Vector(0, 0)],
                [new Position(gate.position.x, gate.position.y + range),
                    new Vector(0, 0)],
                [gate.position, new Vector(100, 0)],
            ] as const) {
                ship.components.get(PlanetTargetComponent)!.target = undefined;
                place(ship, position, velocity);
                const cleared: { gateKind: string, entities?: unknown }[] = [];
                const sub = world.events.get(LandingClearedEvent)
                    .subscribe(({ data, entities }) =>
                        cleared.push({ ...data, entities }));

                const { lands, blocked } = pressLand(world);
                sub.unsubscribe();

                expect(ship.components.get(PlanetTargetComponent)!.target)
                    .toEqual(gate.uuid);
                expect(lands).toEqual([]);
                expect(blocked).toEqual([]);
                expect(cleared).toEqual([
                    { gateKind: 'hypergate', entities: [SHIP_UUID] }]);
                // The clearance is held: it opens the gate.
                expect(holdsGateClearance(
                    ship.components.get(PlanetTargetComponent))).toBeTrue();
            }
            // The second `l` is the window's, with no clearance line.
            const cleared: unknown[] = [];
            const sub = world.events.get(LandingClearedEvent)
                .subscribe(({ data }) => cleared.push(data));
            expect(pressLand(world).blocked.map(b => b.reason))
                .toEqual(['tooFast']);
            sub.unsubscribe();
            expect(cleared).toEqual([]);
        }, 30_000);

    it('words the clearance as STR# 2002 #91-93', () => {
        expect(hypergateClearedMessage(2, 'Lancer'))
            .toBe('You are cleared for hypergate entry.');
        expect(hypergateClearedMessage(0, 'Lancer'))
            .toBe('Cleared for hypergate entry, Lancer.');
        expect(hypergateClearedMessage(1, 'Lancer'))
            .toBe("Lancer, you're cleared for hypergate entry.");
        // No name to put in a named form: the nameless one.
        expect(hypergateClearedMessage(0, undefined))
            .toBe('You are cleared for hypergate entry.');
        expect(hypergateClearedMessage(1, ''))
            .toBe('You are cleared for hypergate entry.');
    });
});

// Measured: reference "Hypergate `l` range and the request lines, wave 29".
// A stopped ship's `l` with nothing selected picks a hypergate only inside a
// CIRCLE of 490-500 px (HYPERGATE_SELECT_RANGE, 500 a GUESS inside the
// bracket), ports from 1,000 px and more; the selecting press outside the
// entry window prints the REQUEST line and leaves the gate closed; later
// presses outside give the window lines; the press inside clears and opens.
// On the synthetic Kestrel Drift: Kestrel Gate (a hypergate) and Kestrel
// Rock (an ordinary port about 570 px from it).
describe('the hypergate `l` range and the request lines', () => {
    const KESTREL_GATE = `planet ${SYNTHETIC.planets.kestrelGate}`;
    const KESTREL_ROCK = `planet ${SYNTHETIC.planets.kestrelRock}`;

    async function kestrel() {
        const { world, ship } = await makeHarness(getSyntheticGameData(),
            SYNTHETIC.systems.kestrel);
        const gate = stellars(world).find(p => p.uuid === KESTREL_GATE)!;
        const rock = stellars(world).find(p => p.uuid === KESTREL_ROCK)!;
        expect(gate).toBeDefined();
        expect(rock).toBeDefined();
        return { world, ship, gate, rock };
    }

    /** One `l`, recording every answer the sim gives. */
    function press(world: World) {
        const cleared: unknown[] = [];
        const requests: (LandingRequest & { entities?: unknown })[] = [];
        const subs = [
            world.events.get(LandingClearedEvent)
                .subscribe(({ data }) => cleared.push(data)),
            world.events.get(LandingRequestEvent)
                .subscribe(({ data, entities }) =>
                    requests.push({ ...data, entities })),
        ];
        const { lands, blocked } = pressLand(world);
        subs.forEach(s => s.unsubscribe());
        return { lands, blocked, cleared, requests };
    }

    function target(ship: Entity) {
        return ship.components.get(PlanetTargetComponent)!;
    }

    it('selects the gate at 499 px and not at 501 px (a stopped ship)',
        async () => {
            expect(HYPERGATE_SELECT_RANGE).toBe(500);
            const { world, ship, gate, rock } = await kestrel();

            place(ship, new Position(gate.position.x + 499, gate.position.y));
            const near = press(world);
            expect(target(ship).target).toBe(gate.uuid);
            // Outside the entry window: the request, not the clearance.
            expect(near.cleared).toEqual([]);
            expect(near.blocked).toEqual([]);
            expect(near.requests.map(r => [r.kind, r.entities]))
                .toEqual([['hypergate', [SHIP_UUID]]]);

            selectPlanetTarget(target(ship), undefined);
            place(ship, new Position(gate.position.x + 501, gate.position.y));
            const far = press(world);
            // The gate is skipped; the port, about 940 px off, is picked.
            expect(target(ship).target).toBe(rock.uuid);
            expect(far.requests.map(r => [r.kind, r.stellarName]))
                .toEqual([['planet', 'Kestrel Rock']]);

            // With no port in the system, `l` selects nothing and says
            // nothing (the original's "Nav System Off").
            selectPlanetTarget(target(ship), undefined);
            world.entities.delete(rock.uuid);
            const nothing = press(world);
            expect(target(ship).target).toBeUndefined();
            expect([nothing.lands, nothing.blocked, nothing.cleared,
                nothing.requests]).toEqual([[], [], [], []]);
        }, 30_000);

    it('measures the range as a circle: the 467 px diagonal is selected, '
        + 'the 594 px one is not', async () => {
            const { world, ship, gate } = await kestrel();
            place(ship, new Position(gate.position.x + 330,
                gate.position.y + 330));
            press(world);
            expect(target(ship).target).toBe(gate.uuid);

            selectPlanetTarget(target(ship), undefined);
            // Each coordinate (420) is inside the 499 px the axis selects.
            place(ship, new Position(gate.position.x + 420,
                gate.position.y + 420));
            press(world);
            expect(target(ship).target).not.toBe(gate.uuid);
        }, 30_000);

    it('selects a port from 1,000 px with its request line, and a '
        + 'station with its own', async () => {
            const { world, ship, rock } = await kestrel();
            place(ship, new Position(rock.position.x - 1000, rock.position.y));
            const port = press(world);
            expect(target(ship).target).toBe(rock.uuid);
            expect(port.lands).toEqual([]);
            expect(port.blocked).toEqual([]);
            expect(port.requests.length).toBe(1);
            const request = port.requests[0];
            expect([request.kind, request.stellarName, request.online])
                .toEqual(['planet', 'Kestrel Rock', undefined]);
            expect(request.form).toBeGreaterThanOrEqual(0);
            expect(request.form).toBeLessThan(LANDING_REQUEST_FORMS);
            expect(landingRequestMessage(request.kind, request.form,
                request.stellarName, 'Lancer')).toMatch(
                /^(Kestrel Rock traffic control reads you|Landing request received)(, Lancer)?\. Begin initial approach\.$/);

            // The same rock as a station.
            const rockEntity = world.entities.get(rock.uuid)!;
            const data = rockEntity.components.get(PlanetDataComponent)!;
            rockEntity.components.set(PlanetDataComponent, {
                ...data, flags: { ...data.flags, isStation: true },
            });
            selectPlanetTarget(target(ship), undefined);
            const station = press(world);
            expect(station.requests.map(r => [r.kind, r.stellarName]))
                .toEqual([['station', 'Kestrel Rock']]);
        }, 30_000);

    it('keeps the window lines after the request, and the gate closed',
        async () => {
            const { world, ship, gate } = await kestrel();
            place(ship, new Position(gate.position.x + 300, gate.position.y));
            const first = press(world);
            expect(first.requests.map(r => r.kind)).toEqual(['hypergate']);
            expect(holdsGateClearance(target(ship))).toBeFalse();

            for (let i = 0; i < 3; i++) {
                const later = press(world);
                expect(later.requests).toEqual([]);
                expect(later.cleared).toEqual([]);
                expect(later.blocked.map(b => [b.reason, b.gateKind]))
                    .toEqual([['tooFar', 'hypergate']]);
                expect(holdsGateClearance(target(ship))).toBeFalse();
            }
            // Moving inside the window: too fast, still no clearance.
            place(ship, gate.position, new Vector(100, 0));
            expect(press(world).blocked.map(b => b.reason))
                .toEqual(['tooFast']);
            expect(holdsGateClearance(target(ship))).toBeFalse();
        }, 30_000);

    it('clears and opens on the press inside the entry window after a '
        + 'request, and the next `l` enters the gate', async () => {
            const { world, ship, gate } = await kestrel();
            place(ship, new Position(gate.position.x + 300, gate.position.y));
            press(world);
            expect(target(ship).target).toBe(gate.uuid);
            expect(holdsGateClearance(target(ship))).toBeFalse();

            place(ship, gate.position);
            const clearance = press(world);
            expect(clearance.lands).toEqual([]);
            expect(clearance.blocked).toEqual([]);
            expect(clearance.cleared).toEqual([{ gateKind: 'hypergate' }]);
            expect(target(ship).cleared).toBe(gate.uuid);
            expect(holdsGateClearance(target(ship))).toBeTrue();

            const enter = press(world);
            expect(enter.cleared).toEqual([]);
            expect(enter.lands.map(l => l.uuid)).toEqual([gate.uuid]);
        }, 30_000);

    it('drops the clearance when the selection moves on', async () => {
        const { world, ship, gate, rock } = await kestrel();
        place(ship, gate.position);
        press(world);
        expect(holdsGateClearance(target(ship))).toBeTrue();

        applySetPlanetTarget(world, undefined, rock.uuid);
        expect(target(ship).cleared).toBeUndefined();
        // Selecting the gate again (a click) does not restore it: the
        // next `l` in the window is a fresh clearance, not the gate map.
        applySetPlanetTarget(world, undefined, gate.uuid);
        const again = press(world);
        expect(again.lands).toEqual([]);
        expect(again.cleared).toEqual([{ gateKind: 'hypergate' }]);
    }, 30_000);

    it('says "Hypergate is online" when another ship holds the gate\'s '
        + 'clearance (GUESS)', async () => {
            const { world, ship, gate } = await kestrel();
            const other = new Entity('other');
            other.components.set(PlanetTargetComponent,
                { target: gate.uuid, cleared: gate.uuid });
            world.entities.set('other ship', other);
            place(ship, new Position(gate.position.x + 300, gate.position.y));
            const { requests } = press(world);
            expect(requests.map(r => [r.kind, r.online]))
                .toEqual([['hypergate', true]]);
        }, 30_000);

    it('denies a refusing port on the selecting press, far out (GUESS)',
        async () => {
            const { world, ship } = await makeHarness();
            const coldharbour = stellars(world).find(p =>
                p.uuid === `planet ${SYNTHETIC.planets.coldharbour}`)!;
            ship.components.set(LegalRecordsComponent,
                new Map([[SYSTEM, -1]]));
            place(ship, new Position(coldharbour.position.x,
                coldharbour.position.y + 600));
            const { blocked, requests } = press(world);
            expect(target(ship).target).toBe(coldharbour.uuid);
            expect(requests).toEqual([]);
            expect(blocked.map(b => [b.reason, b.gateKind]))
                .toEqual([['denied', undefined]]);
        }, 30_000);

    it('picks the request line\'s form by a salted hash', () => {
        const forms = new Set<number>();
        for (let now = 0; now < 2000; now += 16) {
            const form = landingRequestForm('nova:130', SHIP_UUID, now);
            expect(form).toBe(landingRequestForm('nova:130', SHIP_UUID, now));
            expect(form).toBeGreaterThanOrEqual(0);
            expect(form).toBeLessThan(LANDING_REQUEST_FORMS);
            forms.add(form);
        }
        expect(forms.size).toBe(LANDING_REQUEST_FORMS);
    });

    it('words the request lines as STR# 2002 #74-80', () => {
        expect(landingRequestMessage('hypergate', 1, 'Kit Gate',
            'w29-gate-300')).toBe('Hypergate is energized, w29-gate-300. '
            + 'Begin initial approach.');
        expect(landingRequestMessage('hypergate', 0, 'Kit Gate', 'Lancer'))
            .toBe('Hypergate is energized. Begin initial approach.');
        expect(landingRequestMessage('hypergate', 0, 'Kit Gate', 'Lancer',
            true)).toBe('Hypergate is online. Begin initial approach.');
        expect(landingRequestMessage('planet', 0, 'Kit Request Port',
            'Lancer')).toBe('Kit Request Port traffic control reads you. '
            + 'Begin initial approach.');
        expect(landingRequestMessage('planet', 3, 'Kit Map Picky Port',
            'Lancer')).toBe('Landing request received, Lancer. Begin '
            + 'initial approach.');
        expect(landingRequestMessage('station', 3, 'Kit Request Station',
            'w29-req-station')).toBe('Docking request received, '
            + 'w29-req-station. Begin initial approach.');
        expect(landingRequestMessage('station', 1, 'Kit Station', 'Lancer'))
            .toBe('Kit Station dockmaster reads you, Lancer. Begin initial '
                + 'approach.');
        // No ship name: the nameless form.
        expect(landingRequestMessage('station', 3, 'Kit Station', ''))
            .toBe('Docking request received. Begin initial approach.');
    });
});
