import 'jasmine';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import {
    MovementPhysicsComponent, MovementStateComponent, MovementType,
} from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { Autopilot } from './autopilot.js';
import { getSyntheticGameData } from './communication/simulation_test_fixture.js';
import { makeSystem } from './nova_plugin/make_system.js';
import {
    applyAnalogControl, applyControlEvents, ControlledByComponent,
    PlayerShipSelector,
} from './nova_plugin/player/index.js';
import { makeShip } from './nova_plugin/ship/index.js';
import { completeEntity } from './nova_plugin/spawn/index.js';
import {
    LandEvent, LandingBlockedEvent, landingDistance, PlanetDataComponent,
    PlanetTargetComponent, stellarLandingRange,
} from './nova_plugin/travel/index.js';

/**
 * The client autopilot flown in a real simulation world: its analog and
 * 'land' outputs go through the same applyAnalogControl / applyControlEvents
 * the bridge uses, and the real AttemptLandingSystem decides the landing on
 * the SQUARE zone (planet_plugin.ts's inLandingZone). Port Amberline stands
 * in for every stellar, its sprite frame swapped for the size under test.
 */
const PEER = 'autopilot peer';
const SHIP_UUID = 'autopilot ship';
const PORT = `planet ${SYNTHETIC.planets.port}`;

async function harness(frame: [number, number], shipId: string) {
    const gameData = await getSyntheticGameData();
    const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
        undefined, { npcs: false });
    const ship = makeShip(await gameData.data.Ship.get(shipId));
    ship.components.set(PlayerShipSelector, undefined);
    ship.components.set(ControlledByComponent, { peerId: PEER });
    await completeEntity(world, ship);
    world.entities.set(SHIP_UUID, ship);
    world.step();

    const planet = world.entities.get(PORT)!;
    planet.components.set(PlanetDataComponent, {
        ...planet.components.get(PlanetDataComponent)!,
        spriteFrameSize: frame,
    });
    ship.components.get(PlanetTargetComponent)!.target = PORT;
    return { world, ship, planet };
}

function fly(world: World, autopilot: Autopilot, maxTicks: number) {
    const lands: string[] = [];
    const blocked: string[] = [];
    world.events.get(LandEvent).subscribe(({ data }) => lands.push(data.uuid));
    world.events.get(LandingBlockedEvent).subscribe(({ data }) =>
        blocked.push(data.reason));
    let ticks = 0;
    for (; ticks < maxTicks && lands.length === 0; ticks++) {
        autopilot.step(world, PEER);
        world.step();
    }
    return { lands, blocked, ticks };
}

describe('Autopilot landing on the square zone', () => {
    const cases: Array<{
        name: string, frame: [number, number], offset: [number, number],
        inertialess?: boolean,
    }> = [
        { name: 'a tiny 15x21 station, straight on',
            frame: [15, 21], offset: [0, 900] },
        { name: 'a tiny 15x21 station, on the diagonal',
            frame: [15, 21], offset: [-700, -700] },
        { name: 'a 17x31 station, inertialess',
            frame: [17, 31], offset: [600, -300], inertialess: true },
        { name: 'a big 325 px planet, on the diagonal',
            frame: [325, 325], offset: [1200, 1200] },
        { name: 'a big 325 px planet, inertialess',
            frame: [325, 325], offset: [-1500, 200], inertialess: true },
    ];
    for (const { name, frame, offset, inertialess } of cases) {
        it(`lands on ${name}`, async () => {
            const { world, ship, planet } = await harness(frame,
                SYNTHETIC.ships.skiff);
            if (inertialess) {
                ship.components.set(MovementPhysicsComponent, {
                    ...ship.components.get(MovementPhysicsComponent)!,
                    movementType: MovementType.INERTIALESS,
                });
            }
            const centre = planet.components.get(MovementStateComponent)!
                .position;
            const movement = ship.components.get(MovementStateComponent)!;
            movement.position = new Position(centre.x + offset[0],
                centre.y + offset[1]);
            movement.velocity = new Vector(0, 0);

            const autopilot = new Autopilot({
                controlEvents: events =>
                    applyControlEvents(world, PEER, events),
                analogControl: control =>
                    applyAnalogControl(world, PEER, control),
            });
            autopilot.navigateTo(PORT);
            const { lands, ticks } = fly(world, autopilot, 30 * 60);

            expect(lands).withContext(`after ${ticks} ticks`).toEqual([PORT]);
            const at = ship.components.get(MovementStateComponent)!;
            const range = stellarLandingRange(
                planet.components.get(PlanetDataComponent));
            expect(landingDistance(at.position.x - centre.x,
                at.position.y - centre.y)).toBeLessThanOrEqual(range);
        }, 60_000);
    }

    it('taps land at once from a corner of the square, outside the circle '
        + 'of the same half-width', async () => {
            const { world, ship, planet } = await harness([40, 40],
                SYNTHETIC.ships.skiff);
            const range = stellarLandingRange(
                planet.components.get(PlanetDataComponent));
            const centre = planet.components.get(MovementStateComponent)!
                .position;
            const movement = ship.components.get(MovementStateComponent)!;
            // 0.85 R along both axes: inside the square's 90% aim, 1.2 R
            // from the centre.
            const corner = 0.85 * range;
            movement.position = new Position(centre.x + corner,
                centre.y - corner);
            movement.velocity = new Vector(0, 0);
            const sent: string[] = [];
            const autopilot = new Autopilot({
                controlEvents: events => {
                    sent.push(...events.map(e => `${e.action}:${e.state}`));
                    applyControlEvents(world, PEER, events);
                },
                analogControl: control =>
                    applyAnalogControl(world, PEER, control),
            });
            autopilot.navigateTo(PORT);
            const { lands, ticks } = fly(world, autopilot, 10);
            expect(sent[0]).toEqual('land:start');
            expect(lands).toEqual([PORT]);
            expect(ticks).toBe(1);
        }, 60_000);
});
