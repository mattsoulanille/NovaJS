import 'jasmine';
import { getDefaultDudeData } from 'novadatainterface/dude_data';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultPlanetData, PlanetData } from 'novadatainterface/planet_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { WeaponDamage } from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { isIffHostile } from '../combat/index.js';
import { SimulationGameDataResource, SystemIdResource } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import {
    decodeSave, encodeSave, extractSaveData, restorePlayerState,
} from '../pilot/index.js';
import { NpcComponent, SystemHoldComponent } from '../npc/index.js';
import {
    alwaysDominatedStellars, ControlledByComponent, CreditsComponent,
    DominatedComponent, PendingStellarSetStringsComponent,
    PlayerEscortComponent,
} from '../player/index.js';
import {
    restoreWorld, snapshotWorld, SnapshotPoliciesResource,
} from 'nova_ecs/plugins/snapshot_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import {
    applySimulationInputs, SimulationInput, SimulationInputType,
} from '../../communication/simulation_input.js';
import { deriveEntityComponents } from '../core/index.js';
import { ControlBitsComponent } from '../ncb/index.js';
import { StellarSetString } from './tribute.js';
import {
    CombatRatingComponent, LegalRecordsComponent,
} from '../reputation/index.js';
import {
    ArmorComponent, DamagedEvent, DisabledComponent, ExplodingComponent,
    FiringGroupComponent, makeShip, SourceComponent, StellarDefenderComponent,
    TargetComponent,
} from '../ship/index.js';
import {
    completeEntity, DEFENSE_FIRST_LAUNCH_MS, DEFENSE_LAUNCH_INTERVAL_MS,
    leastDefended, StellarDominatedEvent, StellarDominatedEventData,
} from '../spawn/index.js';
import {
    DefenseFleetComponent, DEFENSE_WAVE_CAP_MAX, defenseWaveCap,
} from '../travel/index.js';
import { applyHail } from './hail_plugin.js';
import {
    dailyTribute, TRIBUTE_ACCEPTED_PLANET_FALLBACK,
    TRIBUTE_ACCEPTED_STATION_FALLBACK, TRIBUTE_COMBAT_RATING,
    TRIBUTE_DEMAND_KILLS, TRIBUTE_LAUGH_KILLS, tributeDemandOutcome,
    tributeReleasedText, tributeResponseText,
} from './tribute.js';

/**
 * ============================================================================
 * Demand Tribute, the defence fleet and domination (#353 sections 1 and 3)
 * ============================================================================
 *
 * Reference "Tribute (R18), wave 39" (with wave 38's edge), and Matthew's
 * ruling on #353 where it differs (see tribute.ts): a demand below 12,800
 * is laughed off; from 12,800 a stellar with a fleet sends it and one
 * without gives in; every answered demand costs six kills' record (-600
 * under the KillPenalty 100 here), a laugh one kill's, spread like a kill
 * ("Tribute leftovers (R18), wave 40"); the
 * fleet is shared, capped at 6 up per demander (18 at most), respawns as
 * ships die, resets when its demanders leave, and its defeat dominates
 * every demander; a dominated stellar can be released.
 */

const SYSTEM = 'test:system';
const NEIGHBOUR = 'test:neighbour';
/** Two jumps out, owned by NEUTRAL (the wave-40 rig's Kit Spread chain). */
const FAR = 'test:far';
const OWNER = 'test:owner';
const NEUTRAL = 'test:neutral';
const FORT = 'test:fort';
const OPEN = 'test:open';
const STATION = 'test:station';
const DUDE = 'test:defenders';
const DEFENDER_HULL = 'test:defender';
const PLAYER_HULL = 'test:lancer';
const FORT_UUID = `planet ${FORT}`;
const OPEN_UUID = `planet ${OPEN}`;
const STATION_UUID = `planet ${STATION}`;

const PEER_A = 'peer a';
const PEER_B = 'peer b';

/** A hit that takes the whole armor of a defender (3,000). */
const KILL: WeaponDamage = {
    shield: 100_000, armor: 100_000, ionization: 0, ionizationColor: 0xffffff,
    passThroughShield: 0, knockback: 0,
};

function planet(id: string, more: Partial<PlanetData> = {}): PlanetData {
    return {
        ...getDefaultPlanetData(), id, name: id, govt: OWNER, techLevel: 3,
        ...more,
    };
}

async function build(count = 8,
    strings: { onDominate: string, onRelease: string }
        = { onDominate: '', onRelease: '' }) {
    const gameData = new MockGameData();
    // The wave-39/40 rig's gövt 290 Kit Tribute Govt (Kill 100, Disab 50),
    // and a govt with no relation to it for the neutral systems.
    gameData.data.Govt.map.set(OWNER, {
        ...getDefaultGovtData(), id: OWNER, killPenalty: 100,
        disablePenalty: 50,
    });
    gameData.data.Govt.map.set(NEUTRAL, {
        ...getDefaultGovtData(), id: NEUTRAL, killPenalty: 100,
        disablePenalty: 50,
    });
    const hull = getDefaultShipData();
    gameData.data.Ship.map.set(DEFENDER_HULL, {
        ...hull, id: DEFENDER_HULL, strength: 500,
        physics: { ...hull.physics, shield: 1000, armor: 3000, speed: 300 },
    });
    gameData.data.Ship.map.set(PLAYER_HULL, {
        ...hull, id: PLAYER_HULL, strength: 100,
    });
    gameData.data.Dude.map.set(DUDE, {
        ...getDefaultDudeData(), id: DUDE, aiType: 3, govt: OWNER,
        ships: [{ id: DEFENDER_HULL, weight: 100 }],
    });
    gameData.data.Planet.map.set(FORT, planet(FORT, {
        position: [500, 0], defense: { dude: DUDE, count, waveSize: null },
        domination: {
            tribute: 1234, alwaysDominated: false, ...strings,
        },
    }));
    // No fleet: gives in at once. Tribute 0 decoded to 1,000 x TL 3.
    gameData.data.Planet.map.set(OPEN, planet(OPEN, {
        position: [-500, 0],
        domination: {
            tribute: 3000, alwaysDominated: false, ...strings,
        },
    }));
    gameData.data.Planet.map.set(STATION, planet(STATION, {
        position: [0, 800],
        flags: { ...getDefaultPlanetData().flags, isStation: true },
    }));
    gameData.data.System.map.set(SYSTEM, {
        ...getDefaultSystemData(), id: SYSTEM, govt: OWNER,
        planets: [FORT, OPEN, STATION], links: [NEIGHBOUR],
    });
    gameData.data.System.map.set(NEIGHBOUR, {
        ...getDefaultSystemData(), id: NEIGHBOUR, govt: OWNER,
        position: [100, 0], links: [SYSTEM, FAR],
    });
    gameData.data.System.map.set(FAR, {
        ...getDefaultSystemData(), id: FAR, govt: NEUTRAL,
        position: [200, 0], links: [NEIGHBOUR],
    });
    const world = await makeSystem(SYSTEM, gameData, undefined,
        { npcs: false });
    const dominated: Array<{ data: StellarDominatedEventData, to: string[] }>
        = [];
    world.events.get(StellarDominatedEvent).subscribe(({ data, entities }) =>
        dominated.push({ data, to: (entities ?? []).map(String) }));

    async function addPlayer(uuid: string, peerId: string, rating: number,
        x = 0, y = 0) {
        const ship = makeShip(gameData.data.Ship.map.get(PLAYER_HULL)!);
        ship.components.set(ControlledByComponent, { peerId });
        ship.components.set(CreditsComponent, { credits: 100_000 });
        ship.components.set(CombatRatingComponent, { kills: rating });
        ship.components.set(LegalRecordsComponent, new Map());
        ship.components.set(ControlBitsComponent, new Set<number>());
        await completeEntity(world, ship);
        ship.components.set(MovementStateComponent, {
            accelerating: 0, position: new Position(x, y),
            rotation: new Angle(0), turnBack: false, turning: 0,
            velocity: new Vector(0, 0),
        });
        world.entities.set(uuid, ship);
        world.step();
        return ship;
    }
    return { world, gameData, addPlayer, dominated };
}

function now(world: World) {
    return world.resources.get(TimeResource)!.time;
}

function advance(world: World, ms: number) {
    const until = now(world) + ms;
    while (now(world) < until) {
        world.step();
    }
}

function fleet(world: World) {
    return world.entities.get(FORT_UUID)?.components.get(DefenseFleetComponent);
}

/** The live (not exploding) defenders of the fort, by uuid. */
function defenders(world: World): Array<[string, Entity]> {
    return [...world.entities].filter(([, entity]) =>
        entity.components.get(StellarDefenderComponent)?.planet === FORT_UUID
        && !entity.components.has(ExplodingComponent));
}

/** Removes `n` live defenders, as their death sequence would. */
function sink(world: World, n: number) {
    for (const [uuid] of defenders(world).slice(0, n)) {
        world.entities.delete(uuid);
    }
    world.step();
}

function record(world: World, uuid: string, system = SYSTEM) {
    return world.entities.get(uuid)!.components.get(LegalRecordsComponent)!
        .get(system) ?? 0;
}

function dominatedBy(world: World, uuid: string) {
    return world.entities.get(uuid)!.components.get(DominatedComponent) ?? [];
}

describe('tribute rules', () => {
    it('laughs below a combat rating of 12,800 exactly (MEASURED, wave 38: '
        + '12,799 refused, 12,800 not)', () => {
            expect(TRIBUTE_COMBAT_RATING).toBe(12_800);
            expect(tributeDemandOutcome(12_799, true)).toBe('laugh');
            expect(tributeDemandOutcome(12_799, false)).toBe('laugh');
            expect(tributeDemandOutcome(0, false)).toBe('laugh');
            expect(tributeDemandOutcome(12_800, true)).toBe('fleet');
            expect(tributeDemandOutcome(12_800, false)).toBe('dominate');
            expect(tributeDemandOutcome(25_600, false)).toBe('dominate');
        });

    it('answers from STR# 3002: the laugh 5-9, the fleet 10-14, giving in '
        + '25 (planet) / 26 (station), the release 35 / 36', () => {
            const strings = Array.from({ length: 50 }, (_, i) => `line ${i}`);
            expect(tributeResponseText(strings, 'laugh', false, 2))
                .toBe('line 7');
            expect(tributeResponseText(strings, 'fleet', false, 4))
                .toBe('line 14');
            expect(tributeResponseText(strings, 'fleet', false, 5))
                .toBe('line 10');
            expect(tributeResponseText(strings, 'dominate', false))
                .toBe('line 25');
            expect(tributeResponseText(strings, 'dominate', true))
                .toBe('line 26');
            expect(tributeReleasedText(strings, false)).toBe('line 35');
            expect(tributeReleasedText(strings, true)).toBe('line 36');
            // The stock lines, verbatim, when the table is not to hand.
            expect(tributeResponseText(undefined, 'dominate', false))
                .toBe(TRIBUTE_ACCEPTED_PLANET_FALLBACK);
            expect(tributeResponseText(undefined, 'dominate', true))
                .toBe(TRIBUTE_ACCEPTED_STATION_FALLBACK);
        });

    it('caps the defenders up at 6 per demanding player, 18 at most '
        + '(Matthew\'s ruling on #353)', () => {
            expect([0, 1, 2, 3, 4, 10].map(defenseWaveCap))
                .toEqual([0, 6, 12, 18, 18, 18]);
            expect(DEFENSE_WAVE_CAP_MAX).toBe(18);
        });

    it('assigns a new defender to the least-defended demander, the lower '
        + 'uuid on a tie', () => {
            expect(leastDefended(['a', 'b'], new Map())).toBe('a');
            expect(leastDefended(['a', 'b'], new Map([['a', 1]]))).toBe('b');
            expect(leastDefended(['a', 'b', 'c'],
                new Map([['a', 2], ['b', 1], ['c', 1]]))).toBe('b');
        });

    it('sums the dominated stellars\' decoded Tribute per day (MEASURED, '
        + 'wave 39: 4,000 + 3,000 a day; 1,234 a day)', () => {
            const planets = new Map([
                ['s', { domination: { tribute: 4000 } }],
                ['f', { domination: { tribute: 3000 } }],
                ['p', { domination: { tribute: 1234 } }],
            ]);
            const get = (id: string) => planets.get(id) as never;
            expect(dailyTribute(['s', 'f'], get)).toBe(7000);
            expect(dailyTribute(['p'], get)).toBe(1234);
            expect(dailyTribute(['unknown'], get)).toBe(0);
            expect(dailyTribute(undefined, get)).toBe(0);
        });
});

describe('Demand Tribute in the sim', () => {
    it('laughs off a pilot below 12,800: nothing launches, nothing '
        + 'dominated, one kill\'s record (MEASURED, wave 39 tp6400 / wave 40 '
        + 'tp6400_a: -100, -65 a jump out)', async () => {
            const { world, addPlayer } = await build();
            await addPlayer('a', PEER_A, 12_799);
            applyHail(world, PEER_A, { kind: 'demandTribute', target: FORT_UUID });
            advance(world, 5_000);
            expect(fleet(world)).toBeUndefined();
            expect(defenders(world).length).toBe(0);
            expect(TRIBUTE_LAUGH_KILLS).toBe(1);
            expect(record(world, 'a')).toBe(-100);
            expect(record(world, 'a', NEIGHBOUR)).toBe(-65);
            expect(dominatedBy(world, 'a')).toEqual([]);
        });

    it('gives in at once where there is no fleet: dominated, six kills\' '
        + 'record spread like a kill, a neutral owner\'s system GAINING '
        + '(MEASURED, wave 40 tpspread_a / tf_a)', async () => {
            const { world, addPlayer } = await build();
            await addPlayer('a', PEER_A, 12_800);
            applyHail(world, PEER_A, { kind: 'demandTribute', target: OPEN_UUID });
            expect(dominatedBy(world, 'a')).toEqual([OPEN]);
            expect(TRIBUTE_DEMAND_KILLS).toBe(6);
            expect(record(world, 'a')).toBe(-600);
            // 6 x trunc(100 x 0.65): 390, not 4 x (Kill + Disab) = 388.
            expect(record(world, 'a', NEIGHBOUR)).toBe(-390);
            // Two jumps out in a neutral govt's system: + half its own
            // scaled KillPenalty, per kill: 6 x trunc(42 / 2) = 126.
            expect(record(world, 'a', FAR)).toBe(126);
            // A second demand of a dominated stellar does nothing.
            applyHail(world, PEER_A, { kind: 'demandTribute', target: OPEN_UUID });
            expect(record(world, 'a')).toBe(-600);
        });

    it('sends its fleet from 12,800: -600, the stellar hostile, the first '
        + 'defender up 1.8 s later, never more than 6 up for one demander',
        async () => {
            const { world, addPlayer } = await build(8);
            await addPlayer('a', PEER_A, 12_800);
            applyHail(world, PEER_A, { kind: 'demandTribute', target: FORT_UUID });
            expect(record(world, 'a')).toBe(-600);
            expect(fleet(world)?.demanders).toEqual(['a']);
            advance(world, DEFENSE_FIRST_LAUNCH_MS - 100);
            expect(defenders(world).length).toBe(0);
            advance(world, 200 + 20 * DEFENSE_LAUNCH_INTERVAL_MS);
            expect(defenders(world).length).toBe(6);
            expect(fleet(world)?.launched).toBe(6);
            for (const [, ship] of defenders(world)) {
                expect(ship.components.get(StellarDefenderComponent)?.player)
                    .toBe('a');
                expect(ship.components.get(SystemHoldComponent)?.reason)
                    .toBe('defense');
            }
            // The stellar's IFF: every defender is hostile to the demander.
            const player = world.entities.get('a')!;
            const gameData = world.resources.get(SimulationGameDataResource)!;
            for (const [uuid, ship] of defenders(world)) {
                expect(isIffHostile(uuid, ship, 'a', player, gameData,
                    id => world.entities.get(id), now(world),
                    world.resources.get(SystemIdResource))).toBeTrue();
            }
            expect(dominatedBy(world, 'a')).toEqual([]);
        });

    it('launches a new defender as one dies, until the whole fleet has '
        + 'launched; the last one down dominates the stellar', async () => {
            const { world, addPlayer, dominated } = await build(8);
            await addPlayer('a', PEER_A, 12_800);
            applyHail(world, PEER_A, { kind: 'demandTribute', target: FORT_UUID });
            advance(world, DEFENSE_FIRST_LAUNCH_MS + 3_000);
            expect(defenders(world).length).toBe(6);
            sink(world, 1);
            advance(world, 1_000);
            expect(defenders(world).length).toBe(6);
            expect(fleet(world)?.launched).toBe(7);
            sink(world, 3);
            advance(world, 1_000);
            // Only one of the eight was left to launch.
            expect(defenders(world).length).toBe(4);
            expect(fleet(world)?.launched).toBe(8);
            sink(world, 3);
            advance(world, 1_000);
            expect(dominatedBy(world, 'a')).toEqual([]);
            sink(world, 1);
            expect(dominatedBy(world, 'a')).toEqual([FORT]);
            expect(dominated).toEqual([{
                data: { planet: FORT, station: false }, to: ['a'],
            }]);
            // One answered demand: one -600 (the ruling's domination at the
            // defeat needs no second demand).
            expect(record(world, 'a')).toBe(-600);
            advance(world, 1_000);
            expect(fleet(world)).toBeUndefined();
        });

    it('stands the fleet down when its demander jumps away: no more '
        + 'launches, the ships fly home and land, and a fresh demand faces '
        + 'the whole fleet', async () => {
            const { world, addPlayer } = await build(8);
            const a = await addPlayer('a', PEER_A, 12_800);
            applyHail(world, PEER_A, { kind: 'demandTribute', target: FORT_UUID });
            advance(world, DEFENSE_FIRST_LAUNCH_MS + 3_000);
            sink(world, 2);
            advance(world, 1_000);
            expect(fleet(world)?.launched).toBe(8);
            // Jumped out: gone from this world.
            world.entities.delete('a');
            advance(world, 500);
            expect(fleet(world)?.demanders).toEqual([]);
            expect(fleet(world)?.launched).toBe(6);
            for (const [, ship] of defenders(world)) {
                expect(ship.components.get(StellarDefenderComponent)?.player)
                    .toBeUndefined();
            }
            advance(world, 60_000);
            expect(defenders(world).length).toBe(0);
            expect(fleet(world)).toBeUndefined();
            // Back again: the count starts over.
            world.entities.set('a', a);
            world.step();
            applyHail(world, PEER_A, { kind: 'demandTribute', target: FORT_UUID });
            advance(world, DEFENSE_FIRST_LAUNCH_MS + 3_000);
            expect(defenders(world).length).toBe(6);
            expect(fleet(world)?.launched).toBe(6);
            expect(record(world, 'a')).toBe(-1200);
        });

    it('shares ONE fleet between demanders: 6 more up per demander, an '
        + 'equal share each, and its defeat dominates them all',
        async () => {
            const { world, addPlayer, dominated } = await build(20);
            await addPlayer('a', PEER_A, 12_800, 0, 0);
            await addPlayer('b', PEER_B, 20_000, 0, 300);
            applyHail(world, PEER_A, { kind: 'demandTribute', target: FORT_UUID });
            applyHail(world, PEER_B, { kind: 'demandTribute', target: FORT_UUID });
            expect(fleet(world)?.demanders).toEqual(['a', 'b']);
            advance(world, DEFENSE_FIRST_LAUNCH_MS + 6_000);
            expect(defenders(world).length).toBe(12);
            const share = (player: string) => defenders(world).filter(([, s]) =>
                s.components.get(StellarDefenderComponent)?.player === player)
                .length;
            expect(share('a')).toBe(6);
            expect(share('b')).toBe(6);
            // Every defender is hostile to both demanders.
            const gameData = world.resources.get(SimulationGameDataResource)!;
            for (const player of ['a', 'b']) {
                for (const [uuid, ship] of defenders(world)) {
                    expect(isIffHostile(uuid, ship, player,
                        world.entities.get(player)!, gameData,
                        id => world.entities.get(id), now(world),
                        world.resources.get(SystemIdResource))).toBeTrue();
                }
            }
            while (fleet(world)?.demanders.length) {
                sink(world, 12);
                advance(world, 6_000);
            }
            expect(dominatedBy(world, 'a')).toEqual([FORT]);
            expect(dominatedBy(world, 'b')).toEqual([FORT]);
            expect(dominated.map(({ to }) => to)).toEqual([['a'], ['b']]);
        });

    it('leaves a bystander alone: not a target, not IFF-hostile, while the '
        + 'demander is attacked', async () => {
            const { world, addPlayer } = await build(8);
            await addPlayer('a', PEER_A, 12_800, 0, 0);
            const bystander = await addPlayer('c', 'peer c', 0, 520, 0);
            applyHail(world, PEER_A, { kind: 'demandTribute', target: FORT_UUID });
            advance(world, DEFENSE_FIRST_LAUNCH_MS + 4_000);
            const gameData = world.resources.get(SimulationGameDataResource)!;
            for (const [uuid, ship] of defenders(world)) {
                expect(ship.components.get(TargetComponent)?.target).toBe('a');
                expect(ship.components.get(NpcComponent)?.mode).toBe('attack');
                expect(isIffHostile(uuid, ship, 'c', bystander, gameData,
                    id => world.entities.get(id), now(world),
                    world.resources.get(SystemIdResource))).toBeFalse();
            }
        });

    it('goes after the demander\'s escort as his side, and after whoever '
        + 'provokes it', async () => {
            const { world, gameData, addPlayer } = await build(1);
            await addPlayer('a', PEER_A, 12_800, -3000, 0);
            const escort = makeShip(gameData.data.Ship.map.get(PLAYER_HULL)!);
            escort.components.set(PlayerEscortComponent,
                { player: 'a', parent: 'a', provenance: 'hired' } as never);
            await completeEntity(world, escort);
            escort.components.set(MovementStateComponent, {
                accelerating: 0, position: new Position(600, 0),
                rotation: new Angle(0), turnBack: false, turning: 0,
                velocity: new Vector(0, 0),
            });
            world.entities.set('escort', escort);
            applyHail(world, PEER_A, { kind: 'demandTribute', target: FORT_UUID });
            advance(world, DEFENSE_FIRST_LAUNCH_MS + 2_000);
            const [[uuid, ship]] = defenders(world);
            // The escort is nearer than its player: the demander's side.
            expect(ship.components.get(TargetComponent)?.target)
                .toBe('escort');
            // A bystander who shoots it provokes it.
            await addPlayer('c', 'peer c', 0, 400, 400);
            hit(world, uuid, 'c', { ...KILL, shield: 10, armor: 0 });
            advance(world, 2_000);
            expect(ship.components.get(TargetComponent)?.target).toBe('c');
        });

    it('is never disabled, and its kill costs no record and adds no combat '
        + 'rating (MEASURED, wave 39, finding 7)', async () => {
            const { world, addPlayer } = await build(2);
            await addPlayer('a', PEER_A, 12_800);
            applyHail(world, PEER_A, { kind: 'demandTribute', target: FORT_UUID });
            advance(world, DEFENSE_FIRST_LAUNCH_MS + 2_000);
            const [[first, ship], [second]] = defenders(world);
            // Down to a sliver of armor: far under any disable threshold.
            hit(world, first, 'a', { ...KILL, armor: 2_990 });
            expect(ship.components.get(ArmorComponent)!.current)
                .toBeLessThan(100);
            expect(ship.components.has(DisabledComponent)).toBeFalse();
            hit(world, second, 'a');
            expect(world.entities.get(second)?.components
                .has(ExplodingComponent) ?? true).toBeTrue();
            const a = world.entities.get('a')!;
            expect(a.components.get(CombatRatingComponent)!.kills)
                .toBe(12_800);
            expect(record(world, 'a')).toBe(-600);
        });

    it('launches the same fleet, in the same places, in two worlds fed the '
        + 'same demand (seeded Random and the IdFactory only)', async () => {
            const run = async () => {
                const { world, addPlayer } = await build(10);
                await addPlayer('a', PEER_A, 12_800);
                applyHail(world, PEER_A,
                    { kind: 'demandTribute', target: FORT_UUID });
                advance(world, DEFENSE_FIRST_LAUNCH_MS + 3_000);
                sink(world, 2);
                advance(world, 2_000);
                return defenders(world).map(([uuid, ship]) => {
                    const movement = ship.components
                        .get(MovementStateComponent)!;
                    return [uuid, movement.position.x, movement.position.y,
                        ship.components.get(TargetComponent)?.target];
                });
            };
            const first = await run();
            expect(first.length).toBe(6);
            expect(await run()).toEqual(first);
        });

    it('releases a dominated stellar (and only then)', async () => {
        const { world, addPlayer } = await build();
        await addPlayer('a', PEER_A, 12_800);
        applyHail(world, PEER_A, { kind: 'releaseTribute', target: OPEN_UUID });
        expect(dominatedBy(world, 'a')).toEqual([]);
        applyHail(world, PEER_A, { kind: 'demandTribute', target: OPEN_UUID });
        applyHail(world, PEER_A, { kind: 'demandTribute',
            target: STATION_UUID });
        expect(dominatedBy(world, 'a')).toEqual([OPEN, STATION].sort());
        applyHail(world, PEER_A, { kind: 'releaseTribute', target: OPEN_UUID });
        expect(dominatedBy(world, 'a')).toEqual([STATION]);
        // The release changes nothing else.
        expect(record(world, 'a')).toBe(-1200);
    });
});

/**
 * spöb OnDominate / OnRelease: owed the pilot the tick the domination
 * changes (player/dominated.ts PendingStellarSetStringsComponent) and paid
 * by the owner's `stellarSetString` record (tribute.ts
 * applyStellarSetString). Stock Earth's OnDominate is `b6100`. The client's
 * half (buildStellarSetString) is driven end to end in
 * communication/stellar_set_string_rollback_test.ts.
 */
describe('a stellar\'s OnDominate / OnRelease', () => {
    const STRINGS = { onDominate: 'b6100', onRelease: '!b6100 b6101' };

    function owed(world: World, uuid: string) {
        return world.entities.get(uuid)!.components
            .get(PendingStellarSetStringsComponent)?.pending ?? [];
    }

    function bits(world: World, uuid: string) {
        return [...world.entities.get(uuid)!.components
            .get(ControlBitsComponent) ?? []].sort();
    }

    /** The record, through the wire codec and the input apply. */
    function pay(world: World, peerId: string, record: StellarSetString) {
        const input: SimulationInput = { kind: 'stellarSetString', record };
        expect(SimulationInputType.is(input)).toBeTrue();
        applySimulationInputs(world, [input], peerId);
        world.step();
    }

    it('owes OnDominate when a demand is given in to, and the owner\'s '
        + 'record pays it on HIS ship only, once', async () => {
            const { world, addPlayer } = await build(8, STRINGS);
            await addPlayer('a', PEER_A, 12_800);
            await addPlayer('b', PEER_B, 12_800, 0, 300);
            applyHail(world, PEER_A,
                { kind: 'demandTribute', target: OPEN_UUID });
            expect(owed(world, 'a')).toEqual(
                [{ seq: 0, planetId: OPEN, kind: 'dominate' }]);
            expect(owed(world, 'b')).toEqual([]);
            // Another peer cannot pay A's debt, nor set bits through it.
            pay(world, PEER_B, { seq: 0, planetId: OPEN, bitsSet: [6100] });
            expect(bits(world, 'b')).toEqual([]);
            expect(owed(world, 'a').length).toBe(1);
            // A wrong stellar or seq pays nothing.
            pay(world, PEER_A, { seq: 0, planetId: FORT, bitsSet: [1] });
            pay(world, PEER_A, { seq: 1, planetId: OPEN, bitsSet: [2] });
            expect(bits(world, 'a')).toEqual([]);
            pay(world, PEER_A, { seq: 0, planetId: OPEN, bitsSet: [6100] });
            expect(bits(world, 'a')).toEqual([6100]);
            expect(bits(world, 'b')).toEqual([]);
            expect(owed(world, 'a')).toEqual([]);
            // A duplicate finds the debt paid.
            pay(world, PEER_A, { seq: 0, planetId: OPEN, bitsSet: [3] });
            expect(bits(world, 'a')).toEqual([6100]);
        });

    it('owes nothing for a blank string', async () => {
        const { world, addPlayer } = await build();
        await addPlayer('a', PEER_A, 12_800);
        applyHail(world, PEER_A,
            { kind: 'demandTribute', target: OPEN_UUID });
        applyHail(world, PEER_A,
            { kind: 'releaseTribute', target: OPEN_UUID });
        expect(world.entities.get('a')!.components
            .has(PendingStellarSetStringsComponent)).toBeFalse();
    });

    it('owes every demander OnDominate at the defence fleet\'s defeat',
        async () => {
            const { world, addPlayer } = await build(2, STRINGS);
            await addPlayer('a', PEER_A, 12_800);
            await addPlayer('b', PEER_B, 12_800, 0, 300);
            applyHail(world, PEER_A,
                { kind: 'demandTribute', target: FORT_UUID });
            applyHail(world, PEER_B,
                { kind: 'demandTribute', target: FORT_UUID });
            advance(world, DEFENSE_FIRST_LAUNCH_MS + 3_000);
            sink(world, 2);
            expect(dominatedBy(world, 'a')).toEqual([FORT]);
            expect(owed(world, 'a')).toEqual(
                [{ seq: 0, planetId: FORT, kind: 'dominate' }]);
            expect(owed(world, 'b')).toEqual(
                [{ seq: 0, planetId: FORT, kind: 'dominate' }]);
            pay(world, PEER_B, { seq: 0, planetId: FORT, bitsSet: [6100] });
            expect(bits(world, 'b')).toEqual([6100]);
            expect(bits(world, 'a')).toEqual([]);
            expect(owed(world, 'a').length).toBe(1);
        });

    it('owes OnRelease at a Release, after OnDominate, in order',
        async () => {
            const { world, addPlayer } = await build(8, STRINGS);
            await addPlayer('a', PEER_A, 12_800);
            applyHail(world, PEER_A,
                { kind: 'demandTribute', target: OPEN_UUID });
            applyHail(world, PEER_A,
                { kind: 'releaseTribute', target: OPEN_UUID });
            applyHail(world, PEER_A,
                { kind: 'demandTribute', target: OPEN_UUID });
            expect(owed(world, 'a')).toEqual([
                { seq: 0, planetId: OPEN, kind: 'dominate' },
                { seq: 1, planetId: OPEN, kind: 'release' },
                { seq: 2, planetId: OPEN, kind: 'dominate' },
            ]);
            pay(world, PEER_A, { seq: 0, planetId: OPEN, bitsSet: [6100] });
            pay(world, PEER_A, { seq: 1, planetId: OPEN, bitsSet: [6101],
                bitsCleared: [6100] });
            expect(bits(world, 'a')).toEqual([6101]);
            expect(owed(world, 'a')).toEqual(
                [{ seq: 2, planetId: OPEN, kind: 'dominate' }]);
        });

    it('replays the debt and its payment identically after a rollback',
        async () => {
            const { world, addPlayer } = await build(8, STRINGS);
            await addPlayer('a', PEER_A, 12_800);
            await addPlayer('b', PEER_B, 12_800, 0, 300);
            const before = snapshotWorld(world);
            const run = () => {
                const input: SimulationInput = {
                    kind: 'hail',
                    action: { kind: 'demandTribute', target: OPEN_UUID },
                };
                applySimulationInputs(world, [input], PEER_A);
                world.step();
                pay(world, PEER_A, { seq: 0, planetId: OPEN,
                    bitsSet: [6100] });
                const hashes = [hashWorld(world).hash];
                for (let i = 0; i < 20; i++) {
                    world.step();
                    hashes.push(hashWorld(world).hash);
                }
                return hashes;
            };
            const first = run();
            expect(bits(world, 'a')).toEqual([6100]);
            restoreWorld(world, before, deriveEntityComponents);
            expect(bits(world, 'a')).toEqual([]);
            expect(owed(world, 'a')).toEqual([]);
            expect(run()).toEqual(first);
            const policies = world.resources.get(SnapshotPoliciesResource)!;
            expect([...policies.unhandled]).toEqual([]);
        });
});

describe('an always-dominated stellar (spöb Flags2 0x0020)', () => {
    it('is dominated by a new pilot from the start (GUESS)', () => {
        const stellar = (id: string, alwaysDominated: boolean) => ({
            id, domination: { alwaysDominated },
        });
        expect(alwaysDominatedStellars([stellar('p:3', true),
            stellar('p:1', false), stellar('p:2', true)]))
            .toEqual(['p:2', 'p:3']);
        expect(alwaysDominatedStellars([])).toEqual([]);
    });
});

describe('a domination in the pilot save', () => {
    it('is saved, survives a decode, and restores (none: no field, no '
        + 'component)', async () => {
            const { world, addPlayer } = await build();
            await addPlayer('a', PEER_A, 12_800);
            applyHail(world, PEER_A, { kind: 'demandTribute',
                target: STATION_UUID });
            applyHail(world, PEER_A, { kind: 'demandTribute',
                target: OPEN_UUID });
            const player = world.entities.get('a')!;
            const save = extractSaveData(player, SYSTEM)!;
            expect(save.dominated).toEqual([OPEN, STATION].sort());
            const decoded = decodeSave(encodeSave(save))!;
            expect(decoded.dominated).toEqual([OPEN, STATION].sort());
            const restored = new Entity('restored');
            restorePlayerState(restored, decoded);
            expect(restored.components.get(DominatedComponent))
                .toEqual([OPEN, STATION].sort());
            // A pilot who dominates nothing writes nothing and restores none.
            player.components.delete(DominatedComponent);
            const clean = extractSaveData(player, SYSTEM)!;
            expect(clean.dominated).toBeUndefined();
            restorePlayerState(restored, clean);
            expect(restored.components.has(DominatedComponent)).toBeFalse();
        });
});

/** A hit on `victim` through the real DamagedEvent path. */
function hit(world: World, victim: string, firer: string, damage = KILL) {
    const shot = new Entity('shot')
        .addComponent(SourceComponent, firer)
        .addComponent(FiringGroupComponent, { group: firer })
        .addComponent(TargetComponent, { target: victim });
    const shotUuid = `shot ${now(world)}`;
    world.entities.set(shotUuid, shot);
    world.step();
    world.emit(DamagedEvent, { damage, damager: shotUuid }, [victim]);
    world.step();
    world.entities.delete(shotUuid);
    world.step();
}
