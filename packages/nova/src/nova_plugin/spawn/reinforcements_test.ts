import 'jasmine';
import { getDefaultFleetData } from 'novadatainterface/fleet_data';
import { GovtData, getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { getDefaultRankData, getDefaultRankFlags } from 'novadatainterface/rank_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { WeaponDamage } from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { Random } from 'nova_ecs/plugins/random_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { GovtComponent } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { ActiveRanksComponent } from '../ncb/index.js';
import {
    DistressCallEvent, DistressCallEventData, NpcComponent,
    SystemHoldComponent,
} from '../npc/index.js';
import { extractSaveData, restorePlayerState, SaveData } from '../pilot/index.js';
import {
    ControlledByComponent, dayNumber, GameDateComponent, MissionShipComponent,
    PlayerEscortComponent, ReinforcementCallsComponent,
} from '../player/index.js';
import {
    DamagedEvent, ExplodingComponent, FiringGroupComponent, makeShip,
    OutfitsStateComponent, ShieldComponent, ShipDataComponent, SourceComponent,
    TargetComponent,
} from '../ship/index.js';
import { completeEntity } from './entity_data_loader.js';
import { trafficCount } from './npc_spawn_plugin.js';
import {
    inhibitsReinforcements, REINFORCEMENT_ARRIVAL_DISTANCE,
    REINFORCEMENT_FRAMES_PER_SECOND, REINFORCEMENT_LINE_PREFIX_INDEX,
    REINFORCEMENT_LINE_SUFFIX_INDEX, REINFORCEMENT_TRADER_CALL_RANGE,
    ReinforcementArrivalEvent, ReinforcementArrivalEventData,
    reinforcementArrivalMessage, reinforcementArrivalState,
    reinforcementAvailable, ReinforcementCallComponent,
    reinforcementCallInRange, reinforcementDelayMs, reinforcementOddsCall,
    REINFORCEMENTS_UUID,
} from './reinforcements.js';

/**
 * ============================================================================
 * Reinforcement fleets (reference "R19 reinforcement fleets", waves 19-20)
 * ============================================================================
 *
 * The rig mirrors the reference's: gövt OWNER (MaxOdds 100, MediumName
 * "Kit Reinf") owns the system, whose ReinfFleet is a lead and two guards
 * of OWNER; two Strength-50 traders of OWNER sit by the player. A
 * Strength-100 player's first hit (3000 of a 30000 shield) calls the fleet;
 * a Strength-1 player's does not; an NPC's never does. Wave 20: the delay
 * is ReinfTime / 39 s, the fleet comes in around the victim (not the
 * player), an anchored victim never calls, and a victim that leaves before
 * the arrival takes the call with it (a GUESS since wave 21). Wave 22: a
 * trader victim (AI 1 / AI 2) calls only when hit from near (600 px, a
 * GUESS between 475 that called and 700 that did not), whatever its speed,
 * and the call sends no distress line.
 */

const SYSTEM = 'test:system';
const FLEET = 'test:reinf-fleet';
const OWNER = 'test:owner';
const ALLY = 'test:ally';
const OTHER = 'test:other';
const RAIDER = 'test:raider';
const QUIET_ALLY = 'test:quiet-ally';

const TRADER_HULL = 'test:trader';
const ANCHORED_HULL = 'test:anchored';
const SLOW_HULL = 'test:slow';
const PLAYER_HULL = 'test:lancer';
const WEAK_HULL = 'test:lancer-weak';
const LEAD_HULL = 'test:lead';
const GUARD_HULL = 'test:guard';
const JAMMER = 'test:jammer';
const AFFILIATED_RANK = 'test:rank-0400';

function govt(id: string, classes: number[], more: Partial<GovtData> = {})
    : GovtData {
    return { ...getDefaultGovtData(), ...more, id, classes };
}

const GOVTS: GovtData[] = [
    govt(OWNER, [30], {
        maxOdds: 100, mediumName: 'Kit Reinf', name: 'Kit Reinf Owner',
        crimeTol: 30000,
    }),
    govt(ALLY, [31], { allies: [30] }),
    govt(OTHER, [32]),
    govt(RAIDER, [33], { enemies: [30] }),
    // gövt Flags2 0x0008: its ships send no distress messages.
    govt(QUIET_ALLY, [34], {
        allies: [30],
        flags2: { ...getDefaultGovtData().flags2, noDistressMessages: true },
    }),
];

function hull(id: string, strength: number): ShipData {
    const base = getDefaultShipData();
    return {
        ...base, id, strength,
        physics: {
            ...base.physics, shield: 30000, armor: 30000, shieldRecharge: 0,
        },
    };
}

/** 3,000 shield: the reference's Disable Gun hit (100% -> 90%). */
const HIT: WeaponDamage = {
    shield: 3000, armor: 0, ionization: 0, ionizationColor: 0xffffff,
    passThroughShield: 0, knockback: 0,
};

/** Never thinks until a test says so. */
const ASLEEP = Number.MAX_SAFE_INTEGER;

const JUNE_23 = { day: 23, month: 6, year: 1177 };
const JUNE_24 = { day: 24, month: 6, year: 1177 };
const JUNE_26 = { day: 26, month: 6, year: 1177 };

describe('reinforcement rules', () => {
    it('the delay is ReinfTime / 39 s, MEASURED at four points (reference '
        + 'R19 wave 20), not the Bible\'s 30 a second', () => {
            expect(REINFORCEMENT_FRAMES_PER_SECOND).toBe(39);
            // Measured: 300 -> 7.7 s (mean of seven), 600 -> 15.2 s,
            // 900 -> 23.2-24.8 s (wave 19), 1800 -> 45.7-46.8 s.
            expect(reinforcementDelayMs(300) / 1000).toBeCloseTo(7.69, 2);
            expect(reinforcementDelayMs(600) / 1000).toBeCloseTo(15.38, 2);
            expect(reinforcementDelayMs(900) / 1000).toBeCloseTo(23.08, 2);
            expect(reinforcementDelayMs(1800) / 1000).toBeCloseTo(46.15, 2);
            expect(reinforcementDelayMs(-1)).toBe(0);
        });

    it('no cap: the delay stays linear past 1800', () => {
        expect(reinforcementDelayMs(3900)).toBe(100_000);
        expect(reinforcementDelayMs(7800)).toBe(2 * reinforcementDelayMs(3900));
    });

    it('once a day: ReinfIntrval 0 and 1 both mean the next day', () => {
        const day = dayNumber(JUNE_23);
        for (const interval of [0, 1]) {
            expect(reinforcementAvailable(undefined, day, interval))
                .toBeTrue();
            expect(reinforcementAvailable(day, day, interval)).toBeFalse();
            expect(reinforcementAvailable(day, day + 1, interval))
                .toBeTrue();
        }
    });

    it('ReinfIntrval 2: day d and d + 2, not d + 1 (MEASURED, wave 20)',
        () => {
            const day = dayNumber(JUNE_23);
            expect(reinforcementAvailable(day, day + 1, 2)).toBeFalse();
            expect(reinforcementAvailable(day, day + 2, 2)).toBeTrue();
            // Called again on d + 2: d + 3 refused.
            expect(reinforcementAvailable(day + 2, day + 3, 2)).toBeFalse();
        });

    it('every ReinfIntrval days after the last call (GUESS over 2)', () => {
        const day = dayNumber(JUNE_23);
        expect(reinforcementAvailable(day, day + 2, 3)).toBeFalse();
        expect(reinforcementAvailable(day, day + 3, 3)).toBeTrue();
        // A pilot restored to an earlier date is not held back.
        expect(reinforcementAvailable(day, day - 1, 3)).toBeTrue();
    });

    it('the odds call it when they EXCEED MaxOdds (100 = 1-to-1)', () => {
        // Strength 100 against two 50s, the hit one at 90% shield (93%).
        expect(reinforcementOddsCall(100, 100, 46.5 + 50)).toBeTrue();
        // Exactly even does not exceed.
        expect(reinforcementOddsCall(100, 100, 100)).toBeFalse();
        // Strength 1 against them does not.
        expect(reinforcementOddsCall(100, 1, 96.5)).toBeFalse();
        // MaxOdds 200: only more than twice as strong.
        expect(reinforcementOddsCall(200, 150, 100)).toBeFalse();
        expect(reinforcementOddsCall(200, 201, 100)).toBeTrue();
        // Nobody left standing on the govt's side: any attacker does.
        expect(reinforcementOddsCall(100, 1, 0)).toBeTrue();
        expect(reinforcementOddsCall(100, 0, 0)).toBeFalse();
    });

    it('oütf ModType 44: a class value inhibits that class\'s govts, -1 '
        + 'every govt', () => {
            const owner = GOVTS[0]!;
            const outfit = (inhibitor: number | null) => ({
                ...getDefaultOutfitData(),
                reinforcementInhibitorClass: inhibitor,
            });
            expect(inhibitsReinforcements(outfit(-1), owner)).toBeTrue();
            expect(inhibitsReinforcements(outfit(30), owner)).toBeTrue();
            expect(inhibitsReinforcements(outfit(31), owner)).toBeFalse();
            expect(inhibitsReinforcements(outfit(null), owner)).toBeFalse();
            expect(inhibitsReinforcements(undefined, owner)).toBeFalse();
        });

    it('a trader calls only from near: 475 px yes, 700 no (MEASURED, wave '
        + '22), 600 the GUESS between; other AIs from anywhere', () => {
            expect(REINFORCEMENT_TRADER_CALL_RANGE).toBe(600);
            const sq = (d: number) => d * d;
            for (const aiType of [1, 2]) {
                expect(reinforcementCallInRange(aiType, sq(40))).toBeTrue();
                expect(reinforcementCallInRange(aiType, sq(475))).toBeTrue();
                expect(reinforcementCallInRange(aiType, sq(600))).toBeTrue();
                expect(reinforcementCallInRange(aiType, sq(601))).toBeFalse();
                expect(reinforcementCallInRange(aiType, sq(700))).toBeFalse();
                expect(reinforcementCallInRange(aiType, sq(1080)))
                    .toBeFalse();
                // A shooter with no position does not block it.
                expect(reinforcementCallInRange(aiType, undefined))
                    .toBeTrue();
            }
            // Wave 21's AI 4 call came from 1,600+ px.
            for (const aiType of [3, 4]) {
                expect(reinforcementCallInRange(aiType, sq(1600))).toBeTrue();
            }
        });

    it('the line: "Sensors detect <MediumName> reinforcement fleet '
        + 'approaching.", from STR# 2002 306 / 307', () => {
            const misc: string[] = [];
            misc[REINFORCEMENT_LINE_PREFIX_INDEX] = 'Sensors detect';
            misc[REINFORCEMENT_LINE_SUFFIX_INDEX] =
                'reinforcement fleet approaching.';
            expect(reinforcementArrivalMessage(misc, 'Kit Reinf')).toBe(
                'Sensors detect Kit Reinf reinforcement fleet approaching.');
            misc[REINFORCEMENT_LINE_PREFIX_INDEX] = 'Radar shows';
            expect(reinforcementArrivalMessage(misc, 'Kit Reinf')).toBe(
                'Radar shows Kit Reinf reinforcement fleet approaching.');
            // A scenario without the strings: the Bible's wording.
            expect(reinforcementArrivalMessage([], 'Federation')).toBe(
                'Sensors detect Federation reinforcement fleet approaching.');
        });

    it('the fleet comes in 1,800 px out, heading in', () => {
        const state = reinforcementArrivalState({ x: 100, y: -50 }, 200,
            new Random(7));
        const offset = new Vector(state.position.x - 100,
            state.position.y + 50);
        expect(offset.length).toBeCloseTo(REINFORCEMENT_ARRIVAL_DISTANCE, 6);
        expect(state.velocity.length).toBeCloseTo(200, 6);
        // Velocity points back at the centre.
        const inward = offset.scale(-1).normalize();
        expect(state.velocity.normalize().x).toBeCloseTo(inward.x, 6);
        expect(state.velocity.normalize().y).toBeCloseTo(inward.y, 6);
    });

    it('the fleet is not traffic: held \'reinforcement\' ships are left '
        + 'out of the population count', () => {
            expect(trafficCount([
                [{}, undefined],
                [{}, { reason: 'reinforcement' }],
                [{}, { reason: 'missionGoal' }],
                [{}, { reason: 'reinforcement' }],
            ])).toBe(2);
        });
});

describe('reinforcement fleets in the sim', () => {
    let gameData: MockGameData;
    let world: World;
    let arrivals: ReinforcementArrivalEventData[];
    let distress: DistressCallEventData[];

    async function build({ delayFrames = 300, regenerationDays = 0 } = {}) {
        gameData = new MockGameData();
        for (const g of GOVTS) {
            gameData.data.Govt.map.set(g.id, g);
        }
        for (const [id, strength] of [[TRADER_HULL, 50], [PLAYER_HULL, 100],
            [WEAK_HULL, 1], [LEAD_HULL, 80], [GUARD_HULL, 40]] as const) {
            gameData.data.Ship.map.set(id, hull(id, strength));
        }
        const anchored = hull(ANCHORED_HULL, 50);
        gameData.data.Ship.map.set(ANCHORED_HULL, {
            ...anchored, physics: { ...anchored.physics, speed: 0 },
        });
        // Wave 21's slow S50 (Speed 20), which called from near in wave 22.
        gameData.data.Ship.map.set(SLOW_HULL, {
            ...anchored, id: SLOW_HULL,
            physics: { ...anchored.physics, speed: 20 },
        });
        gameData.data.Fleet.map.set(FLEET, {
            ...getDefaultFleetData(), id: FLEET, name: 'Kit Reinf Fleet',
            leadShip: LEAD_HULL, escorts: [{ id: GUARD_HULL, min: 2, max: 2 }],
            govt: OWNER,
        });
        gameData.data.System.map.set(SYSTEM, {
            ...getDefaultSystemData(), id: SYSTEM, govt: OWNER,
            reinforcements: { fleet: FLEET, delayFrames, regenerationDays },
        });
        gameData.data.Outfit.map.set(JAMMER, {
            ...getDefaultOutfitData(), id: JAMMER,
            reinforcementInhibitorClass: -1,
        });
        gameData.data.Rank.map.set(AFFILIATED_RANK, {
            ...getDefaultRankData(), id: AFFILIATED_RANK, affilGovt: OWNER,
            flags: 0x0400,
            rankFlags: {
                ...getDefaultRankFlags(), canRequestBattleAssistance: true,
            },
        });
        world = await makeSystem(SYSTEM, gameData, undefined, { npcs: false });
        arrivals = [];
        world.events.get(ReinforcementArrivalEvent).subscribe(
            ({ data }) => arrivals.push(data));
        distress = [];
        world.events.get(DistressCallEvent).subscribe(
            ({ data }) => distress.push(data));
    }

    function pin(ship: Entity, x: number, y: number) {
        ship.components.set(MovementStateComponent, {
            position: new Position(x, y),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
    }

    async function addShip(uuid: string, hullId: string, x: number, y: number,
        setup: (ship: Entity) => void) {
        const ship = makeShip(gameData.data.Ship.map.get(hullId)!);
        setup(ship);
        await completeEntity(world, ship);
        pin(ship, x, y);
        world.entities.set(uuid, ship);
        return ship;
    }

    const npcShip = (aiType: number, govtId: string) => (ship: Entity) => {
        ship.components.set(NpcComponent,
            { aiType, nextDecision: ASLEEP, departAt: 1e12 });
        ship.components.set(GovtComponent, { id: govtId });
    };

    const pilot = (date = JUNE_23) => (ship: Entity) => {
        ship.components.set(ControlledByComponent, { peerId: 'peer' });
        ship.components.set(GameDateComponent, { ...date });
    };

    /** The reference rig: the player beside two Strength-50 traders of the
     * fleet's govt. */
    async function scene(playerHull = PLAYER_HULL,
        traderGovt = OWNER, more: (ship: Entity) => void = () => { }) {
        await addShip('player', playerHull, 0, 0, ship => {
            pilot()(ship);
            more(ship);
        });
        await addShip('trader1', TRADER_HULL, 0, -150, npcShip(1, traderGovt));
        await addShip('trader2', TRADER_HULL, 300, 0, npcShip(1, traderGovt));
        world.step();
    }

    /** A hit on `victim` through the real DamagedEvent path. */
    function hit(victim: string, firer: string, damage = HIT) {
        const shot = new Entity('shot')
            .addComponent(SourceComponent, firer)
            .addComponent(FiringGroupComponent, { group: firer })
            .addComponent(TargetComponent, { target: victim });
        const shotUuid = `shot ${now()}`;
        world.entities.set(shotUuid, shot);
        world.step();
        world.emit(DamagedEvent, { damage, damager: shotUuid }, [victim]);
        world.step();
        world.entities.delete(shotUuid);
        world.step();
    }

    function now() {
        return world.resources.get(TimeResource)!.time;
    }

    function advance(ms: number) {
        const until = now() + ms;
        while (now() < until) {
            world.step();
        }
    }

    function call() {
        return world.entities.get(REINFORCEMENTS_UUID)!.components
            .get(ReinforcementCallComponent)!;
    }

    function fleetShips() {
        return [...world.entities].filter(([, entity]) =>
            entity.components.get(SystemHoldComponent)?.reason
            === 'reinforcement');
    }

    /** The fleet leaves the scene (as a new visit would find it gone), so
     * the odds are the traders' alone again. */
    function dismissFleet() {
        for (const [uuid] of fleetShips()) {
            world.entities.delete(uuid);
        }
        world.step();
    }

    function calls(uuid = 'player') {
        return world.entities.get(uuid)!.components
            .get(ReinforcementCallsComponent);
    }

    it('the system\'s fleet is staged at genesis, nothing called', async () => {
        await build();
        expect(call()).toEqual({});
    });

    it('a Strength-100 player\'s FIRST hit on a Strength-50 trader calls '
        + 'it (100 against 46.5 + 50)', async () => {
            await build();
            await scene();
            hit('trader1', 'player');
            expect(world.entities.get('trader1')!.components
                .get(ShieldComponent)!.current).toBe(27000);
            expect(call().caller).toBe('player');
            expect(call().arriveAt).toBeDefined();
            expect(calls()?.get(SYSTEM)).toBe(dayNumber(JUNE_23));
        });

    it('at exactly even odds it does not (a hit that takes no shield: '
        + '100 against 100)', async () => {
            await build();
            await scene();
            hit('trader1', 'player', { ...HIT, shield: 0 });
            expect(call()).toEqual({});
        });

    it('a Strength-1 player\'s hit does not call it', async () => {
        await build();
        await scene(WEAK_HULL);
        hit('trader1', 'player');
        expect(call()).toEqual({});
        expect(calls()).toBeUndefined();
    });

    it('an NPC\'s hit never calls it, odds or not', async () => {
        await build();
        await scene();
        await addShip('raider', PLAYER_HULL, 200, 200, npcShip(3, RAIDER));
        world.step();
        hit('trader1', 'raider');
        hit('trader1', 'raider');
        expect(call()).toEqual({});
        advance(30_000);
        expect(fleetShips().length).toBe(0);
    });

    it('a hit on an ALLY\'s ship calls it (MEASURED, wave 20); an '
        + 'unrelated govt\'s does not', async () => {
            await build();
            await scene(PLAYER_HULL, OTHER);
            hit('trader1', 'player');
            expect(call()).toEqual({});
            await addShip('allied', TRADER_HULL, -300, 0, npcShip(1, ALLY));
            world.step();
            hit('allied', 'player');
            expect(call().caller).toBe('player');
        });

    describe('who calls: a trader only from near, and without a distress '
        + 'line (MEASURED, wave 22)', () => {
            /** The player at the origin, one victim `distance` px north. */
            async function lone(aiType: number, distance: number,
                hullId = TRADER_HULL, govtId = OWNER) {
                await addShip('player', PLAYER_HULL, 0, 0, pilot());
                await addShip('victim', hullId, 0, -distance,
                    npcShip(aiType, govtId));
                world.step();
            }

            it('an AI 1 victim hit from 475 px calls; from 700 px it does '
                + 'not, and the day stays unspent', async () => {
                    await build();
                    await lone(1, 700);
                    hit('victim', 'player');
                    hit('victim', 'player');
                    expect(call()).toEqual({});
                    expect(calls()).toBeUndefined();

                    await build();
                    await lone(1, 475);
                    hit('victim', 'player');
                    expect(call().victim).toBe('victim');
                    expect(calls()?.get(SYSTEM)).toBe(dayNumber(JUNE_23));
                });

            it('the same far victim calls once the player closes in',
                async () => {
                    await build();
                    await lone(1, 1080);
                    hit('victim', 'player');
                    expect(call()).toEqual({});
                    pin(world.entities.get('player')!, 0, -930);
                    world.step();
                    hit('victim', 'player');
                    expect(call().victim).toBe('victim');
                });

            it('an AI 2 victim from near calls, from far does not',
                async () => {
                    await build();
                    await lone(2, 140);
                    hit('victim', 'player');
                    expect(call().victim).toBe('victim');

                    await build();
                    await lone(2, 815);
                    hit('victim', 'player');
                    expect(call()).toEqual({});
                });

            it('a SLOW AI 1 hull (Speed 20) calls from near: speed plays '
                + 'no part', async () => {
                    await build();
                    await lone(1, 150, SLOW_HULL);
                    hit('victim', 'player');
                    expect(call().victim).toBe('victim');
                });

            for (const aiType of [3, 4]) {
                it(`an AI ${aiType} victim calls from far (wave 21's AI 4 `
                    + 'from 1,600+ px; AI 3 a GUESS)', async () => {
                        await build();
                        await lone(aiType, 1600);
                        hit('victim', 'player');
                        expect(call().victim).toBe('victim');
                    });
            }

            it('the call sends no distress line, AI 1 to AI 4', async () => {
                for (const aiType of [1, 2, 3, 4]) {
                    await build();
                    await lone(aiType, 150);
                    hit('victim', 'player');
                    expect(call().victim).withContext(`AI ${aiType}`)
                        .toBe('victim');
                    expect(distress).withContext(`AI ${aiType}`).toEqual([]);
                }
            });

            it('a Flags2-0x0008 govt\'s victim still calls (finding 5), as '
                + 'does a mission ship', async () => {
                    await build();
                    await lone(1, 150, TRADER_HULL, QUIET_ALLY);
                    hit('victim', 'player');
                    expect(call().victim).toBe('victim');

                    await build();
                    await addShip('player', PLAYER_HULL, 0, 0, pilot());
                    await addShip('special', TRADER_HULL, 0, -150, ship => {
                        npcShip(1, OWNER)(ship);
                        // Untethered, so the finished-mission sweep (the
                        // pilot holds no such mission) leaves it be.
                        ship.components.set(MissionShipComponent, {
                            mission: 'test:mission', owner: 'player',
                            untethered: true,
                        });
                    });
                    world.step();
                    hit('special', 'player');
                    expect(call().victim).toBe('special');
                    expect(distress).toEqual([]);
                });
        });

    it('arrives ReinfTime / 39 s later: the whole flët, 1,800 px from the '
        + 'victim, held, and the line names the MediumName', async () => {
            await build();
            await scene();
            hit('trader1', 'player');
            const delay = reinforcementDelayMs(300);
            const calledAt = call().arriveAt! - delay;
            expect(call().victim).toBe('trader1');
            expect(call().center).toEqual({ x: 0, y: -150 });
            advance(calledAt + delay - 100 - now());
            expect(fleetShips().length).toBe(0);
            expect(arrivals).toEqual([]);
            advance(calledAt + delay + 100 - now());
            const fleet = fleetShips();
            expect(fleet.length).toBe(3);
            expect(arrivals).toEqual([{ govt: OWNER, name: 'Kit Reinf' }]);
            expect(call()).toEqual({});
            const victim = new Vector(0, -150);
            for (const [, ship] of fleet) {
                expect(ship.components.get(GovtComponent)?.id).toBe(OWNER);
                const position = ship.components
                    .get(MovementStateComponent)!.position;
                const distance = position.subtract(victim).length;
                expect(distance).toBeGreaterThan(1_500);
                expect(distance).toBeLessThan(2_100);
            }
        });

    it('the fleet comes in around the VICTIM at the call, not the player '
        + '(MEASURED: none came to a far player; the victim over the '
        + 'system\'s centre is a GUESS)', async () => {
            await build();
            await scene();
            // The victim far from the system's centre, the player beside it
            // (a trader calls only when hit from near, wave 22).
            pin(world.entities.get('trader1')!, 4_000, 3_000);
            pin(world.entities.get('player')!, 4_000, 3_150);
            world.step();
            hit('trader1', 'player');
            expect(call().center).toEqual({ x: 4_000, y: 3_000 });
            // The player flies off, and the victim moves on: the centre is
            // where the victim was at the call.
            pin(world.entities.get('player')!, -6_000, 0);
            pin(world.entities.get('trader1')!, 4_200, 3_000);
            // Step to the arrival tick.
            while (fleetShips().length === 0 && now() < 60_000) {
                world.step();
            }
            const fleet = fleetShips();
            expect(fleet.length).toBe(3);
            const lead = fleet.find(([, ship]) => ship.components
                .get(ShipDataComponent)?.id === LEAD_HULL)![1].components
                .get(MovementStateComponent)!;
            const center = new Vector(4_000, 3_000);
            const fromCenter = lead.position.subtract(center);
            expect(fromCenter.length).toBeGreaterThan(1_700);
            expect(fromCenter.length).toBeLessThan(1_850);
            // Heading for the centre, not for the player.
            const inward = fromCenter.scale(-1).normalize();
            const heading = lead.velocity.normalize();
            expect(heading.x).toBeCloseTo(inward.x, 3);
            expect(heading.y).toBeCloseTo(inward.y, 3);
            const player = new Vector(-6_000, 0);
            for (const [, ship] of fleet) {
                const position = ship.components
                    .get(MovementStateComponent)!.position;
                expect(position.subtract(player).length)
                    .toBeGreaterThan(6_000);
            }
        });

    it('ReinfTime 900 waits 23.1 s and 1800 waits 46.2 s: no cap',
        async () => {
            for (const [frames, seconds] of [[900, 23.08], [1800, 46.15]]) {
                await build({ delayFrames: frames });
                await scene();
                hit('trader1', 'player');
                const calledAt = now();
                advance(calledAt + (seconds - 0.3) * 1000 - now());
                expect(fleetShips().length).toBe(0);
                advance(calledAt + (seconds + 0.3) * 1000 - now());
                expect(fleetShips().length).toBe(3);
            }
        });

    it('an ANCHORED victim (hull Speed 0) never calls it (MEASURED, wave '
        + '20: its AI does not run)', async () => {
            await build();
            await addShip('player', PLAYER_HULL, 0, 0, pilot());
            await addShip('anchored', ANCHORED_HULL, 0, -150,
                npcShip(1, OWNER));
            world.step();
            // 100 against one anchored 50 alone: the odds favour him.
            hit('anchored', 'player');
            hit('anchored', 'player');
            expect(call()).toEqual({});
            expect(calls()).toBeUndefined();
            advance(30_000);
            expect(fleetShips().length).toBe(0);
        });

    it('a victim that left the system before the arrival takes the call '
        + 'with it (GUESS: no supporting run since wave 21); the caller\'s '
        + 'day stays spent',
        async () => {
            await build({ delayFrames: 600 });
            await scene();
            hit('trader1', 'player');
            expect(call().victim).toBe('trader1');
            // It jumps out 10.4 s after the hit (the reference's AI 1).
            advance(10_400);
            world.entities.delete('trader1');
            advance(10_000);
            expect(fleetShips().length).toBe(0);
            expect(arrivals).toEqual([]);
            expect(call()).toEqual({});
            expect(calls()?.get(SYSTEM)).toBe(dayNumber(JUNE_23));
            // The day is spent: another hit calls nothing today.
            hit('trader2', 'player');
            expect(call()).toEqual({});
        });

    it('a victim that is destroyed (dying or gone) before the arrival '
        + 'cancels it too (GUESS)', async () => {
            await build();
            await scene();
            hit('trader1', 'player');
            world.entities.get('trader1')!.components
                .set(ExplodingComponent, now() + 60_000);
            advance(reinforcementDelayMs(300) + 200);
            expect(fleetShips().length).toBe(0);
            expect(arrivals).toEqual([]);
            expect(call()).toEqual({});
        });

    it('a victim still in the system at the arrival gets its fleet, '
        + 'wherever it went', async () => {
            await build();
            await scene();
            hit('trader1', 'player');
            pin(world.entities.get('trader1')!, 2_500, 0);
            advance(reinforcementDelayMs(300) + 200);
            expect(fleetShips().length).toBe(3);
        });

    it('the fleet attacks a caller still fighting the govt\'s side '
        + '(MEASURED, wave 20)', async () => {
            await build();
            await scene();
            hit('trader1', 'player');
            advance(11_000);
            for (const [, ship] of fleetShips()) {
                expect(ship.components.get(NpcComponent)!.aggressor)
                    .toBe('player');
            }
        });

    it('and leaves him to its govt\'s politics once nobody is fighting him '
        + '(OPEN: wave 19\'s neutral fleet)', async () => {
            await build();
            await scene();
            hit('trader1', 'player');
            // The victim has calmed down (no NPC of the side holds him).
            for (const id of ['trader1', 'trader2']) {
                const npc = world.entities.get(id)!.components
                    .get(NpcComponent)!;
                delete npc.aggressor;
                delete npc.aggressorSince;
            }
            advance(11_000);
            expect(fleetShips().length).toBe(3);
            for (const [, ship] of fleetShips()) {
                expect(ship.components.get(NpcComponent)!.aggressor)
                    .toBeUndefined();
            }
        });

    it('once a day: no second call the same day, one the next day',
        async () => {
            await build();
            await scene();
            hit('trader1', 'player');
            advance(11_000);
            expect(fleetShips().length).toBe(3);
            dismissFleet();
            // The odds still favour him (100 against 43 + 46.5), but the
            // fleet was called today.
            hit('trader2', 'player');
            expect(call()).toEqual({});
            // The next day (a landing and take-off advance the date).
            world.entities.get('player')!.components
                .set(GameDateComponent, { ...JUNE_24 });
            hit('trader2', 'player');
            expect(call().caller).toBe('player');
            expect(calls()?.get(SYSTEM)).toBe(dayNumber(JUNE_24));
        });

    it('ReinfIntrval 3: not two days later, three days later', async () => {
        await build({ regenerationDays: 3 });
        await scene();
        hit('trader1', 'player');
        advance(11_000);
        dismissFleet();
        world.entities.get('player')!.components
            .set(GameDateComponent, { ...JUNE_24 });
        hit('trader2', 'player');
        expect(call()).toEqual({});
        world.entities.get('player')!.components
            .set(GameDateComponent, { ...JUNE_26 });
        hit('trader2', 'player');
        expect(call().caller).toBe('player');
    });

    it('a call stamps only the caller: the other pilot calls his own on '
        + 'his own day (Matthew\'s ruling)', async () => {
            await build();
            await scene();
            // The other pilot's date is the SAME day: the cooldown is
            // private to each player all the same.
            await addShip('wingman', PLAYER_HULL, 0, 400, pilot(JUNE_23));
            world.step();
            // Two Strength-100 pilots: the hitter alone is the enemy side.
            hit('trader1', 'player');
            expect(call().caller).toBe('player');
            expect(calls()?.get(SYSTEM)).toBe(dayNumber(JUNE_23));
            expect(calls('wingman')).toBeUndefined();
            advance(11_000);
            dismissFleet();
            // The caller cannot call a second one that day...
            hit('trader2', 'player');
            expect(call()).toEqual({});
            // ...but the other pilot can, and only he is stamped for it.
            hit('trader2', 'wingman');
            expect(call().caller).toBe('wingman');
            expect(calls('wingman')?.get(SYSTEM)).toBe(dayNumber(JUNE_23));
            advance(11_000);
            expect(fleetShips().length).toBe(3);
            expect(arrivals.length).toBe(2);
        });

    it('while one pilot\'s fleet is pending, another\'s hit calls nothing '
        + 'and stamps nobody (CHOICE)', async () => {
            await build();
            await scene();
            await addShip('wingman', PLAYER_HULL, 0, 400, pilot(JUNE_26));
            world.step();
            hit('trader1', 'player');
            const pending = { ...call() };
            hit('trader2', 'wingman');
            expect(call()).toEqual(pending);
            expect(calls('wingman')).toBeUndefined();
            advance(11_000);
            expect(fleetShips().length).toBe(3);
            expect(arrivals.length).toBe(1);
        });

    it('once it is present, its ships are the govt\'s friends: another '
        + 'pilot\'s hit is outnumbered (CHOICE)', async () => {
            await build();
            await scene();
            await addShip('wingman', PLAYER_HULL, 0, 400, pilot(JUNE_26));
            world.step();
            hit('trader1', 'player');
            advance(11_000);
            expect(fleetShips().length).toBe(3);
            // 100 against two traders and a lead and two guards.
            hit('trader2', 'wingman');
            expect(call()).toEqual({});
            expect(calls('wingman')).toBeUndefined();
        });

    it('an escort\'s hit stamps the pilot it escorts (GUESS: it counts as '
        + 'his)', async () => {
            await build();
            await scene(WEAK_HULL);
            await addShip('wingman', PLAYER_HULL, 0, 400, pilot(JUNE_26));
            await addShip('escort', PLAYER_HULL, 50, 0, ship => {
                ship.components.set(PlayerEscortComponent, {
                    player: 'player', parent: 'player', deal: { kind: 'none' },
                });
            });
            world.step();
            // A Strength-1 pilot with a Strength-100 escort: 101 against
            // 46.5 + 50.
            hit('trader1', 'escort');
            expect(call().caller).toBe('player');
            expect(calls()?.get(SYSTEM)).toBe(dayNumber(JUNE_23));
            expect(calls('wingman')).toBeUndefined();
            expect(world.entities.get('escort')!.components
                .has(ReinforcementCallsComponent)).toBeFalse();
        });

    it('the fleet does not fill the traffic\'s slots and never leaves',
        async () => {
            await build();
            await scene();
            hit('trader1', 'player');
            advance(11_000);
            for (const [, ship] of fleetShips()) {
                expect(ship.components.get(SystemHoldComponent))
                    .toEqual({ reason: 'reinforcement' });
            }
        });

    it('a pilot carrying a ModType 44 inhibitor never calls it (MEASURED, '
        + 'wave 20)',
        async () => {
            await build();
            await scene(PLAYER_HULL, OWNER, ship => ship.components.set(
                OutfitsStateComponent, new Map([[JAMMER, { count: 1 }]])));
            hit('trader1', 'player');
            expect(call()).toEqual({});
        });

    it('a ränk 0x0400 pilot under an NPC\'s attack gets no fleet: nobody '
        + 'calls it on his behalf (reference R19)', async () => {
            await build();
            await scene();
            world.entities.get('player')!.components.set(ActiveRanksComponent,
                new Set([AFFILIATED_RANK]));
            await addShip('raider', PLAYER_HULL, 200, 200, npcShip(3, RAIDER));
            world.step();
            hit('player', 'raider');
            hit('player', 'raider');
            // The raider wears down a ship of the affiliated govt too.
            hit('trader1', 'raider');
            hit('trader1', 'raider');
            expect(call()).toEqual({});
            advance(30_000);
            expect(fleetShips().length).toBe(0);
            expect(arrivals).toEqual([]);
        });

    it('the cooldown is saved with the pilot', async () => {
        await build();
        await scene();
        hit('trader1', 'player');
        const player = world.entities.get('player')!;
        const save = extractSaveData(player, SYSTEM)!;
        expect(save.reinforcementCalls)
            .toEqual([[SYSTEM, dayNumber(JUNE_23)]]);
        const restored = new Entity('restored');
        restorePlayerState(restored, save as SaveData);
        expect(restored.components.get(ReinforcementCallsComponent))
            .toEqual(new Map([[SYSTEM, dayNumber(JUNE_23)]]));
        // A pilot with no calls writes nothing and restores none.
        player.components.delete(ReinforcementCallsComponent);
        const clean = extractSaveData(player, SYSTEM)!;
        expect(clean.reinforcementCalls).toBeUndefined();
        restorePlayerState(restored, clean);
        expect(restored.components.has(ReinforcementCallsComponent))
            .toBeFalse();
    });
});
