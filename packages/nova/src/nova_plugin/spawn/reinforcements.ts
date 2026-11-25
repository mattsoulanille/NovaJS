import * as t from 'io-ts';
import { GovtData } from 'novadatainterface/govt_data';
import { OutfitData } from 'novadatainterface/outfit_data';
import { SystemData } from 'novadatainterface/system_data';
import { Emit, Entities, GetWorld, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Entity } from 'nova_ecs/entity';
import { EcsEvent } from 'nova_ecs/events';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { RandomResource } from 'nova_ecs/plugins/random_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { Query } from 'nova_ecs/query';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { registerSimulationBridgeEvent } from '../../communication/simulation_bridge_events.js';
import {
    GovtComponent, IdFactoryResource, loadWithRetries,
    SimulationGameDataResource, SystemIdResource,
} from '../core/index.js';
import {
    distressCallDue, DistressCallEvent, flockPlayer, NpcAggressionSystem,
    NpcComponent, responsibleShip, sendsDistressCalls, SystemHoldComponent,
} from '../npc/index.js';
import {
    ControlledByComponent, dayNumber, GameDateComponent, MissionShipComponent,
    ReinforcementCallsComponent,
} from '../player/index.js';
import { alliedEitherWay, effectiveStrength } from '../reputation/index.js';
import {
    DamagedEvent, DisabledComponent, ExplodingComponent, KnockbackSystem,
    OutfitsStateComponent, ShieldComponent, ShipDataComponent,
} from '../ship/index.js';
import { AsteroidDamageSystem } from '../combat/index.js';
import {
    FleetSpawn, NpcRespawnSystem, spawnFleet, stageFleetSpawn,
} from './npc_spawn_plugin.js';

/**
 * ============================================================================
 * Reinforcement fleets (sÿst ReinfFleet / ReinfTime / ReinfIntrval)
 * ============================================================================
 *
 * The Bible (sÿst): "If ships allied with the reinforcement fleet's
 * government are under attack and the combat odds against them exceed the
 * MaxOdds field of the reinforcement fleet's government, the reinforcement
 * fleet will be called in." ReinfTime is the delay ("30 = one second"),
 * ReinfIntrval the days before the fleet is available again (0: every
 * day). gövt MaxOdds: the odds are "the strengths of the ship's enemies
 * (... modified from between 30% and 100% of that value depending on the
 * ship's present shield stat)" against "the sum of the strength of the
 * ship's friends"; 100 is 1-to-1. gövt MediumName is "primarily used in
 * the string 'Sensors detect xxx reinforcement fleet approaching.'"; oütf
 * ModType 44 is a "reinforcement inhibitor".
 *
 * Measured on the original (docs/reference_experiments.md, "R19
 * reinforcement fleets, wave 19" and "..., wave 20"):
 *  - the PLAYER's first hit on a Strength-50 trader of the fleet's govt
 *    (MaxOdds 100) called it for a Strength-100 player and not for a
 *    Strength-1 one: 100 against the two 50s, the hit one counting a
 *    little less with its shield down (93% of 50 at 90% shield), passes;
 *  - "Sensors detect <MediumName> reinforcement fleet approaching." is said
 *    when the fleet ARRIVES, ReinfTime / 39 s after the hit, linear and with
 *    no cap (wave 20: 300 -> 7.7 s mean of seven, 600 -> 15.2, 900 ->
 *    23-25, 1800 -> 45.7-46.8); the whole flët comes in about 1,800-1,960
 *    px out on a random bearing;
 *  - the fleet does NOT come to the player: with him 600+ px from the
 *    victim and the port none came within his radar; with him at the port
 *    it came in 1,840-1,960 px out (wave 20);
 *  - an ANCHORED victim (hull Speed 0) never calls, its AI does not run;
 *    a victim that jumped out before the arrival got no fleet (wave 20,
 *    one run; wave 21 reread it as no call at all, below);
 *  - an AI 1 victim that calls says so (wave 21): the player's hit drew
 *    its distress line ("<ship>: We're under attack! Someone help us!",
 *    STR# 5003) and the fleet's line followed, twice; no AI 1 hit
 *    WITHOUT the line got a fleet (eight hits). The AI 4 guard called
 *    silently;
 *  - once a day: no second call in 8 more minutes of the same visit, and
 *    one on each of two following days (ReinfIntrval 1);
 *  - an NPC wearing a warship of the govt down to 27% shield did not call
 *    it, nor did 311's warships call it for a pilot holding a ränk 0x0400
 *    of their govt under attack;
 *  - the fleet stayed 2.5+ minutes, until the player left; it was hostile
 *    every time the victim still held the player as its attacker (every
 *    wave-20 run) and neutral once after two hits whose trader had left
 *    (wave 19, 1507: still unexplained); a new trader came in while it was
 *    there.
 *
 * So (GUESSES marked; docs/npc_behavior_gaps.md "Reinforcement fleets"):
 *
 * THE CALL (ReinforcementCallSystem, off DamagedEvent after the damage is
 * applied): a hit whose responsible ship is a PLAYER's ship, or a ship of
 * a player's flock (GUESS: an escort's hit counts as its player's), on an
 * NPC that is not disabled (GUESS: a hulk is out of the fight), not
 * anchored (hull Speed 0: MEASURED, wave 20, it never calls) and not in a
 * player's flock, of the fleet's govt or one allied with it either way
 * (MEASURED for an ally's ship, wave 20: it calls the fleet govt's
 * fleet, with that govt's MediumName), calls the fleet when
 *  - no call is pending in this system;
 *  - the caller's own cooldown allows it (reinforcementAvailable);
 *  - no player in the system carries an inhibitor for the fleet's govt
 *    (inhibitsReinforcements; MEASURED for the class and -1, wave 20; a
 *    GUESS in a room: read for any player in the system);
 *  - the odds exceed MaxOdds (reinforcementOddsCall): the enemies are the
 *    caller's ship and its flock, the friends every NPC of the fleet's
 *    govt or an ally in the system, neither disabled, each at
 *    effectiveStrength (MEASURED, wave 20: ten of eleven odds points fit,
 *    the player's own Strength counting; one S150 call at ratio 0.72
 *    is not modelled. GUESSES: the whole system, no range; "exceed" as
 *    strictly greater).
 * A trader victim that calls (AI 1, and AI 2 with it: npc/distress.ts's
 * one rule for who sends a line, sendsDistressCalls, so a non-mission
 * trader whose govt and hull do not silence it) sends its DISTRESS LINE on
 * the call, through the path an NPC's attack uses (DistressCallEvent, one
 * PRNG draw for the line, the ship's distressAt stamped; none while its
 * last line is still due, DISTRESS_CALL_INTERVAL_MS). MEASURED for AI 1
 * (wave 21); AI 2 is a GUESS with distress.ts's own. AI 3 / AI 4 victims
 * call silently (wave 21's `far_a`), as do mission ships and silenced
 * govts (no new rule for who calls: the line only goes with a call).
 *
 * KNOWN MISMATCH (wave 21, finding 2): on the original the SLOW AI 1
 * victims (hull Speed 20; S50 in four runs, S150 in two) never called,
 * even when they stayed in the system 60-90 s past the due arrival, while
 * NovaJS calls for them whenever the odds pass. What decides an AI 1
 * caller is not understood (speed is not all of it: wave 19's Speed-300
 * traders called on later days and not on the first; a slow S200 and a
 * slow S150 called once each), so no rule is added for it here; see
 * docs/npc_behavior_gaps.md "Reinforcement fleets: guesses to measure".
 * An NPC's hit never calls it, and nothing calls it ON a player's behalf
 * (the ränk 0x0400 "call in reinforcements on the player's behalf" did
 * not happen on the original).
 *
 * THE COOLDOWN: per pilot, per system (ReinforcementCallsComponent, on the
 * player's ship, saved with the pilot). A call stamps ONLY the caller (the
 * pilot whose hit, or whose flock's hit, called it) with his own date's
 * day number: "per game day" is private to each player (Matthew's ruling,
 * 2026-11-24), so player 1 calling the fleet on his date X does not stop
 * player 2 calling it on player 2's own date X.
 *
 * Two pilots, one system (CHOICES, the simplest rule consistent with the
 * ruling; the original is single-player):
 *  - while ANY pilot's fleet is pending (called, not yet arrived), a hit by
 *    another pilot calls nothing and stamps nobody: one fleet en route per
 *    system, and player 2 keeps his day's call for later;
 *  - once that fleet is present, nothing special: player 2's hit calls a
 *    second fleet if HIS odds exceed MaxOdds, and the present fleet's
 *    ships count among the friends (NPCs of the govt), so while they stand
 *    it usually does not.
 *
 * THE ARRIVAL (ReinforcementArrivalSystem): reinforcementDelayMs after the
 * call the whole flët (spawnFleet: the lead and every escort, counts drawn
 * as the traffic's are) comes in REINFORCEMENT_ARRIVAL_DISTANCE from the
 * VICTIM's position at the call (the call's `center`) on a random
 * bearing, heading for that centre at the lead's top speed, and every
 * player in the system is told (ReinforcementArrivalEvent; the display's
 * status line). The centre is a GUESS between the victim and the
 * system's centre: in every measured arrival the two were together (AI 4
 * victims hold their station by the port), and either way not the
 * player; the victim is the Bible's caller ("ships ... under attack").
 * The distance and the random bearing are measured (1,770-1,960 px, two
 * bearings); the kinematics are a GUESS.
 *
 * THE VICTIM LEAVING (a GUESS, with NO supporting run): a pending call is
 * CANCELLED when the victim (the call's `victim`) is no longer in the
 * system at the arrival: it jumped out, landed, or was destroyed (a ship
 * in its death sequence included). The call is read as the victim's own,
 * so any way of leaving the system takes it along. Wave 20's one run (an
 * AI 1 victim jumped 10.4 s after the hit, no fleet came) was reread in
 * wave 21 as NO CALL at all (a slow AI 1 hull, which never called even
 * when it stayed), so no run has a call followed by a departure before
 * the arrival. Kept because it costs nothing while no victim leaves. The
 * caller's day stamp stays spent either way (the call was made).
 *
 * Each ship is held in the system ('reinforcement', npc/system_hold.ts:
 * MEASURED, it stays 2+ minutes while hostile; GUESS, for the whole
 * visit) and is NOT traffic (npc_spawn_plugin's trafficCount; the new
 * trader that came in beside it). Each takes the caller as its aggressor
 * when the caller is still fighting the govt's side, i.e. some NPC of the
 * fleet's govt or an ally holds the caller or his flock as ITS aggressor
 * (MEASURED, wave 20: hostile every time the victim still held the player
 * as its attacker; OPEN: wave 19's neutral fleet in 1507 is still
 * unexplained, and a fleet whose side has calmed down is unmeasured);
 * otherwise its govt's politics decide, as for any ship of it.
 *
 * Determinism: synced components, staged caches (the flët's ships, its
 * govt, every gövt and ränk: makeSystem), the seeded Random (one draw for
 * a calling trader's distress line; at the arrival one for the bearing,
 * then the escort counts), sums in uuid order; the victim's presence is
 * read from the synced entity map.
 */

/**
 * ReinfTime's unit, per second. MEASURED (reference "R19 reinforcement
 * fleets, wave 20", finding 3): the delay is ReinfTime / 39 s, linear and
 * with NO cap, at every measured point (300 -> 7.7 s, the mean of seven
 * one-hit runs; 600 -> 15.2; 900 -> 23-25, wave 19; 1800 -> 45.7-46.8).
 * That is NOT the Bible's "A value of 30 = one second" (about 0.77 of it).
 */
export const REINFORCEMENT_FRAMES_PER_SECOND = 39;

/** How far from the centre (the victim at the call) the fleet comes in,
 * px. MEASURED: a blip 1,770 px out (wave 19), 1,840 and 1,960 px (wave
 * 20), on random bearings. */
export const REINFORCEMENT_ARRIVAL_DISTANCE = 1_800;

/**
 * The scenario's STR# with the arrival line's two halves: stock STR# 2002
 * "misc strings", entries 306 "Sensors detect" and 307 "reinforcement
 * fleet approaching." (1-based; 305 and 306 0-based, StringTableData
 * order), with the govt's MediumName between them.
 */
export const REINFORCEMENT_STRING_TABLE = 'nova:2002';
export const REINFORCEMENT_LINE_PREFIX_INDEX = 305;
export const REINFORCEMENT_LINE_SUFFIX_INDEX = 306;

/** The entity that carries the system's ReinforcementCall state. */
export const REINFORCEMENTS_UUID = 'reinforcements';

/** The delay between the call and the fleet's arrival, ms, for a sÿst
 * ReinfTime of `delayFrames`: ReinfTime / 39 s, no cap (see
 * REINFORCEMENT_FRAMES_PER_SECOND). */
export function reinforcementDelayMs(delayFrames: number): number {
    return Math.max(0, delayFrames) * 1000 / REINFORCEMENT_FRAMES_PER_SECOND;
}

/**
 * Whether a pilot who last saw the fleet called on day `lastDay`
 * (undefined: never) may call it on day `today`, with sÿst ReinfIntrval
 * `intervalDays`. 0 is "available every day" and N "that number of days"
 * after the call (Bible), so 0 and 1 both mean the next day (measured for
 * 1: a call on each of two following days; MEASURED for 2, wave 20: a call
 * on day d and d + 2, none on d + 1; GUESS for N over 2).
 * A date earlier than the call (a pilot restored from an older save) does
 * not hold the fleet back.
 */
export function reinforcementAvailable(lastDay: number | undefined,
    today: number, intervalDays: number): boolean {
    if (lastDay === undefined || today < lastDay) {
        return true;
    }
    return today - lastDay >= Math.max(1, intervalDays);
}

/**
 * Whether the odds against the govt's side call the fleet: the enemies'
 * summed effective strength over the friends', x 100, EXCEEDS `maxOdds`
 * (the Bible's "exceed"; 100 is 1-to-1). With no friend left standing any
 * enemy at all does. Measured ("R19"): 100 against 46.5 + 50 calls it, 1
 * against 100 does not.
 */
export function reinforcementOddsCall(maxOdds: number,
    enemyStrength: number, friendStrength: number): boolean {
    if (enemyStrength <= 0) {
        return false;
    }
    if (friendStrength <= 0) {
        return true;
    }
    return enemyStrength / friendStrength * 100 > maxOdds;
}

/**
 * Whether an outfit inhibits `govt`'s reinforcements: oütf ModType 44, "a
 * govt class value. any govt with this value in its Class1-4 fields will
 * be prevented from calling in reinforcements ... setting this field to -1
 * will inhibit reinforcements for all ships regardless of govt" (stock: the
 * Transmission Jammer, oütf 441, -1).
 */
export function inhibitsReinforcements(outfit: OutfitData | undefined,
    govt: GovtData): boolean {
    const inhibits = outfit?.reinforcementInhibitorClass;
    if (inhibits === undefined || inhibits === null) {
        return false;
    }
    return inhibits === -1 || govt.classes.includes(inhibits);
}

/** The arrival line: "<prefix> <name> <suffix>", the halves from the
 * scenario's STR# (REINFORCEMENT_STRING_TABLE), the Bible's wording when
 * the scenario's table does not have them. */
export function reinforcementArrivalMessage(misc: readonly string[],
    name: string): string {
    const prefix = misc[REINFORCEMENT_LINE_PREFIX_INDEX]?.trim()
        || 'Sensors detect';
    const suffix = misc[REINFORCEMENT_LINE_SUFFIX_INDEX]?.trim()
        || 'reinforcement fleet approaching.';
    return `${prefix} ${name} ${suffix}`;
}

/** The name the line gives a govt: its MediumName, else its name. */
export function reinforcementGovtName(govt: GovtData): string {
    return govt.mediumName.trim() || govt.name;
}

/**
 * The system's reinforcement fleet, staged at genesis (makeSystem): static
 * data, set identically on every peer, never mutated.
 */
export interface ReinforcementFleet {
    /** The flët, staged (stageFleetSpawn). */
    fleet: FleetSpawn;
    /** The flët's govt: whose MaxOdds, allies and MediumName apply. */
    govt: string;
    /** reinforcementDelayMs of the sÿst ReinfTime. */
    delayMs: number;
    /** sÿst ReinfIntrval. */
    intervalDays: number;
}
export const ReinforcementFleetResource =
    new Resource<ReinforcementFleet>('ReinforcementFleet');

/**
 * A system's pending call (synced; on the REINFORCEMENTS_UUID entity).
 * Every field absent: nothing called.
 */
export const ReinforcementCallType = t.partial({
    /** Sim time (ms) the called fleet arrives. */
    arriveAt: t.number,
    /** The player ship whose hit called it. */
    caller: t.string,
    /** The NPC whose hit called it: the call is cancelled when it has
     * left the system before the arrival. */
    victim: t.string,
    /** Where the fleet comes in around: the victim's position at the
     * call. */
    center: t.type({ x: t.number, y: t.number }),
});
export type ReinforcementCall = t.TypeOf<typeof ReinforcementCallType>;
export const ReinforcementCallComponent =
    new Component<ReinforcementCall>('ReinforcementCall');

/**
 * Emitted, untargeted, when a reinforcement fleet arrives. The display
 * puts "Sensors detect <name> reinforcement fleet approaching." on the
 * status line of every player in the system. `name` is the govt's
 * MediumName (reinforcementGovtName), read from the sim's staged govt so
 * the display needs no govt data of its own.
 */
export interface ReinforcementArrivalEventData {
    govt: string;
    name: string;
}
export const ReinforcementArrivalEventType = t.type({
    govt: t.string,
    name: t.string,
});
export const ReinforcementArrivalEvent =
    new EcsEvent<ReinforcementArrivalEventData>('ReinforcementArrivalEvent');
registerSimulationBridgeEvent({
    event: ReinforcementArrivalEvent,
    includeEntityUuids: false,
});

/**
 * Stages a system's reinforcement fleet: undefined when it has none
 * (ReinfFleet 0 / -1 parse as null), or when its flët has no govt (no
 * MaxOdds to call it by). Genesis only.
 */
export async function stageReinforcements(world: World,
    systemData: SystemData): Promise<ReinforcementFleet | undefined> {
    const reinforcements = systemData.reinforcements;
    const gameData = world.resources.get(SimulationGameDataResource);
    if (!reinforcements || !gameData) {
        return undefined;
    }
    const fleetData = await loadWithRetries(
        () => gameData.data.Fleet.get(reinforcements.fleet),
        `reinforcement flët ${reinforcements.fleet}`);
    if (!fleetData.govt) {
        return undefined;
    }
    const fleet = await stageFleetSpawn(world, fleetData);
    return {
        fleet,
        govt: fleetData.govt,
        delayMs: reinforcementDelayMs(reinforcements.delayFrames),
        intervalDays: reinforcements.regenerationDays,
    };
}

/** Installs a staged reinforcement fleet (stageReinforcements) in a
 * world being built: the static resource and the call's state entity. */
export function installReinforcements(world: World,
    reinforcements: ReinforcementFleet): void {
    world.resources.set(ReinforcementFleetResource, reinforcements);
    world.entities.set(REINFORCEMENTS_UUID, new Entity('reinforcements')
        .addComponent(ReinforcementCallComponent, {}));
}

/** Every ship, for the odds' sums. */
const OddsShipsQuery = new Query([UUID, ShipDataComponent,
    Optional(ShieldComponent), Optional(DisabledComponent),
    Optional(GovtComponent), Optional(NpcComponent)] as const);

/** Every player ship: the inhibitor. */
const PlayersQuery = new Query([UUID, ControlledByComponent,
    Optional(OutfitsStateComponent)] as const);

function shieldFraction(shield: { current: number, max: number } | undefined)
    : number {
    if (!shield || shield.max <= 0) {
        return 1;
    }
    return shield.current / shield.max;
}

function byUuid<T extends readonly [string, ...unknown[]]>(rows: readonly T[])
    : T[] {
    return [...rows].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

/** The pilot's day number (calendar.ts), 0 for a ship with no date. */
function today(entity: Entity | undefined): number {
    const date = entity?.components.get(GameDateComponent);
    return date ? dayNumber(date) : 0;
}

/** Whether `govt` (by id) is on the fleet govt's side: the same govt or
 * an ally either way (local_law.ts's alliedEitherWay). */
function onFleetSide(govt: string | undefined, fleetGovt: GovtData,
    getGovt: (id: string) => GovtData | undefined): boolean {
    if (govt === undefined) {
        return false;
    }
    if (govt === fleetGovt.id) {
        return true;
    }
    const data = getGovt(govt);
    return data !== undefined && alliedEitherWay(data, fleetGovt);
}

/**
 * Calls the system's reinforcement fleet when a player's hit on an NPC of
 * its govt's side turns the odds, a trader victim sending its distress
 * line with the call (see the module comment).
 */
export const ReinforcementCallSystem = new System({
    name: 'ReinforcementCallSystem',
    events: [DamagedEvent],
    args: [DamagedEvent, NpcComponent, UUID, Entities,
        Optional(GovtComponent), Optional(DisabledComponent),
        Optional(ShipDataComponent), Optional(MovementStateComponent),
        TimeResource, SimulationGameDataResource,
        Optional(ReinforcementFleetResource), Optional(SystemIdResource),
        OddsShipsQuery, PlayersQuery, RandomResource, Emit] as const,
    step({ damager }, npc, uuid, entities, govt, disabled, victimData,
        victimMovement, time, gameData, reinforcements, systemId, ships,
        players, random, emit) {
        if (!reinforcements || systemId === undefined || disabled
            || govt === undefined) {
            return;
        }
        // An anchored hull (Speed 0) never calls: its AI does not run on
        // the original (reference "R19 ..., wave 20", finding 1). KNOWN
        // MISMATCH: slow AI 1 hulls (Speed 20) never called either (wave
        // 21, finding 2) and call here; the rule is not understood, so
        // none is added (see the module comment).
        if (!victimData || victimData.physics.speed <= 0) {
            return;
        }
        const call = entities.get(REINFORCEMENTS_UUID)
            ?.components.get(ReinforcementCallComponent);
        if (!call || call.arriveAt !== undefined) {
            return;
        }
        const getEntity = (id: string) => entities.get(id);
        const source = responsibleShip(entities.get(damager), getEntity);
        if (source === undefined) {
            return;
        }
        const caller = getEntity(source)?.components.has(ControlledByComponent)
            ? source : flockPlayer(source, getEntity);
        if (caller === undefined || flockPlayer(uuid, getEntity) !== undefined) {
            return;
        }
        // getCached is deterministic here: makeSystem stages every gövt.
        const getGovt = (id: string) => gameData.data.Govt.getCached(id);
        const fleetGovt = getGovt(reinforcements.govt);
        if (!fleetGovt || !onFleetSide(govt.id, fleetGovt, getGovt)) {
            return;
        }
        const callerEntity = getEntity(caller);
        const lastDay = callerEntity?.components
            .get(ReinforcementCallsComponent)?.get(systemId);
        if (!reinforcementAvailable(lastDay, today(callerEntity),
            reinforcements.intervalDays)) {
            return;
        }
        for (const [, , outfits] of players) {
            for (const [outfitId] of outfits ?? []) {
                if (inhibitsReinforcements(
                    gameData.data.Outfit.getCached(outfitId), fleetGovt)) {
                    return;
                }
            }
        }
        let enemies = 0;
        let friends = 0;
        for (const [ship, shipData, shield, shipDisabled, shipGovt, npc]
            of byUuid(ships)) {
            if (shipDisabled) {
                continue;
            }
            const strength = effectiveStrength(shipData.strength,
                shieldFraction(shield));
            if (ship === caller || flockPlayer(ship, getEntity) === caller) {
                enemies += strength;
            } else if (npc && flockPlayer(ship, getEntity) === undefined
                && onFleetSide(shipGovt?.id, fleetGovt, getGovt)) {
                friends += strength;
            }
        }
        if (!reinforcementOddsCall(fleetGovt.maxOdds, enemies, friends)) {
            return;
        }
        call.arriveAt = time.time + reinforcements.delayMs;
        call.caller = caller;
        call.victim = uuid;
        const at = victimMovement?.position;
        call.center = { x: at?.x ?? 0, y: at?.y ?? 0 };
        // A trader victim says so (reference "R19 ..., wave 21", finding
        // 1): its distress line, as for an NPC's attack (npc_targeting.ts).
        const victimGovt = getGovt(govt.id);
        if (sendsDistressCalls(npc.aiType, victimGovt,
            victimData.inheritedNoGreetings,
            entities.get(uuid)?.components.has(MissionShipComponent))
            && distressCallDue(npc.distressAt, time.time)) {
            npc.distressAt = time.time;
            emit(DistressCallEvent, { ship: uuid, roll: random.next() });
        }
        // Only the caller is stamped, with his own day: the cooldown is
        // private to each pilot (Matthew's ruling, 2026-11-24). Replaced,
        // never mutated (the value may be shared with a traded-in hull,
        // PLAYER_STATE_COMPONENTS).
        if (callerEntity) {
            const calls = new Map(callerEntity.components
                .get(ReinforcementCallsComponent) ?? []);
            calls.set(systemId, today(callerEntity));
            callerEntity.components.set(ReinforcementCallsComponent, calls);
        }
    },
    // After the hit is applied (the odds read the victim's shield after
    // it: the measured call came at the FIRST hit, 100 against 46.5 + 50)
    // and after the NPC records its aggressor; last of the DamagedEvent
    // handlers (shared: *).
    after: [KnockbackSystem, NpcAggressionSystem, AsteroidDamageSystem],
});

/** Every NPC, for the arrival's hostility test. */
const AggressorsQuery = new Query([UUID, NpcComponent,
    Optional(GovtComponent)] as const);

/**
 * The kinematics of a reinforcement fleet's lead coming in around
 * `center`: REINFORCEMENT_ARRIVAL_DISTANCE out on a bearing drawn from
 * `random` (one draw), heading for `center` at `speed`. Measured: the
 * original's blips came 1,770-1,960 px out on random bearings, flying in;
 * the heading and speed are a GUESS.
 */
export function reinforcementArrivalState(center: { x: number, y: number },
    speed: number, random: { next(): number }) {
    const bearing = new Angle(random.next() * 2 * Math.PI);
    const outward = bearing.getUnitVector();
    const inward = outward.scale(-1);
    return {
        position: new Position(
            center.x + outward.x * REINFORCEMENT_ARRIVAL_DISTANCE,
            center.y + outward.y * REINFORCEMENT_ARRIVAL_DISTANCE),
        rotation: inward.angle,
        velocity: inward.scale(speed),
    };
}

/**
 * Whether the ship that called the fleet has left the system: gone from
 * the world (jumped out, landed, destroyed, boarded and taken) or in its
 * death sequence. A call without a victim counts as still there.
 */
function victimHasLeft(victim: string | undefined,
    getEntity: (id: string) => Entity | undefined): boolean {
    if (victim === undefined) {
        return false;
    }
    const entity = getEntity(victim);
    return !entity || entity.components.has(ExplodingComponent);
}

/**
 * Brings a called fleet in when its time comes (see the module comment):
 * cancels it when the victim has left, else spawns it around the victim's
 * position at the call, holds it in the system, sets it on the caller
 * when he is still fighting the govt's side, and tells the players.
 */
export const ReinforcementArrivalSystem = new System({
    name: 'ReinforcementArrivalSystem',
    args: [ReinforcementCallComponent, TimeResource, GetWorld,
        RandomResource, IdFactoryResource, SimulationGameDataResource,
        Optional(ReinforcementFleetResource), Entities, AggressorsQuery,
        Emit] as const,
    step(call, time, world, random, ids, gameData, reinforcements, entities,
        aggressors, emit) {
        if (call.arriveAt === undefined || time.time < call.arriveAt) {
            return;
        }
        const { caller, victim, center } = call;
        delete call.arriveAt;
        delete call.caller;
        delete call.victim;
        delete call.center;
        if (!reinforcements) {
            return;
        }
        const getEntity = (id: string) => entities.get(id);
        // The victim left before the arrival: no fleet (the caller's day
        // stays spent).
        if (victimHasLeft(victim, getEntity)) {
            return;
        }
        const fleetGovt = gameData.data.Govt.getCached(reinforcements.govt);
        const leadData = gameData.data.Ship.getCached(
            reinforcements.fleet.leadShip);
        if (!fleetGovt || !leadData) {
            // Staged at genesis, so a miss is the same on every world.
            return;
        }
        const getGovt = (id: string) => gameData.data.Govt.getCached(id);
        const callerEntity = caller !== undefined
            ? getEntity(caller) : undefined;
        // Whether the caller is still fighting the govt's side: some NPC of
        // it holds him, or a ship of his flock, as its aggressor.
        const fighting = caller !== undefined && callerEntity !== undefined
            && aggressors.some(([, npc, govt]) =>
                npc.aggressor !== undefined
                && onFleetSide(govt?.id, fleetGovt, getGovt)
                && (npc.aggressor === caller
                    || flockPlayer(npc.aggressor, getEntity) === caller));
        const fleet = spawnFleet(world, gameData, ids, random,
            reinforcements.fleet, leadData,
            reinforcementArrivalState(center ?? { x: 0, y: 0 },
                leadData.physics.speed, random));
        for (const ship of fleet) {
            const entity = getEntity(ship);
            entity?.components.set(SystemHoldComponent,
                { reason: 'reinforcement' });
            const npc = entity?.components.get(NpcComponent);
            if (npc && fighting) {
                npc.aggressor = caller;
                npc.aggressorSince = time.time;
            }
        }
        emit(ReinforcementArrivalEvent, {
            govt: fleetGovt.id,
            name: reinforcementGovtName(fleetGovt),
        });
    },
    // Spawns NPCs like the traffic's respawn, and runs right after it
    // (shared: *; MissionShipTrackSystem follows both).
    after: [TimeSystem, NpcRespawnSystem],
});

export const ReinforcementsPlugin: Plugin = {
    name: 'ReinforcementsPlugin',
    build(world) {
        const serializer = world.resources.get(SerializerResource);
        serializer?.addComponent(ReinforcementCallComponent,
            ReinforcementCallType);
        serializer?.addEvent(ReinforcementArrivalEvent,
            ReinforcementArrivalEventType);
        world.addSystem(ReinforcementCallSystem);
        world.addSystem(ReinforcementArrivalSystem);
    },
};
