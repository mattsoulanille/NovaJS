import "jasmine";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { World } from "nova_ecs/world";
import {
    getIntegrationGameData, getSyntheticGameData,
} from "../../communication/simulation_test_fixture.js";
import { SYNTHETIC } from "novaparse/synthetic/universe";
import { completeEntity } from "../spawn/entity_data_loader.js";
import { makeShip } from "../ship/make_ship.js";
import { makeSystem } from "../make_system.js";
import { PlayerShipSelector } from "../player/player_ship_plugin.js";
import { LandEvent } from "./planet_plugin.js";
import { PlayerSoundEvent } from "../core/sound_plugin.js";
import { WARP_OUT_SOUND } from "./jump_plugin.js";
import { ShipPhysicsComponent, getShipMovementPhysics } from "../ship/ship_plugin.js";
import {
    GateArrivalComponent, GateTransit, GateTransitEvent, GATE_EMERGENCE_DISTANCE,
} from "./gate_transit_plugin.js";
import { GateDestinationResolver } from "./gate_destination_resolver.js";
import { gateMapDestinations } from "../../spaceport/hypergate_network.js";
import { landable } from "../core/landable.js";
import { EscortCommandComponent } from "../player/escort_command.js";
import { FiringGroupComponent } from "../ship/firing_group.js";
import { FormationComponent } from "../npc/npc_ai_plugin.js";
import { PlayerEscortComponent } from "../player/player_escort.js";
import {
    EscortLanded, EscortLandedEvent,
} from "../escorts/player_escort_plugin.js";
import { ControlledByComponent } from "../player/ship_control.js";

// The synthetic hypergate pair: Kestrel Gate (in Kestrel Drift, emergence
// angle 90° from CustSndID) links to Vael Gate (in Vael Hollow, 270°), and
// back. Ossory Shoal holds the link-less wormhole Ossory Rift, whose twin
// is Vael Rift (the Bible's "random wormhole"). Kestrel Rock is the
// ordinary landable stellar sharing a system with a gate.
const GATE_A_SPOB = SYNTHETIC.planets.kestrelGate;
const GATE_B_SPOB = SYNTHETIC.planets.vaelGate;
const SYSTEM_A = SYNTHETIC.systems.kestrel;
const SYSTEM_B = SYNTHETIC.systems.vael;
const PLAIN_SPOB = SYNTHETIC.planets.kestrelRock;
const WORMHOLE_SPOB = SYNTHETIC.planets.ossoryRift;
const WORMHOLE_TWIN = SYNTHETIC.planets.vaelRift;
const WORMHOLE_SYSTEM = SYNTHETIC.systems.ossory;
const SHIP_UUID = 'gate test ship';
// STOCK ids, for the one transitivity spec that stays on the real data: it
// needs a hypergate NETWORK of three or more gates, which the synthetic
// scenario's single linked pair cannot be. HG-V0a (spöb nova:1402, in
// Vellos) is a LEAF of the stock network: its only HyperLink is HG-V02
// (nova:1401). HG-Moash (spöb nova:1416) is four lanes away in Moash (sÿst
// nova:366, plus its stacked NCB copies) — same network, not adjacent.
const LEAF_GATE_SPOB = 'nova:1402';
const LEAF_GATE_LINK = 'nova:1401';
const FAR_GATE_SPOB = 'nova:1416';
const FAR_GATE_SYSTEMS = ['nova:366', 'nova:535', 'nova:605'];

async function makeGateHarness(systemId: string) {
    const gameData = await getSyntheticGameData();
    const ids = await gameData.ids;
    const world = await makeSystem(systemId, gameData);

    const shipId = [...ids.Ship].sort()[0]!;
    const shipData = await gameData.data.Ship.get(shipId);
    const ship = makeShip(shipData);
    ship.components.set(PlayerShipSelector, undefined);
    // A gate transit carries the pilot's escorts (EscortFollowGateSystem),
    // which only acts on a player-CONTROLLED ship.
    ship.components.set(ControlledByComponent, { peerId: 'test peer' });
    await completeEntity(world, ship);
    world.entities.set(SHIP_UUID, ship);

    /** An escort of the harness ship, in formation on it. */
    async function addEscort(uuid: string) {
        const escort = makeShip(shipData);
        escort.components.set(FormationComponent,
            { leader: SHIP_UUID, slot: 0 });
        escort.components.set(EscortCommandComponent,
            { command: 'formation' });
        escort.components.set(FiringGroupComponent, { group: SHIP_UUID });
        await completeEntity(world, escort);
        world.entities.set(uuid, escort);
        return escort;
    }

    return { gameData, world, ship, addEscort };
}

function stepUntil(world: World, predicate: () => boolean, maxSteps = 600) {
    for (let i = 0; i < maxSteps; i++) {
        if (predicate()) {
            return i;
        }
        world.step();
    }
    throw new Error(`Condition not met within ${maxSteps} steps`);
}

describe('gate transit', () => {
    it('does NOT auto-transit when landing on a hypergate', async () => {
        // Hypergate landings dock the ship and open the hypergate map (the
        // browser's flow); the sim must not choose a destination on its own.
        const { world } = await makeGateHarness(SYSTEM_A);
        world.step();

        let transit: GateTransit | undefined;
        world.events.get(GateTransitEvent).subscribe(({ data }) => {
            transit = data;
        });
        world.emit(LandEvent,
            { id: GATE_A_SPOB, uuid: `planet ${GATE_A_SPOB}` }, [SHIP_UUID]);
        world.step();
        world.step();
        expect(transit).toBeUndefined();
        expect(world.entities.has(SHIP_UUID)).toBeTrue();
    }, 30_000);

    it('transits immediately when landing on a wormhole', async () => {
        // Wormholes offer no choice: the sim removes the ship and carries it
        // on a GateTransitEvent. Ossory Rift is link-less, so the destination
        // is null (a random other wormhole, resolved by the browser from the
        // replicated draw).
        const { world } = await makeGateHarness(WORMHOLE_SYSTEM);
        world.step();

        let transit: GateTransit | undefined;
        world.events.get(GateTransitEvent).subscribe(({ data }) => {
            transit = data;
        });
        world.emit(LandEvent,
            { id: WORMHOLE_SPOB, uuid: `planet ${WORMHOLE_SPOB}` }, [SHIP_UUID]);
        stepUntil(world, () => transit !== undefined);

        expect(world.entities.has(SHIP_UUID)).toBeFalse();
        expect(transit!.uuid).toEqual(SHIP_UUID);
        expect(transit!.fromSpob).toEqual(WORMHOLE_SPOB);
        expect(transit!.destinationSpob).toBeNull();

        const arrival = transit!.entity.components.get(GateArrivalComponent)!;
        expect(arrival).toBeDefined();
        expect(arrival.destinationSpob).toBeNull();
        expect(arrival.randomDraw).toBeGreaterThanOrEqual(0);
        expect(arrival.randomDraw).toBeLessThan(1);
    }, 30_000);

    it('does not transit when landing on an ordinary planet', async () => {
        const { world } = await makeGateHarness(SYSTEM_A);
        world.step();

        let transit: GateTransit | undefined;
        world.events.get(GateTransitEvent).subscribe(({ data }) => {
            transit = data;
        });
        world.emit(LandEvent,
            { id: PLAIN_SPOB, uuid: `planet ${PLAIN_SPOB}` }, [SHIP_UUID]);
        world.step();
        world.step();
        expect(transit).toBeUndefined();
        expect(world.entities.has(SHIP_UUID)).toBeTrue();
    }, 30_000);

    it('arrives flying out of the destination gate with the jump-in sound',
        async () => {
        // The browser (hypergate map pick, or wormhole exit resolution) tags
        // the ship with a GateArrivalComponent and re-inserts it into the
        // destination system; the first tick there positions it flying out.
        const { gameData } = await makeGateHarness(SYSTEM_A);
        const destWorld = await makeSystem(SYSTEM_B, gameData);

        const ids = await gameData.ids;
        const shipData = await gameData.data.Ship.get([...ids.Ship].sort()[0]!);
        const ship = makeShip(shipData);
        ship.components.set(GateArrivalComponent, {
            destinationSpob: GATE_B_SPOB,
            emergenceAngle: null,
            randomDraw: 0.25,
        });
        await completeEntity(destWorld, ship);
        destWorld.entities.set(SHIP_UUID, ship);

        const sounds: string[] = [];
        destWorld.events.get(PlayerSoundEvent).subscribe(({ data }) => {
            sounds.push(data.id);
        });
        destWorld.step();
        expect(ship.components.has(GateArrivalComponent)).toBeFalse();

        // Positioned at the emergence distance from the gate (it may have
        // coasted outward for a tick before we observe it)...
        const gatePlanet = destWorld.entities.get(`planet ${GATE_B_SPOB}`)!;
        const gatePos = gatePlanet.components.get(MovementStateComponent)!.position;
        const movement = ship.components.get(MovementStateComponent)!;
        const offset = movement.position.subtract(gatePos);
        const physics = ship.components.get(ShipPhysicsComponent)!;
        const speed = getShipMovementPhysics(physics).maxVelocity;
        expect(offset.length).toBeGreaterThanOrEqual(GATE_EMERGENCE_DISTANCE - 1e-6);
        expect(offset.length).toBeLessThan(GATE_EMERGENCE_DISTANCE + speed * 0.05);

        // ...flying outward at the ship's regular top speed, facing out...
        expect(movement.velocity.length).toBeCloseTo(speed, 3);
        // Velocity is along the emergence offset (outward, not inward).
        expect(movement.velocity.dot(offset)).toBeGreaterThan(0);
        expect(movement.rotation.angle)
            .toBeCloseTo(movement.velocity.angle.angle, 6);

        // ...with the "jump in" sound (snd 130 Warp out) for the pilot.
        expect(sounds).toContain(WARP_OUT_SOUND);

        // The destination gate's own emergence angle (Vael Gate's CustSndID
        // 270°) decides the direction: 270° in clock-angle radians.
        const expected = 270 * Math.PI / 180;
        const angleOff = Math.abs(movement.rotation.angle - (
            expected >= Math.PI ? expected - 2 * Math.PI : expected));
        expect(angleOff).toBeLessThan(1e-6);
    }, 30_000);

    // Stays on REAL data: the transitivity rule needs a hypergate NETWORK
    // (a leaf gate four lanes from another), which a single linked pair
    // cannot supply.
    it('carries the ship to a NON-ADJACENT gate under hypergate transitivity',
        async () => {
        // HG-V0a (nova:1402, Vellos) has exactly ONE HyperLink — HG-V02 — so
        // in the original game HG-Moash (nova:1416, Moash nova:366) is simply
        // not on offer. With the server's hypergateTransitivity on, the gate
        // map offers it (same network, four lanes away) and the transit is a
        // single hop: the ship arrives at HG-Moash exactly the way an
        // adjacent transit arrives, because nothing in the sim knows or cares
        // how far the named destination was.
        const gameData = await getIntegrationGameData();
        const leafGate = await gameData.data.Planet.get(LEAF_GATE_SPOB);
        expect(leafGate.gate!.destinations).toEqual([LEAF_GATE_LINK]);
        expect(leafGate.gate!.destinations).not.toContain(FAR_GATE_SPOB);

        // Off: not offered at all. On: offered.
        const planets = await Promise.all(
            (await gameData.ids).Planet.map(id => gameData.data.Planet.get(id)));
        const links = new Map<string, string[]>();
        const unusable = new Set<string>();
        for (const planet of planets) {
            if (!landable(planet)) {
                unusable.add(planet.id);
            }
            if (planet.gate?.kind === 'hypergate') {
                links.set(planet.id, planet.gate.destinations);
            }
        }
        const network = { links, unusable };
        expect(gateMapDestinations(network, LEAF_GATE_SPOB, false))
            .not.toContain(FAR_GATE_SPOB);
        expect(gateMapDestinations(network, LEAF_GATE_SPOB, true))
            .toContain(FAR_GATE_SPOB);

        // The far gate resolves to the right system...
        const resolver = new GateDestinationResolver(gameData);
        const farSystem = await resolver.systemOf(FAR_GATE_SPOB);
        expect(FAR_GATE_SYSTEMS).toContain(farSystem!);

        // ...and arriving there puts the ship at that gate.
        const destWorld = await makeSystem(farSystem!, gameData);
        const ids = await gameData.ids;
        const shipData = await gameData.data.Ship.get([...ids.Ship].sort()[0]!);
        const ship = makeShip(shipData);
        ship.components.set(GateArrivalComponent, {
            destinationSpob: FAR_GATE_SPOB,
            emergenceAngle: null,
            randomDraw: 0.5,
        });
        await completeEntity(destWorld, ship);
        destWorld.entities.set(SHIP_UUID, ship);
        destWorld.step();

        expect(ship.components.has(GateArrivalComponent)).toBeFalse();
        const gatePlanet = destWorld.entities.get(`planet ${FAR_GATE_SPOB}`)!;
        expect(gatePlanet).toBeDefined();
        const gatePos =
            gatePlanet.components.get(MovementStateComponent)!.position;
        const movement = ship.components.get(MovementStateComponent)!;
        const offset = movement.position.subtract(gatePos);
        const physics = ship.components.get(ShipPhysicsComponent)!;
        const speed = getShipMovementPhysics(physics).maxVelocity;
        expect(offset.length)
            .toBeGreaterThanOrEqual(GATE_EMERGENCE_DISTANCE - 1e-6);
        expect(offset.length)
            .toBeLessThan(GATE_EMERGENCE_DISTANCE + speed * 0.05);
        expect(movement.velocity.dot(offset)).toBeGreaterThan(0);
    }, 60_000);

    it('resolves a hypergate pair end-to-end (system and position)',
        async () => {
        const gameData = await getSyntheticGameData();
        const resolver = new GateDestinationResolver(gameData);

        // The destination spöb resolves to the system that contains it.
        // (On stock data this had to admit the NCB-stacked duplicate
        // systems; the scenario has exactly one system per gate.)
        expect(await resolver.systemOf(GATE_B_SPOB)).toEqual(SYSTEM_B);

        // And the reverse link resolves back to system A.
        expect(await resolver.systemOf(GATE_A_SPOB)).toEqual(SYSTEM_A);
    }, 30_000);
});

describe('escorts following a gate', () => {
    it('carries the flock through a hypergate on the land event',
        async () => {
            const { world, addEscort } = await makeGateHarness(SYSTEM_A);
            await addEscort('escort a');
            await addEscort('escort b');
            // MarkPlayerEscortsSystem stamps ownership from the live chain.
            world.step();
            expect(world.entities.get('escort a')!.components
                .get(PlayerEscortComponent)?.player).toEqual(SHIP_UUID);

            const landed: EscortLanded[] = [];
            world.events.get(EscortLandedEvent).subscribe(
                ({ data }) => landed.push(data));
            world.emit(LandEvent,
                { id: GATE_A_SPOB, uuid: `planet ${GATE_A_SPOB}` },
                [SHIP_UUID]);
            world.step();

            expect(landed.map(({ uuid }) => uuid))
                .toEqual(['escort a', 'escort b']);
            expect(world.entities.has('escort a')).toBeFalse();
            expect(world.entities.has('escort b')).toBeFalse();
            // The hypergate flow docks the PLAYER a frame later (the browser
            // removes it and opens the map); the sim leaves it in place.
            expect(world.entities.has(SHIP_UUID)).toBeTrue();
        }, 30_000);

    it('hands the flock over before the wormhole carries the player away',
        async () => {
            // The ordering guarantee: EscortFollowGateSystem is ordered
            // before GateDepartureSystem, so the client has collected the
            // batch by the time it follows the transit and tears the origin
            // system down.
            const { world, addEscort } = await makeGateHarness(WORMHOLE_SYSTEM);
            await addEscort('escort a');
            world.step();

            const order: string[] = [];
            world.events.get(EscortLandedEvent).subscribe(
                ({ data }) => order.push(`escort ${data.uuid}`));
            world.events.get(GateTransitEvent).subscribe(
                () => order.push('player transit'));
            world.emit(LandEvent,
                { id: WORMHOLE_SPOB, uuid: `planet ${WORMHOLE_SPOB}` },
                [SHIP_UUID]);
            stepUntil(world, () => order.includes('player transit'));

            expect(order).toEqual(['escort escort a', 'player transit']);
            expect(world.entities.has('escort a')).toBeFalse();
            expect(world.entities.has(SHIP_UUID)).toBeFalse();
        }, 30_000);

    it('leaves the flock alone at an ordinary planet', async () => {
        const { world, addEscort } = await makeGateHarness(SYSTEM_A);
        await addEscort('escort a');
        world.step();

        const landed: EscortLanded[] = [];
        world.events.get(EscortLandedEvent).subscribe(
            ({ data }) => landed.push(data));
        // An ordinary planet that is NOT in this system (Port Amberline,
        // nova:128, in Thessaly Reach — the shape the stock version had
        // with Earth): the gate path has nothing to do with the landing,
        // and the escort-landing rule for a planet in the SAME system
        // (which would land the flock with the player, and rightly so)
        // is not what this spec is about.
        const elsewhere = SYNTHETIC.planets.port;
        world.emit(LandEvent, { id: elsewhere, uuid: `planet ${elsewhere}` },
            [SHIP_UUID]);
        world.step();

        expect(landed.length).toEqual(0);
        expect(world.entities.has('escort a')).toBeTrue();
    }, 30_000);
});

describe('GateDestinationResolver random wormhole', () => {
    it('picks a link-less wormhole exit deterministically from a draw',
        async () => {
        const gameData = await getSyntheticGameData();
        const resolver = new GateDestinationResolver(gameData);
        // A random wormhole exit is another link-less wormhole, chosen by
        // the seeded draw. Ossory Rift is link-less (destinations empty),
        // and so is its twin in Vael Hollow.
        const exit0 = await resolver.randomWormholeExit(WORMHOLE_SPOB, 0);
        const exitSame = await resolver.randomWormholeExit(WORMHOLE_SPOB, 0);
        expect(exit0).toBeDefined();
        // Same draw => same exit (deterministic).
        expect(exit0).toEqual(exitSame);
        // Never returns the departure wormhole itself.
        expect(exit0).not.toEqual(WORMHOLE_SPOB);
        expect(exit0).toEqual(WORMHOLE_TWIN);
        // The chosen exit is itself a resolvable wormhole in some system.
        const exitSystem = await resolver.systemOf(exit0!);
        expect(exitSystem).toEqual(SYSTEM_B);
    }, 30_000);
});
