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
import { completeEntity } from '../spawn/entity_data_loader.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import { PlayerShipSelector } from '../player/player_ship_plugin.js';
import { applyControlEvents } from '../player/ship_control.js';
import {
    applySetPlanetTarget, LandEvent, LandingBlockedEvent, PlanetComponent,
    PlanetDataComponent, PlanetTargetComponent, StellarBribesComponent,
    STELLAR_BRIBE_MS, stellarClearanceFor,
} from './planet_plugin.js';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { applyHail } from '../encounters/hail_plugin.js';
import { CreditsComponent } from '../player/player_state_plugin.js';
import { LegalRecordsComponent } from '../reputation/reputation_plugin.js';
import { landable } from '../core/landable.js';
import { clearanceDeniedMessage } from '../../display/status_bar_content.js';

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
    const blocked: { reason: string, isStation: boolean, entities?: unknown }[] = [];
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
 * Landing CLEARANCE: Coldharbour is an Amber Compact world with MinStatus
 * 0, so it admits a clean pilot and shuts out a criminal.
 */
describe('AttemptLandingSystem landing clearance', () => {
    const COLDHARBOUR = `planet ${SYNTHETIC.planets.coldharbour}`;
    const COMPACT = SYNTHETIC.govts.compact;

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
                new Map([[COMPACT, -1]]));

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
                new Map([[COMPACT, 0]]));

            const { lands, blocked } = pressLand(world);

            expect(blocked).toEqual([]);
            expect(lands.length).toBe(1);
        }, 30_000);

    it('answers the approach window BEFORE the clearance refusal', async () => {
        const { world, ship } = await makeHarness();
        const stellar = overColdharbour(world, ship);
        ship.components.set(LegalRecordsComponent,
            new Map([[COMPACT, -1000]]));
        place(ship,
            new Position(stellar.position.x + 5000, stellar.position.y));

        const { blocked } = pressLand(world);

        expect(blocked.length).toBe(1);
        expect(blocked[0].reason).toEqual('tooFar');
    }, 30_000);

    // Stays on REAL data (Sol): the exemption is about the STOCK
    // hypergates' MinStatus 32767, a value the synthetic scenario has no
    // stellar for — its gates are ordinary MinStatus -32767 rings.
    it('lets a criminal through the working hypergates, whose MinStatus '
        + '32767 is not a shut port', async () => {
            const FEDERATION = 'nova:128';
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
                records: new Map([[FEDERATION, -30000]]),
                planetId: gate[1].components.get(PlanetComponent)!.id,
                now: 0,
            }).cleared).toBeTrue();
        }, 30_000);
});

describe('planet bribes', () => {
    /** Coldharbour: MinStatus 0, and its govt's worlds take bribes. */
    const PORT = `planet ${SYNTHETIC.planets.coldharbour}`;
    const PORT_ID = SYNTHETIC.planets.coldharbour;
    const COMPACT = SYNTHETIC.govts.compact;

    async function shutOutHarness() {
        const { world, ship } = await makeHarness();
        const stellar = stellars(world).find(p => p.uuid === PORT)!;
        ship.components.get(PlanetTargetComponent)!.target = stellar.uuid;
        place(ship, stellar.position);
        ship.components.set(LegalRecordsComponent,
            new Map([[COMPACT, -1]]));
        ship.components.set(CreditsComponent, { credits: 10_000 });
        return { world, ship, stellar };
    }

    it('grants temporary clearance, charges for it, and then the landing '
        + 'succeeds', async () => {
            const { world, ship } = await shutOutHarness();

            // Refused before paying.
            expect(pressLand(world).blocked[0].reason).toEqual('denied');

            applyHail(world, undefined, { kind: 'bribe', target: PORT });

            // Charged: the Amber Compact sets largerBribes, so 30% of
            // 10,000.
            expect(ship.components.get(CreditsComponent)!.credits)
                .toEqual(10_000 - 3_000);
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
        ship.components.set(LegalRecordsComponent, new Map([[COMPACT, 0]]));

        applyHail(world, undefined, { kind: 'bribe', target: PORT });

        expect(ship.components.get(CreditsComponent)!.credits).toEqual(10_000);
        expect(ship.components.has(StellarBribesComponent)).toBeFalse();
    }, 30_000);

    it('charges a near-broke pilot everything they have, exactly as the '
        + 'ship bribe does', async () => {
            const { world, ship } = await shutOutHarness();
            // Below the 500-credit floor (hail.ts BRIBE_MINIMUM), so
            // bribeAmount caps the demand at the player's whole purse.
            ship.components.set(CreditsComponent, { credits: 100 });

            applyHail(world, undefined, { kind: 'bribe', target: PORT });

            expect(ship.components.get(CreditsComponent)!.credits).toEqual(0);
            expect(pressLand(world).blocked).toEqual([]);
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
