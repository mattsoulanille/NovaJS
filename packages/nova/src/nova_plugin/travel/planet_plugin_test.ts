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
    applySetPlanetTarget, clearanceLapsed, holdsClearance,
    holdsGateClearance, holdsRequest,
    STELLAR_CLEARANCE_RANGE, HYPERGATE_ONLINE, HYPERGATE_ONLINE_OUT_OF,
    HYPERGATE_SELECT_RANGE, hypergateRequestOnline,
    inLandingZone, WORMHOLE_LAND_RANGE_CAP, LANDING_REQUEST_FORMS,
    STELLAR_CLEARANCE_MS, STELLAR_CLEARED_FORM_ODDS, STELLAR_CLEARED_OUT_OF,
    STELLAR_CLEARED_WELCOME, stellarApproachRange, stellarClearedForm,
    LAND_RANGE_PER_FRAME_WIDTH, LAND_SPEED_SQUARED, LandEvent,
    LandingBlockedEvent, LandingCleared, LandingClearedEvent,
    landingDistance, landingRange,
    LandingRequest, LandingRequestEvent, landingRequestForm,
    PlanetComponent, selectPlanetTarget,
    PlanetDataComponent, PlanetTargetComponent, StellarBribesComponent, STELLAR_BRIBE_MS, stellarClearanceFor,
    stellarLandingRange, StellarHaggleComponent, SystemVisitComponent,
} from './planet_plugin.js';
import { getDefaultPlanetData, PlanetData } from 'novadatainterface/planet_data';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { applyHail } from '../encounters/index.js';
import { prepareCarriedEntitiesForFreshWorld } from '../pilot/index.js';
import { CreditsComponent, GameDateComponent } from '../player/index.js';
import {
    bribeDay, GovtsResource, LegalRecordsComponent, planetLowerPriceCounters,
    planetRefusesBribe,
} from '../reputation/index.js';
import { landable, SimulationGameDataResource } from '../core/index.js';
import { applyShipChange } from '../missions/index.js';
import { StoredShipsComponent } from '../player/index.js';
import { ShipComponent, ShipDataComponent } from '../ship/index.js';
import { buildPurchasedShip } from '../../spaceport/shipyard_rules.js';
import { swapWithStored } from '../../spaceport/ship_storage.js';
import {
    clearanceDeniedMessage, hypergateClearedMessage, landingBlockedMessage,
    landingRequestMessage, stellarClearedMessage,
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

/**
 * Selects `uuid` with traffic control's clearance held (what an `l` inside
 * the 249 px clearance zone gives; a port's or station's for
 * STELLAR_CLEARANCE_MS from now), so the next `l` inside the landing
 * window lands. Since wave 31 only a cleared ship lands.
 */
function selectCleared(world: World, ship: Entity, uuid: string) {
    const target = ship.components.get(PlanetTargetComponent)!;
    selectPlanetTarget(target, uuid);
    target.cleared = uuid;
    delete target.requested;
    const data = world.entities.get(uuid)?.components
        .get(PlanetDataComponent);
    if (data?.gate?.kind === 'hypergate') {
        delete target.clearedUntil;
    } else {
        target.clearedUntil = (world.resources.get(TimeResource)?.time ?? 0)
            + STELLAR_CLEARANCE_MS;
    }
}

/** One world step with no input, recording every LandingClearedEvent. */
function stepRecordingClearances(world: World) {
    const cleared: (LandingCleared & { entities?: unknown })[] = [];
    const sub = world.events.get(LandingClearedEvent)
        .subscribe(({ data, entities }) => cleared.push({ ...data, entities }));
    world.step();
    sub.unsubscribe();
    return cleared;
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

    it('lands on the ALREADY-selected (cleared) stellar when in range and slow', async () => {
        const { world, ship } = await makeHarness();
        const planets = stellars(world);
        const target = planets[0];
        selectCleared(world, ship, target.uuid);
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
        selectCleared(world, ship, target.uuid);
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
        selectCleared(world, ship, port.uuid);
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
 * runs): a SQUARE, max(|dx|, |dy|) <= R, R = 1.7 W from the frame's
 * width W, with no cap since wave 31 ("Planet and station clearance, wave
 * 31", finding 3: wave 6's 212 px cap was the clearance zone and its lapse
 * read through a stale request); the speed gate is an absolute 20 px/s
 * ("U9 wave 4").
 */
describe('landingRange', () => {
    it('is 1.7 x the frame WIDTH, with no cap', () => {
        expect(LAND_RANGE_PER_FRAME_WIDTH).toBe(1.7);
        expect(landingRange([40, 40])).toBeCloseTo(68, 9);
        expect(landingRange([112, 112])).toBeCloseTo(190.4, 9);
        expect(landingRange([250, 250])).toBeCloseTo(425, 9);
        expect(landingRange([325, 325])).toBeCloseTo(552.5, 9);
    });

    it('reads the width, never the height (tall and wide stations)', () => {
        // 15x21 -> 25.5 and 17x31 -> 28.9, not 35.7 and 52.7; 35x22 ->
        // 59.5, not 37.4.
        expect(landingRange([15, 21])).toBeCloseTo(25.5, 9);
        expect(landingRange([17, 31])).toBeCloseTo(28.9, 9);
        expect(landingRange([35, 22])).toBeCloseTo(59.5, 9);
        expect(landingRange([315, 200])).toBeCloseTo(535.5, 9);
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
 * nothing measurable: wave 6 finding 3), the ship holding a clearance (the
 * landing window is a cleared ship's: "Planet and station clearance, wave
 * 31"). The brackets of the 250 / 315 / 325 px arts are superseded: the
 * 212 px "cap" they fitted was the clearance zone and its lapse read
 * through a stale request (the reliability note "U9's 212 px landing cap
 * is superseded").
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
            selectCleared(world, ship, PORT);
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

    it('lands a cleared ship at wave 6\'s big-art "too far" stops: the 212 '
        + 'px cap is gone (wave 31)', async () => {
            const press = await presser();
            const stops: Array<[[number, number], number]> = [
                [[250, 250], 235.5], [[325, 325], 213], [[315, 200], 229.5],
                // Wave 31's walk-outs: a 250 px planet from 294, 359, 425.
                [[250, 250], 294], [[250, 250], 359], [[250, 250], 425],
            ];
            for (const [frame, stop] of stops) {
                expect(press(frame, [stop, 0]))
                    .withContext(`${frame} at ${stop}`).toEqual('landed');
            }
            expect(press([250, 250], [426, 0])).toEqual('tooFar');
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
        selectCleared(harness.world, harness.ship, uuid);
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

    it('lands a cleared ship on a big planet from far out (a 325 px frame '
        + 'lands within 552.5 px: no 212 px cap since wave 31)', async () => {
            const big: [number, number] = [325, 325];
            expect((await pressAt(PORT, 552, undefined, big)).lands.length)
                .toBe(1);
            expect((await pressAt(PORT, 553, undefined, big)).blocked
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

            // The first `l` there clears ("Cleared to land ..."), the next
            // lands (wave 31: only a cleared ship lands).
            const first = pressLand(world);
            expect(first.blocked).toEqual([]);
            expect(first.lands).toEqual([]);
            expect(holdsClearance(ship.components.get(PlanetTargetComponent),
                0)).toBeTrue();
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

            // Traffic control now clears the ship, and the next `l` lands.
            expect(pressLand(world)).toEqual({ lands: [], blocked: [] });
            const { lands, blocked } = pressLand(world);
            expect(blocked).toEqual([]);
            expect(lands.length).toBe(1);
        }, 30_000);

    it('expires: the same stellar refuses again once the reprieve lapses',
        async () => {
            const { world, ship } = await shutOutHarness();
            applyHail(world, undefined, { kind: 'bribe', target: PORT });
            // Wind the clearance back into the past rather than the clock
            // forward: expiry is a pure comparison against TimeResource.
            ship.components.set(StellarBribesComponent,
                new Map([[PORT_ID, -1]]));

            expect(pressLand(world).blocked[0].reason).toEqual('denied');
            // ...and the reprieve really was STELLAR_BRIBE_MS long.
            applyHail(world, undefined, { kind: 'bribe', target: PORT });
            expect(ship.components.get(StellarBribesComponent)!.get(PORT_ID))
                .toBeGreaterThanOrEqual(STELLAR_BRIBE_MS);
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
            const plainPort = async (visit: number) => {
                const harness = await shutOutHarness();
                const govts = harness.world.resources.get(GovtsResource)!;
                const id = SYNTHETIC.govts.compact;
                const govt = govts.get(id)!;
                govts.set(id, { ...govt, flags: { ...govt.flags,
                    planetsTakeBribes: true, largerBribes: false } });
                harness.ship.components.set(SystemVisitComponent, visit);
                return harness;
            };
            // The draw is per planet, pilot and system visit: refused on
            // visit 1, priced on visit 0.
            expect(planetRefusesBribe(PORT, SHIP_UUID, false, 1)).toBeTrue();
            expect(planetRefusesBribe(PORT, SHIP_UUID, false, 0)).toBeFalse();

            const refused = await plainPort(1);
            applyHail(refused.world, undefined,
                { kind: 'bribe', target: PORT });
            expect(refused.ship.components.get(CreditsComponent)!.credits)
                .toEqual(100_000);
            expect(refused.ship.components.has(StellarBribesComponent))
                .toBeFalse();
            expect(pressLand(refused.world).blocked[0].reason)
                .toEqual('denied');

            const priced = await plainPort(0);
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

    describe('across a change of hull in the same system visit', () => {
        /** The class the pilot trades the harness's skiff for. */
        const CORSAIR = SYNTHETIC.ships.corsair;

        /**
         * Every way the player's hull is replaced: the shipyard's Buy Ship
         * (buildPurchasedShip), the hangar's swap with a stored ship
         * (swapWithStored) — both build through shipyard_rules'
         * buildShipEntity and its CARRIED_COMPONENTS — and a set string's
         * Cxxx in flight (applyShipChange -> rehullShip, on
         * PLAYER_STATE_COMPONENTS). The new hull is put in the world at the
         * player's uuid.
         */
        const PATHS = {
            async purchase(world: World, old: Entity) {
                const data = world.resources.get(SimulationGameDataResource)!
                    .data;
                const skiff = await data.Ship.get(SYNTHETIC.ships.skiff);
                const corsair = await data.Ship.get(CORSAIR);
                const hull = buildPurchasedShip(old, corsair, {
                    currentShip: skiff, outfits: new Map(),
                    getOutfit: () => undefined,
                    credits: old.components.get(CreditsComponent)!.credits,
                });
                await completeEntity(world, hull);
                world.entities.set(SHIP_UUID, hull);
                return hull;
            },
            async storage(world: World, old: Entity) {
                const data = world.resources.get(SimulationGameDataResource)!
                    .data;
                const corsair = await data.Ship.get(CORSAIR);
                old.components.set(StoredShipsComponent, [{
                    ship: CORSAIR, name: corsair.name, outfits: [],
                    cargo: [], fuel: 100, storedAt: PORT_ID,
                }]);
                const hull = swapWithStored(old, 0, PORT_ID, {
                    getShip: id => data.Ship.getCached(id),
                    getOutfit: id => data.Outfit.getCached(id),
                });
                await completeEntity(world, hull);
                world.entities.set(SHIP_UUID, hull);
                return hull;
            },
            async 'set string in flight'(world: World, old: Entity) {
                // Staged before the record applies, as simulation_input.ts
                // does (mission_ship_change.ts's module note).
                await world.resources.get(SimulationGameDataResource)!
                    .data.Ship.get(CORSAIR);
                return applyShipChange(world, SHIP_UUID, old,
                    { shipId: CORSAIR });
            },
        };

        /** Replaces the player's hull by `path`, then brings the new hull
         * back over the port with it targeted. */
        async function changeHull(path: keyof typeof PATHS, world: World,
            old: Entity) {
            const hull = await PATHS[path](world, old);
            expect(hull).not.toBe(old);
            expect(hull.components.get(ShipComponent)!.id).toBe(CORSAIR);
            // One step so the providers rebuild the hull (and attach
            // PlanetTargetComponent to a docked-built one).
            world.step();
            const stellar = stellars(world).find(p => p.uuid === PORT)!;
            hull.components.get(PlanetTargetComponent)!.target = stellar.uuid;
            place(hull, stellar.position);
            return hull;
        }

        for (const path of Object.keys(PATHS) as (keyof typeof PATHS)[]) {
            describe(`(${path})`, () => {
                it('a planet that withdrew its offer keeps refusing',
                    async () => {
                        const { world, ship } = await shutOutHarness();
                        ship.components.set(GameDateComponent,
                            dayWhere(false));
                        applyHail(world, undefined,
                            { kind: 'lowerPrice', target: PORT });
                        expect(ship.components.get(StellarHaggleComponent)!
                            .get(PORT_ID))
                            .toEqual({ countered: false, withdrawn: true });

                        const hull = await changeHull(path, world, ship);
                        const credits = hull.components
                            .get(CreditsComponent)!.credits;
                        expect(hull.components.get(StellarHaggleComponent)!
                            .get(PORT_ID))
                            .toEqual({ countered: false, withdrawn: true });

                        // Re-offered: still refused, nothing charged.
                        applyHail(world, undefined,
                            { kind: 'bribe', target: PORT });
                        applyHail(world, undefined,
                            { kind: 'lowerPrice', target: PORT });
                        expect(hull.components.get(CreditsComponent)!.credits)
                            .toEqual(credits);
                        expect(hull.components.has(StellarBribesComponent))
                            .toBeFalse();
                        expect(pressLand(world).blocked[0].reason)
                            .toEqual('denied');
                    }, 30_000);

                it('a bought clearance still opens the port', async () => {
                    const { world, ship } = await shutOutHarness();
                    applyHail(world, undefined,
                        { kind: 'bribe', target: PORT });
                    const until = ship.components.get(StellarBribesComponent)!
                        .get(PORT_ID);
                    expect(until).toBeDefined();

                    const hull = await changeHull(path, world, ship);
                    expect(hull.components.get(StellarBribesComponent)!
                        .get(PORT_ID)).toBe(until);
                    // Cleared by the first `l`, landed by the next.
                    expect(pressLand(world).blocked).toEqual([]);
                    const { lands, blocked } = pressLand(world);
                    expect(blocked).toEqual([]);
                    expect(lands.length).toBe(1);
                }, 30_000);

                it('a counter stays on the table, and paying it on the new '
                    + 'hull leaves the traded-in hull\'s maps as they were',
                    async () => {
                        const { world, ship } = await shutOutHarness();
                        ship.components.set(GameDateComponent,
                            dayWhere(true));
                        applyHail(world, undefined,
                            { kind: 'lowerPrice', target: PORT });
                        const oldHaggle =
                            ship.components.get(StellarHaggleComponent)!;
                        expect(oldHaggle.get(PORT_ID))
                            .toEqual({ countered: true, withdrawn: false });

                        const hull = await changeHull(path, world, ship);
                        const credits = hull.components
                            .get(CreditsComponent)!.credits;
                        // Accept Price pays the 0x8000 port's counter:
                        // 4,000 -> 3,000.
                        applyHail(world, undefined,
                            { kind: 'bribe', target: PORT });
                        expect(hull.components.get(CreditsComponent)!.credits)
                            .toEqual(credits - 3_000);
                        expect(hull.components.get(StellarHaggleComponent)!
                            .has(PORT_ID)).toBeFalse();
                        expect(pressLand(world).blocked).toEqual([]);

                        // The hull left behind shares no map with the one
                        // flown away: its haggle and (lack of) clearance
                        // are as they were at the trade.
                        expect(ship.components.get(StellarHaggleComponent))
                            .toBe(oldHaggle);
                        expect([...oldHaggle]).toEqual([[PORT_ID,
                            { countered: true, withdrawn: false }]]);
                        expect(ship.components.has(StellarBribesComponent))
                            .toBeFalse();
                    }, 30_000);
            });
        }
    });
});

describe('planet bribes: a fresh refusal lasts the system visit (reference '
    + '"R7 planet bribe withdrawal, wave 30")', () => {
    /** Coldharbour, its govt made a PLAIN (0x4000) bargainer: only a plain
     * planet refuses outright (a 0x8000 one always takes bribes). */
    const PORT = `planet ${SYNTHETIC.planets.coldharbour}`;
    /** Port Amberline: the system's open port, where the pilot lands. */
    const OPEN = `planet ${SYNTHETIC.planets.port}`;
    /** The visit on which Coldharbour refuses this pilot outright. */
    const REFUSED_VISIT = 1;

    async function plainHarness(visit: number) {
        const { world, ship } = await makeHarness();
        const govts = world.resources.get(GovtsResource)!;
        const id = SYNTHETIC.govts.compact;
        const govt = govts.get(id)!;
        // A per-world copy: the cached govt data is shared.
        govts.set(id, { ...govt, flags: { ...govt.flags,
            planetsTakeBribes: true, largerBribes: false } });
        ship.components.set(LegalRecordsComponent, new Map([[SYSTEM, -1]]));
        ship.components.set(CreditsComponent, { credits: 100_000 });
        ship.components.set(GameDateComponent,
            { day: 23, month: 6, year: 1177 });
        ship.components.set(SystemVisitComponent, visit);
        return { world, ship };
    }

    function approach(world: World, ship: Entity, uuid: string) {
        const stellar = stellars(world).find(p => p.uuid === uuid)!;
        ship.components.get(PlanetTargetComponent)!.target = stellar.uuid;
        place(ship, stellar.position);
    }

    /** One hail's Offer Bribe followed by Accept Price and Lower Price:
     * on a refusing planet neither does anything. */
    function offerAndHaggle(world: World) {
        applyHail(world, undefined, { kind: 'bribe', target: PORT });
        applyHail(world, undefined, { kind: 'lowerPrice', target: PORT });
    }

    it('holds a fresh refusal through re-hails and a landing at the '
        + 'system\'s other port a day later (finding 3, run r7_fresh_1)',
        async () => {
            expect(planetRefusesBribe(PORT, SHIP_UUID, false,
                REFUSED_VISIT)).toBeTrue();
            const { world, ship } = await plainHarness(REFUSED_VISIT);
            approach(world, ship, PORT);

            // The first offer and two re-hails: refused, nothing charged,
            // nothing haggled, the port still shut.
            for (let hail = 0; hail < 3; hail++) {
                offerAndHaggle(world);
            }
            expect(ship.components.get(CreditsComponent)!.credits)
                .toEqual(100_000);
            expect(ship.components.has(StellarBribesComponent)).toBeFalse();
            expect(ship.components.has(StellarHaggleComponent)).toBeFalse();
            expect(pressLand(world).blocked[0].reason).toEqual('denied');

            // Land on the open port; the landing and take-off move the
            // date a day (June 23 -> 24, as the pulled pilot read) and
            // keep the visit.
            approach(world, ship, OPEN);
            pressLand(world); // The clearance ...
            expect(pressLand(world).lands.length).toBe(1); // ... the landing.
            ship.components.set(GameDateComponent,
                { day: 24, month: 6, year: 1177 });
            expect(ship.components.get(SystemVisitComponent))
                .toBe(REFUSED_VISIT);

            // Back at the refusing port: still refused.
            approach(world, ship, PORT);
            offerAndHaggle(world);
            expect(ship.components.get(CreditsComponent)!.credits)
                .toEqual(100_000);
            expect(ship.components.has(StellarBribesComponent)).toBeFalse();
            expect(pressLand(world).blocked[0].reason).toEqual('denied');
        }, 30_000);

    it('draws the refusal afresh after a jump out and back: the next offer '
        + 'names a price (GUESS: the withdrawal\'s scope, wave 29)',
        async () => {
            const { world, ship } = await plainHarness(REFUSED_VISIT);
            approach(world, ship, PORT);
            offerAndHaggle(world);
            expect(ship.components.get(CreditsComponent)!.credits)
                .toEqual(100_000);

            // Out to a neighbour and back: two crossings, two days.
            prepareCarriedEntitiesForFreshWorld(ship, SHIP_UUID, []);
            prepareCarriedEntitiesForFreshWorld(ship, SHIP_UUID, []);
            ship.components.set(GameDateComponent,
                { day: 25, month: 6, year: 1177 });
            const back = ship.components.get(SystemVisitComponent)!;
            expect(back).toBe(REFUSED_VISIT + 2);
            expect(planetRefusesBribe(PORT, SHIP_UUID, false, back))
                .toBeFalse();

            applyHail(world, undefined, { kind: 'bribe', target: PORT });
            // A plain planet's 3,000 (no growth under 1M).
            expect(ship.components.get(CreditsComponent)!.credits)
                .toEqual(100_000 - 3_000);
            expect(pressLand(world).blocked).toEqual([]);
        }, 30_000);

    it('keeps a priced first offer priced for the visit, a later day '
        + 'included (GUESS: drawn once per visit either way)', async () => {
            expect(planetRefusesBribe(PORT, SHIP_UUID, false, 0)).toBeFalse();
            for (const day of [23, 24, 30]) {
                const { world, ship } = await plainHarness(0);
                ship.components.set(GameDateComponent,
                    { day, month: 6, year: 1177 });
                approach(world, ship, PORT);
                applyHail(world, undefined, { kind: 'bribe', target: PORT });
                expect(ship.components.get(CreditsComponent)!.credits)
                    .withContext(`June ${day}`).toEqual(100_000 - 3_000);
            }
        }, 30_000);

    it('carries the visit through the serializer and the delta stream',
        async () => {
            const { world } = await makeHarness();
            const serializer = world.resources.get(SerializerResource)!;
            const encoded = serializer.encodeComponent(SystemVisitComponent,
                7);
            const decoded = serializer.decodeComponent('SystemVisit',
                encoded) as { _tag: string, right: [unknown, unknown] };
            expect(decoded?._tag).toEqual('Right');
            expect(decoded.right[1]).toBe(7);
            expect(world.resources.get(DeltaResource)!.componentDeltas.has(
                SystemVisitComponent as never)).toBeTrue();
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
                // A hypergate says it to a CLEARED ship: one not yet
                // cleared is cleared by distance alone (wave 28, wave 30).
                ship.components.set(PlanetTargetComponent, kind === 'hypergate'
                    ? { target: gate.uuid, cleared: gate.uuid }
                    : { target: gate.uuid });
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
    // 25"). The selecting press clears only INSIDE the clearance zone (by
    // distance alone: wave 28's coasting ship 250 px off was cleared);
    // farther out it requests ("Hypergate `l` range and the request lines,
    // wave 29", and "Hypergates, wave 30", below).
    it('answers a hypergate\'s first `l` inside its clearance zone with its '
        + 'clearance, never the window, and does not go through',
        async () => {
            const { world, ship, gate } = await atGate(
                SYNTHETIC.systems.kestrel, KESTREL_GATE);
            const range = STELLAR_CLEARANCE_RANGE;
            for (const [position, velocity] of [
                [gate.position, new Vector(0, 0)],
                [new Position(gate.position.x, gate.position.y + range),
                    new Vector(0, 0)],
                [gate.position, new Vector(100, 0)],
            ] as const) {
                ship.components.get(PlanetTargetComponent)!.target = undefined;
                place(ship, position, velocity);
                const cleared: { kind: string, entities?: unknown }[] = [];
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
                    { kind: 'hypergate', entities: [SHIP_UUID] }]);
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

    function step(world: World) {
        return stepRecordingClearances(world);
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
        }, 30_000);

    it('clears and opens with NO press when the ship comes inside the '
        + 'clearance zone after a request, and the next `l` enters the gate',
        async () => {
            const { world, ship, gate } = await kestrel();
            place(ship, new Position(gate.position.x + 300, gate.position.y));
            press(world);
            expect(target(ship).target).toBe(gate.uuid);
            expect(target(ship).requested).toBe(gate.uuid);
            expect(holdsGateClearance(target(ship))).toBeFalse();

            place(ship, gate.position);
            const clearance = step(world);
            expect(clearance).toEqual([
                { kind: 'hypergate', automatic: true,
                    entities: [SHIP_UUID] }]);
            expect(target(ship).cleared).toBe(gate.uuid);
            expect(target(ship).requested).toBeUndefined();
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
        expect(again.cleared).toEqual([{ kind: 'hypergate' }]);
    }, 30_000);

    it('draws "Hypergate is online" by the salted hash, not by another '
        + 'ship\'s clearance', async () => {
            const { world, ship, gate } = await kestrel();
            // Another ship holding the gate's clearance changes nothing.
            const other = new Entity('other');
            other.components.set(PlanetTargetComponent,
                { target: gate.uuid, cleared: gate.uuid });
            world.entities.set('other ship', other);
            const gateId = world.entities.get(gate.uuid)!
                .components.get(PlanetComponent)!.id;
            const seen = new Set<boolean>();
            for (let i = 0; i < 40; i++) {
                selectPlanetTarget(target(ship), undefined);
                place(ship, new Position(gate.position.x + 300,
                    gate.position.y));
                // The sim clock when the request is answered.
                let now = NaN;
                const sub = world.events.get(LandingRequestEvent).subscribe(
                    () => now = world.resources.get(TimeResource)?.time ?? 0);
                const { requests } = press(world);
                sub.unsubscribe();
                expect(requests.length).toBe(1);
                const expected = hypergateRequestOnline(gateId, SHIP_UUID,
                    now);
                expect(requests[0].online ?? false).toBe(expected);
                seen.add(expected);
                // Let the sim clock move on.
                world.step();
            }
            // Both phrases turn up over forty requests.
            expect(seen.size).toBe(2);
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

// Measured: reference "Hypergates, wave 30". A hypergate has TWO zones:
// the CLEARANCE zone (the selecting `l`, and the automatic clearance of a
// standing request) is a square of half-side 248-250 px whatever the art
// (STELLAR_CLEARANCE_RANGE, 249 a GUESS inside it); the ENTRY window
// (the `l` that opens the gate map) goes by the art, 1.7 x its width, with
// no 212 px cap. On the synthetic Kestrel Gate, its art set to the stock
// 150 px gate's or to the 72 px planet art of Kit Gate Small.
describe('hypergates, wave 30: the clearance zone, the entry window, the '
    + 'automatic clearance and the #74 / #75 draw', () => {
    const KESTREL_GATE = `planet ${SYNTHETIC.planets.kestrelGate}`;

    async function kestrel(art: number) {
        const { world, ship } = await makeHarness(getSyntheticGameData(),
            SYNTHETIC.systems.kestrel);
        const gate = stellars(world).find(p => p.uuid === KESTREL_GATE)!;
        expect(gate).toBeDefined();
        // A copy: the component holds the shared cached PlanetData.
        const entity = world.entities.get(KESTREL_GATE)!;
        entity.components.set(PlanetDataComponent, {
            ...entity.components.get(PlanetDataComponent)!,
            spriteFrameSize: [art, art],
        });
        return { world, ship, gate };
    }

    function target(ship: Entity) {
        return ship.components.get(PlanetTargetComponent)!;
    }

    function pressRecording(world: World) {
        const cleared: unknown[] = [];
        const requests: LandingRequest[] = [];
        const subs = [
            world.events.get(LandingClearedEvent)
                .subscribe(({ data }) => cleared.push(data)),
            world.events.get(LandingRequestEvent)
                .subscribe(({ data }) => requests.push(data)),
        ];
        const { lands, blocked } = pressLand(world);
        subs.forEach(s => s.unsubscribe());
        return {
            lands, blocked: blocked.map(b => b.reason), cleared,
            requests: requests.map(r => r.kind),
        };
    }

    /** One `l` with the ship at rest at `gate + (dx, dy)` and nothing
     * selected before it. */
    function selectAt(world: World, ship: Entity,
        gate: { position: Position }, dx: number, dy: number) {
        selectPlanetTarget(target(ship), undefined);
        place(ship, new Position(gate.position.x + dx, gate.position.y + dy));
        return pressRecording(world);
    }

    it('makes the gate entry window 1.7 x the art with no 212 px cap (a '
        + 'planet\'s too since wave 31; a wormhole keeps it)', () => {
        expect(STELLAR_CLEARANCE_RANGE).toBe(249);
        const gate = (w: number, kind: 'hypergate' | 'wormhole' =
            'hypergate'): PlanetData => ({
            ...getDefaultPlanetData(), spriteFrameSize: [w, w],
            gate: { kind, destinations: [], emergenceAngle: 0 },
        });
        expect(stellarLandingRange(gate(150))).toBeCloseTo(255, 9);
        expect(stellarLandingRange(gate(72))).toBeCloseTo(122.4, 9);
        expect(stellarLandingRange(gate(300))).toBeCloseTo(510, 9);
        expect(stellarLandingRange({
            ...getDefaultPlanetData(), spriteFrameSize: [300, 300],
        })).toBeCloseTo(510, 9);
        expect(WORMHOLE_LAND_RANGE_CAP).toBe(212);
        expect(stellarLandingRange(gate(300, 'wormhole'))).toBe(212);
        expect(stellarLandingRange(gate(72, 'wormhole')))
            .toBeCloseTo(122.4, 9);
    });

    it('clears inside a 249 px SQUARE and requests outside it, the same '
        + 'for a 150 px and a 72 px gate', async () => {
        for (const art of [150, 72]) {
            const { world, ship, gate } = await kestrel(art);
            for (const [dx, dy, clears] of [
                [248, 0, true], [249, 0, true], [250, 0, false],
                [0, -249, true], [0, 250, false],
                // The (180, 180) diagonal, 255 px away: cleared (a square).
                [180, 180, true], [249, -249, true],
                [250, 100, false], [100, -250, false],
                [140, 0, true], [230, 0, true], [300, 0, false],
            ] as const) {
                const answer = selectAt(world, ship, gate, dx, dy);
                const context = `art ${art} at (${dx}, ${dy})`;
                expect(target(ship).target).withContext(context)
                    .toBe(gate.uuid);
                expect(answer.blocked).withContext(context).toEqual([]);
                expect(answer.lands).withContext(context).toEqual([]);
                expect(answer.cleared.length).withContext(context)
                    .toBe(clears ? 1 : 0);
                expect(answer.requests).withContext(context)
                    .toEqual(clears ? [] : ['hypergate']);
                expect(holdsGateClearance(target(ship))).withContext(context)
                    .toBe(clears);
                expect(holdsRequest(target(ship))).withContext(context)
                    .toBe(!clears);
            }
        }
    }, 30_000);

    it('enters the 150 px gate at 248 px and on the (180, 180) diagonal '
        + '(no 212 px cap)', async () => {
        const { world, ship, gate } = await kestrel(150);
        for (const [dx, dy] of [[248, 0], [180, 180], [-212, 240]]) {
            expect(selectAt(world, ship, gate, dx, dy).cleared.length)
                .toBe(1);
            expect(pressRecording(world).lands.length)
                .withContext(`(${dx}, ${dy})`).toBe(1);
        }
    }, 30_000);

    it('says "too far" to a cleared 72 px gate\'s second `l` at 140 px and '
        + 'enters it inside 122 px', async () => {
        const { world, ship, gate } = await kestrel(72);
        for (const dx of [140, 230]) {
            expect(selectAt(world, ship, gate, dx, 0).cleared.length).toBe(1);
            const second = pressRecording(world);
            expect(second.blocked).withContext(`${dx}`).toEqual(['tooFar']);
            expect(second.cleared).toEqual([]);
            // Still cleared: coming inside the art's window enters it.
            expect(holdsGateClearance(target(ship))).toBeTrue();
        }
        place(ship, new Position(gate.position.x + 122, gate.position.y));
        expect(pressRecording(world).lands.length).toBe(1);
    }, 30_000);

    it('clears a standing request ONCE as the ship coasts into the zone, '
        + 'with no press', async () => {
        const { world, ship, gate } = await kestrel(150);
        // The request: the selecting `l` at 300 px.
        expect(selectAt(world, ship, gate, 300, 0).requests)
            .toEqual(['hypergate']);
        const events: unknown[] = [];
        // Coasting in at about 49 px/s (wave 30's Kit Gate Toward).
        for (const dx of [290, 270, 255, 250]) {
            place(ship, new Position(gate.position.x + dx, gate.position.y),
                new Vector(-49, 0));
            events.push(...stepRecordingClearances(world));
        }
        expect(events).toEqual([]);
        expect(holdsGateClearance(target(ship))).toBeFalse();
        place(ship, new Position(gate.position.x + 247, gate.position.y),
            new Vector(-49, 0));
        expect(stepRecordingClearances(world)).toEqual([
            { kind: 'hypergate', automatic: true,
                entities: [SHIP_UUID] }]);
        expect(holdsGateClearance(target(ship))).toBeTrue();
        expect(target(ship).requested).toBeUndefined();
        // Once: on in, out again and back, nothing more is said.
        for (const dx of [200, 150, 300, 400, 240, 100]) {
            place(ship, new Position(gate.position.x + dx, gate.position.y),
                new Vector(-49, 0));
            expect(stepRecordingClearances(world)).withContext(`${dx}`)
                .toEqual([]);
        }
        expect(holdsGateClearance(target(ship))).toBeTrue();
    }, 30_000);

    it('clears the request on the diagonal too (the square), and not for a '
        + 'selection without a request', async () => {
        const { world, ship, gate } = await kestrel(72);
        selectAt(world, ship, gate, 300, 300);
        expect(holdsRequest(target(ship))).toBeTrue();
        place(ship, new Position(gate.position.x + 200,
            gate.position.y + 240));
        expect(stepRecordingClearances(world).length).toBe(1);

        // A click selection (no request) inside the zone: nothing until
        // the `l`, which clears.
        applySetPlanetTarget(world, undefined, null);
        applySetPlanetTarget(world, undefined, gate.uuid);
        place(ship, new Position(gate.position.x + 100, gate.position.y));
        expect(stepRecordingClearances(world)).toEqual([]);
        expect(holdsGateClearance(target(ship))).toBeFalse();
        expect(pressRecording(world).cleared.length).toBe(1);
    }, 30_000);

    it('drops the request when the selection moves on', async () => {
        const { world, ship, gate } = await kestrel(150);
        selectAt(world, ship, gate, 300, 0);
        expect(holdsRequest(target(ship))).toBeTrue();
        applySetPlanetTarget(world, undefined,
            `planet ${SYNTHETIC.planets.kestrelRock}`);
        expect(target(ship).requested).toBeUndefined();
        applySetPlanetTarget(world, undefined, gate.uuid);
        place(ship, gate.position);
        expect(stepRecordingClearances(world)).toEqual([]);
    }, 30_000);

    it('draws #75 "online" about 5 times in 17, independently of the '
        + 'line\'s form', () => {
        expect(HYPERGATE_ONLINE / HYPERGATE_ONLINE_OUT_OF)
            .toBeCloseTo(5 / 17, 9);
        let online = 0;
        let total = 0;
        // [online, draws] by the form's ship-name bit.
        const byNamed = [[0, 0], [0, 0]];
        for (const stellar of ['nova:1400', 'nova:1401', 'nova:130']) {
            for (const pilot of ['pilot a', 'pilot b', SHIP_UUID]) {
                for (let now = 0; now < 3000 * 16; now += 16) {
                    const draw = hypergateRequestOnline(stellar, pilot, now);
                    expect(hypergateRequestOnline(stellar, pilot, now))
                        .toBe(draw);
                    const named = landingRequestForm(stellar, pilot, now) & 1;
                    byNamed[named][0] += draw ? 1 : 0;
                    byNamed[named][1]++;
                    online += draw ? 1 : 0;
                    total++;
                }
            }
        }
        expect(online / total).toBeGreaterThan(5 / 17 - 0.01);
        expect(online / total).toBeLessThan(5 / 17 + 0.01);
        for (const [count, of] of byNamed) {
            expect(count / of).toBeGreaterThan(5 / 17 - 0.015);
            expect(count / of).toBeLessThan(5 / 17 + 0.015);
        }
    });
});

// Measured: reference "Planet and station clearance, wave 31". Ports and
// stations have the gates' two zones: the selecting `l` inside a fixed
// 249 px square (whatever the art) CLEARS and prints "Cleared to land,
// <ship>. Welcome to <port>." etc. (#94-101), a standing request is
// cleared with no press on entering it, only a cleared ship lands, inside
// 1.7 x the art's width with no 212 px cap, and a clearance lapses within
// 13.4-25.1 s (20 s, GUESS). Port Amberline stands in for every art, its
// frame and station flag swapped; the ship sits east of it, where it is
// the nearest port.
describe('planets and stations, wave 31: the clearance square, the cleared '
    + 'lines, the uncapped window and the lapse', () => {
    const PORT = `planet ${SYNTHETIC.planets.port}`;

    async function port(frame: [number, number], isStation = false) {
        const { world, ship } = await makeHarness();
        const entity = world.entities.get(PORT)!;
        const data = entity.components.get(PlanetDataComponent)!;
        // A copy: the component holds the shared cached PlanetData.
        entity.components.set(PlanetDataComponent, {
            ...data, spriteFrameSize: frame,
            flags: { ...data.flags, isStation },
        });
        const stellar = stellars(world).find(p => p.uuid === PORT)!;
        return { world, ship, stellar };
    }

    function target(ship: Entity) {
        return ship.components.get(PlanetTargetComponent)!;
    }

    function now(world: World) {
        return world.resources.get(TimeResource)!.time;
    }

    function pressRecording(world: World) {
        const cleared: LandingCleared[] = [];
        const requests: LandingRequest[] = [];
        const subs = [
            world.events.get(LandingClearedEvent)
                .subscribe(({ data }) => cleared.push(data)),
            world.events.get(LandingRequestEvent)
                .subscribe(({ data }) => requests.push(data)),
        ];
        const { lands, blocked } = pressLand(world);
        subs.forEach(s => s.unsubscribe());
        return {
            lands: lands.length, blocked: blocked.map(b => b.reason),
            cleared, requests: requests.map(r => r.kind),
        };
    }

    /** Puts the ship at rest at the port + (dx, dy). */
    function at(ship: Entity, stellar: { position: Position }, dx: number,
        dy = 0) {
        place(ship, new Position(stellar.position.x + dx,
            stellar.position.y + dy));
    }

    /** One `l` with the ship at rest at port + (dx, dy) and nothing
     * selected before it. */
    function selectAt(world: World, ship: Entity,
        stellar: { position: Position }, dx: number, dy = 0) {
        selectPlanetTarget(target(ship), undefined);
        at(ship, stellar, dx, dy);
        return pressRecording(world);
    }

    it('clears inside a 249 px SQUARE whatever the art and requests '
        + 'outside it: 72 and 250 px planets, 17 x 31 and 315 x 200 '
        + 'stations', async () => {
        for (const [frame, isStation] of [
            [[72, 72], false], [[250, 250], false],
            [[17, 31], true], [[315, 200], true],
        ] as Array<[[number, number], boolean]>) {
            const { world, ship, stellar } = await port(frame, isStation);
            const kind = isStation ? 'station' : 'planet';
            for (const [dx, dy, clears] of [
                [140, 0, true], [230, 0, true], [245, 0, true],
                [249, 0, true], [250, 0, false], [260, 0, false],
                [0, -249, true], [0, -250, false],
                // The (180, 180) diagonal, 255 px away: cleared (a square).
                [180, 180, true], [249, -249, true],
                [250, 100, false], [100, -250, false],
            ] as const) {
                const answer = selectAt(world, ship, stellar, dx, dy);
                const context = `${frame} at (${dx}, ${dy})`;
                expect(target(ship).target).withContext(context).toBe(PORT);
                expect(answer.blocked).withContext(context).toEqual([]);
                expect(answer.lands).withContext(context).toBe(0);
                expect(answer.cleared.map(c => c.kind)).withContext(context)
                    .toEqual(clears ? [kind] : []);
                expect(answer.requests).withContext(context)
                    .toEqual(clears ? [] : [kind]);
                expect(holdsClearance(target(ship), now(world)))
                    .withContext(context).toBe(clears);
                expect(holdsRequest(target(ship))).withContext(context)
                    .toBe(!clears);
                if (clears) {
                    const [line] = answer.cleared;
                    expect(line.stellarName).toBe('Port Amberline');
                    expect([0, 1, 2]).toContain(line.form!);
                    expect(typeof line.welcome).toBe('boolean');
                    expect(line.automatic).toBeUndefined();
                    // The lapse is STELLAR_CLEARANCE_MS from the press.
                    expect(target(ship).clearedUntil! - now(world))
                        .toBeCloseTo(STELLAR_CLEARANCE_MS, -2);
                }
            }
        }
    }, 30_000);

    it('answers "too far" to an uncleared press outside the square even '
        + 'inside 1.7 W (finding 4: the 250 px planet and the 315 px '
        + 'station requested at 260)', async () => {
        for (const [frame, isStation] of [
            [[250, 250], false], [[315, 200], true],
        ] as Array<[[number, number], boolean]>) {
            const { world, ship, stellar } = await port(frame, isStation);
            expect(stellarLandingRange(world.entities.get(PORT)!.components
                .get(PlanetDataComponent))).toBeGreaterThan(400);
            expect(selectAt(world, ship, stellar, 260).requests.length)
                .toBe(1);
            const second = pressRecording(world);
            expect(second.blocked).toEqual(['tooFar']);
            expect(second.lands).toBe(0);
            expect(second.cleared).toEqual([]);
            // A click selection (no request, no clearance) at 300 px: too
            // far as well, and nothing is cleared or requested.
            applySetPlanetTarget(world, undefined, null);
            applySetPlanetTarget(world, undefined, PORT);
            at(ship, stellar, 300);
            const click = pressRecording(world);
            expect(click.blocked).toEqual(['tooFar']);
            expect(click.cleared).toEqual([]);
            expect(click.requests).toEqual([]);
        }
    }, 30_000);

    it('lands a ship cleared at 230 px on a 250 px planet from 294, 359 '
        + 'and 425 px (finding 3: no 212 px cap), and not from 426',
        async () => {
            const { world, ship, stellar } = await port([250, 250]);
            for (const dx of [294, 359, 425]) {
                expect(selectAt(world, ship, stellar, 230).cleared.length)
                    .toBe(1);
                at(ship, stellar, dx);
                expect(pressRecording(world).lands).withContext(`${dx}`)
                    .toBe(1);
            }
            expect(selectAt(world, ship, stellar, 230).cleared.length)
                .toBe(1);
            at(ship, stellar, 426);
            const far = pressRecording(world);
            expect(far.blocked).toEqual(['tooFar']);
            // Still cleared: no fresh request, no fresh clearance.
            expect(far.cleared).toEqual([]);
            expect(far.requests).toEqual([]);
            expect(holdsClearance(target(ship), now(world))).toBeTrue();
        }, 30_000);

    it('says "too far" to a cleared 72 px planet\'s second `l` at 140 and '
        + '230 px (window 122), and lands inside it', async () => {
        const { world, ship, stellar } = await port([72, 72]);
        for (const dx of [140, 230]) {
            expect(selectAt(world, ship, stellar, dx).cleared.length)
                .toBe(1);
            expect(pressRecording(world).blocked).withContext(`${dx}`)
                .toEqual(['tooFar']);
        }
        at(ship, stellar, 122);
        expect(pressRecording(world).lands).toBe(1);
    }, 30_000);

    it('clears a standing request ONCE with no press as the ship coasts '
        + 'into the square, with a port\'s line (finding 2)', async () => {
        const { world, ship, stellar } = await port([250, 250]);
        // The request: the selecting `l` at about 430 px.
        expect(selectAt(world, ship, stellar, 430).requests)
            .toEqual(['planet']);
        const events: unknown[] = [];
        for (const dx of [400, 300, 260, 250]) {
            place(ship, new Position(stellar.position.x + dx,
                stellar.position.y), new Vector(-49, 0));
            events.push(...stepRecordingClearances(world));
        }
        expect(events).toEqual([]);
        place(ship, new Position(stellar.position.x + 247,
            stellar.position.y), new Vector(-49, 0));
        const [line, ...more] = stepRecordingClearances(world);
        expect(more).toEqual([]);
        expect(line).toEqual(jasmine.objectContaining({
            kind: 'planet', automatic: true, stellarName: 'Port Amberline',
            entities: [SHIP_UUID],
        }));
        expect([0, 1, 2]).toContain(line.form!);
        expect(holdsClearance(target(ship), now(world))).toBeTrue();
        expect(target(ship).requested).toBeUndefined();
        // Once: on in, out again and back, nothing more is said.
        for (const dx of [200, 300, 400, 240]) {
            at(ship, stellar, dx);
            expect(stepRecordingClearances(world)).withContext(`${dx}`)
                .toEqual([]);
        }
        // And, at rest inside its window, the next `l` lands.
        at(ship, stellar, 240);
        expect(pressRecording(world).lands).toBe(1);
    }, 30_000);

    it('clears the request on the diagonal (a square: the 72 px port at '
        + '(244, -186.5), 307 px away) and a station the same way',
        async () => {
            for (const isStation of [false, true]) {
                const { world, ship, stellar } = await port([72, 72],
                    isStation);
                selectAt(world, ship, stellar, 430, -300);
                expect(holdsRequest(target(ship))).toBeTrue();
                at(ship, stellar, 250, -186.5);
                expect(stepRecordingClearances(world)).toEqual([]);
                at(ship, stellar, 244, -186.5);
                expect(stepRecordingClearances(world).map(c => c.kind))
                    .toEqual([isStation ? 'station' : 'planet']);
            }
        }, 30_000);

    it('lapses a port\'s clearance after 20 s (GUESS in 13.4-25.1): a '
        + 'press 13.4 s on lands, one 25.1 s on outside the square draws a '
        + 'fresh request, one 36.7 s on inside it a fresh clearance '
        + '(finding 5)', async () => {
            expect(STELLAR_CLEARANCE_MS).toBe(20_000);
            const time = (world: World) =>
                world.resources.get(TimeResource)!;
            {
                const { world, ship, stellar } = await port([250, 250]);
                selectAt(world, ship, stellar, 230);
                time(world).time += 13_400;
                at(ship, stellar, 425);
                expect(clearanceLapsed(target(ship), now(world)))
                    .toBeFalse();
                expect(pressRecording(world).lands).toBe(1);
            }
            {
                const { world, ship, stellar } = await port([250, 250]);
                selectAt(world, ship, stellar, 230);
                time(world).time += 19_900;
                at(ship, stellar, 325);
                expect(pressRecording(world).lands).toBe(1);
            }
            {
                const { world, ship, stellar } = await port([250, 250]);
                selectAt(world, ship, stellar, 230);
                time(world).time += 25_100;
                at(ship, stellar, 325);
                expect(clearanceLapsed(target(ship), now(world)))
                    .toBeTrue();
                expect(holdsClearance(target(ship), now(world)))
                    .toBeFalse();
                const late = pressRecording(world);
                expect(late.lands).toBe(0);
                expect(late.blocked).toEqual([]);
                expect(late.requests).toEqual(['planet']);
                expect(target(ship).cleared).toBeUndefined();
                expect(target(ship).clearedUntil).toBeUndefined();
                expect(holdsRequest(target(ship))).toBeTrue();
                // The fresh request clears on the way back in.
                at(ship, stellar, 240);
                expect(stepRecordingClearances(world).length).toBe(1);
            }
            {
                const { world, ship, stellar } = await port([250, 250]);
                selectAt(world, ship, stellar, 230);
                time(world).time += 36_700;
                // Sitting inside the square: no automatic re-clearance.
                expect(stepRecordingClearances(world)).toEqual([]);
                const again = pressRecording(world);
                expect(again.lands).toBe(0);
                expect(again.cleared.map(c => c.kind)).toEqual(['planet']);
                expect(pressRecording(world).lands).toBe(1);
            }
        }, 30_000);

    it('leaves a hypergate\'s clearance without a lapse (unmeasured)',
        async () => {
            const { world, ship } = await makeHarness(getSyntheticGameData(),
                SYNTHETIC.systems.kestrel);
            const gate = stellars(world).find(p =>
                p.uuid === `planet ${SYNTHETIC.planets.kestrelGate}`)!;
            selectPlanetTarget(target(ship), undefined);
            place(ship, gate.position);
            expect(pressRecording(world).cleared.map(c => c.kind))
                .toEqual(['hypergate']);
            expect(target(ship).clearedUntil).toBeUndefined();
            world.resources.get(TimeResource)!.time += 60_000;
            expect(holdsGateClearance(target(ship))).toBeTrue();
            expect(pressRecording(world).lands).toBe(1);
        }, 30_000);

    it('leaves other ships alone: an NPC with the port selected inside the '
        + 'square is never cleared and hears nothing', async () => {
        const { world, ship, stellar } = await port([250, 250]);
        const npc = makeShip(ship.components.get(ShipDataComponent)!);
        await completeEntity(world, npc);
        world.entities.set('wave 31 npc', npc);
        world.step();
        const npcTarget = npc.components.get(PlanetTargetComponent)!;
        selectPlanetTarget(npcTarget, PORT);
        place(npc, new Position(stellar.position.x + 100,
            stellar.position.y));
        const heard: unknown[] = [];
        world.events.get(LandingClearedEvent)
            .subscribe(({ data }) => heard.push(data));
        for (let i = 0; i < 5; i++) {
            world.step();
        }
        expect(heard).toEqual([]);
        expect(npcTarget.cleared).toBeUndefined();
        expect(npcTarget.requested).toBeUndefined();
    }, 30_000);

    it('draws the cleared line\'s two pieces by salted hash at the measured '
        + '8 : 5 : 3 and Welcome 7 in 16, independently (GUESS)', () => {
        expect(STELLAR_CLEARED_FORM_ODDS).toEqual([8, 5, 3]);
        expect(STELLAR_CLEARED_OUT_OF).toBe(16);
        expect(STELLAR_CLEARED_WELCOME).toBe(7);
        const forms = [0, 0, 0];
        // [welcome, draws] by form.
        const welcomeBy = [[0, 0], [0, 0], [0, 0]];
        let total = 0;
        for (const stellar of ['nova:128', 'nova:131', 'nova:1400']) {
            for (const pilot of ['pilot a', 'pilot b', SHIP_UUID]) {
                for (let t = 0; t < 3000 * 16; t += 16) {
                    const draw = stellarClearedForm(stellar, pilot, t);
                    expect(stellarClearedForm(stellar, pilot, t))
                        .toEqual(draw);
                    forms[draw.form]++;
                    welcomeBy[draw.form][0] += draw.welcome ? 1 : 0;
                    welcomeBy[draw.form][1]++;
                    total++;
                }
            }
        }
        expect(Math.abs(forms[0] / total - 8 / 16)).toBeLessThan(0.01);
        expect(Math.abs(forms[1] / total - 5 / 16)).toBeLessThan(0.01);
        expect(Math.abs(forms[2] / total - 3 / 16)).toBeLessThan(0.01);
        for (const [welcome, of] of welcomeBy) {
            expect(Math.abs(welcome / of - 7 / 16)).toBeLessThan(0.02);
        }
    });

    it('words the port and station lines as STR# 2002 #94-101, as read on '
        + 'the original', () => {
        expect(stellarClearedMessage(false, 0, true, 'Kit Land P72 140',
            'w31-land-p72-140')).toEqual(
            'Cleared to land, w31-land-p72-140. Welcome to Kit Land P72 140.');
        expect(stellarClearedMessage(false, 0, false, 'Kit Land P72 230',
            'w31-land-p72-230')).toEqual(
            'Cleared to land, w31-land-p72-230. Commence final approach.');
        expect(stellarClearedMessage(false, 1, true, 'Kit Land P250 230',
            'w31-land-p250-230')).toEqual('w31-land-p250-230, you\'re '
            + 'cleared to land. Welcome to Kit Land P250 230.');
        expect(stellarClearedMessage(false, 2, false, 'Kit Land P250 245',
            'w31-land-p250-245')).toEqual(
            'You are cleared to land. Commence final approach.');
        expect(stellarClearedMessage(true, 1, false, 'Kit Land S17 140',
            'w31-land-s17-140')).toEqual('w31-land-s17-140, you\'re '
            + 'cleared to dock. Commence final approach.');
        expect(stellarClearedMessage(true, 0, false, 'Kit Land S17 230',
            'w31-land-s17-230')).toEqual(
            'Cleared to dock, w31-land-s17-230. Commence final approach.');
        expect(stellarClearedMessage(true, 1, true, 'Kit Land S315 230',
            'w31-land-s315-230')).toEqual('w31-land-s315-230, you\'re '
            + 'cleared to dock. Welcome to Kit Land S315 230.');
        expect(stellarClearedMessage(false, 2, true,
            'Kit Land Toward P72', 'w31-toward-p72')).toEqual(
            'You are cleared to land. Welcome to Kit Land Toward P72.');
        // With no ship name the nameless #99 / #96 stands in.
        expect(stellarClearedMessage(true, 0, true, 'Holpa Station'))
            .toEqual('You are cleared to dock. Welcome to Holpa Station.');
    });

    it('aims the autopilot inside the smaller of the square and the window',
        () => {
            const planet = (w: number): PlanetData => ({
                ...getDefaultPlanetData(), spriteFrameSize: [w, w],
            });
            expect(stellarApproachRange(planet(250)))
                .toBe(STELLAR_CLEARANCE_RANGE);
            expect(stellarApproachRange(planet(72))).toBeCloseTo(122.4, 9);
            expect(stellarApproachRange({
                ...planet(325),
                gate: { kind: 'wormhole', destinations: [],
                    emergenceAngle: 0 },
            })).toBe(WORMHOLE_LAND_RANGE_CAP);
        });
});
