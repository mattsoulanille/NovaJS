import * as t from 'io-ts';
import { GovtData } from 'novadatainterface/govt_data';
import { OutfitData } from 'novadatainterface/outfit_data';
import { SystemData } from 'novadatainterface/system_data';
import { Emit, Entities, GetWorld, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position, wrapNearestDelta } from 'nova_ecs/datatypes/position';
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
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { registerSimulationBridgeEvent } from '../../communication/simulation_bridge_events.js';
import {
    GovtComponent, IdFactoryResource, loadWithRetries,
    SimulationGameDataResource, SystemIdResource,
} from '../core/index.js';
import {
    flockPlayer, NpcAggressionSystem, NpcAttackStartEvent, NpcComponent,
    responsibleShip, SystemHoldComponent,
} from '../npc/index.js';
import {
    ControlledByComponent, dayNumber, GameDateComponent,
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
 * reinforcement fleets, wave 19" through "..., wave 22", "R19 wave 24",
 * "R19 wave 26" and "R19 arrival centre, wave 26"):
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
 *    it came in 1,840-1,960 px out (wave 20). Nor to the victim: with both
 *    beside a port 3,000 px from the system's centre it came in 1,650 to
 *    2,600+ px from them, on the centre's side, about 1,500-1,800 px from
 *    the centre, and flew toward the centre first (wave 26, two runs);
 *  - an ANCHORED victim (hull Speed 0) never calls, its AI does not run;
 *    a victim that jumped out before the arrival got no fleet (wave 20,
 *    one run; wave 21 reread it as no call at all, below);
 *  - an AI 1 / AI 2 victim calls only when the player hits it from NEAR
 *    (wave 22, finding 1: seven calls from 40-475 px, none from about
 *    700, 815, 925 and 1,080 px, however deep the shield went), whatever
 *    its speed or the day; an AI 4 victim called from 1,600+ px (wave 21,
 *    one run) and from 40 px (wave 22);
 *  - an ARMED AI 3 victim that stayed and fought called, three of three,
 *    from 86 px, 89 px and about 1,100 px, with the usual delay (wave
 *    26); the three UNARMED AI 3 victims before it (wave 22's `ai3_near`,
 *    wave 24's two), hit once from 57-90 px, were gone ("No Target")
 *    within about 2-10 s with no fleet, no "Sensors detect" and no
 *    distress line in 40+ s;
 *  - the call needs no hit: with an NPC of the fleet's govt attacking the
 *    player at once (a mïsn ShipBehav 0 guard by the port), the fleet came
 *    ReinfTime after the take-off, twice, once with the player never
 *    firing at all (wave 26);
 *  - the distress line is NOT the call (wave 22, finding 3): seven near
 *    calls came with no line, and a far hit drew a line with no fleet
 *    (3 of 20 trader victims over waves 21-22 sent one: a separate
 *    chance, not modelled). Wave 21's "no line, no fleet" was the
 *    distance;
 *  - a victim whose govt sets Flags2 0x0008 "don't send distress
 *    messages" still calls (wave 22, finding 5);
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
 * THE CALL (considerCall) comes from a fight between an NPC of the fleet's
 * side (the call's victim) and a PLAYER's ship or a ship of a player's
 * flock (GUESS: an escort counts as its player's), on either of two
 * triggers:
 *  - A HIT (ReinforcementCallSystem, off DamagedEvent after the damage is
 *    applied): the player's ship is the hit's responsible ship, the victim
 *    the NPC hit;
 *  - AN ATTACK (ReinforcementAttackCallSystem, off NpcDecisionSystem's
 *    NpcAttackStartEvent): the NPC STARTS attacking the player's ship, and
 *    the attacker is the victim. GUESS on the trigger (reference "R19
 *    arrival centre, wave 26", finding 2, two runs): the moment the NPC's
 *    brain goes into 'attack' on that ship, not its first shot (the
 *    measured call followed the take-off by the bare delay, the attacker
 *    beside the player, so the earliest reading). Each new attack checks
 *    once; re-deciding to keep fighting the same ship does not.
 * The victim must be an NPC that is not disabled (GUESS: a hulk is out of
 * the fight), not anchored (hull Speed 0: MEASURED, wave 20, it never
 * calls) and not in a player's flock, of the fleet's govt or one allied
 * with it either way (MEASURED for an ally's ship hit, wave 20: it calls
 * the fleet govt's fleet, with that govt's MediumName; GUESS for an
 * ally's attacker). It calls the fleet when
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
 *    is not modelled. GUESSES: the whole system, no range, for the
 *    odds' sums; "exceed" as strictly greater);
 *  - a TRADER victim (AI 1 / AI 2) is within
 *    REINFORCEMENT_TRADER_CALL_RANGE of the player's ship in the fight
 *    (MEASURED for hits: 475 px calls, 700 does not; the 600 px between
 *    them is a GUESS, and so is measuring from the responsible ship, an
 *    escort's own distance for its hit, and applying it to an attacking
 *    trader). WARSHIP (AI 3) and INTERCEPTOR (AI 4) victims have no range
 *    (MEASURED: AI 4 from 1,600+ px once and from 40 px; an armed AI 3
 *    from 86-89 px and about 1,100 px, wave 26, medium confidence for
 *    the far point). The unarmed AI 3 victims of waves 22-24 that left at
 *    once are left to the cancel below (GUESS: "an AI 3 with no weapons
 *    never calls" fits them too).
 * Wave 21's "slow AI 1 hulls never call" was this range (they were hit
 * from far), not their speed. The call sends no distress line: the
 * player's own victims stay silent, as npc/distress.ts has it
 * (MEASURED, wave 22: the line is a separate chance, not modelled).
 * An NPC's hit never calls it, nor does an NPC's attack on another NPC,
 * and nothing calls it ON a player's behalf (the ränk 0x0400 "call in
 * reinforcements on the player's behalf" did not happen on the original).
 *
 * THE COOLDOWN: per pilot, per system (ReinforcementCallsComponent, on the
 * player's ship, saved with the pilot). A call stamps ONLY the caller (the
 * pilot whose hit, or whose flock's hit, called it, or the pilot whose
 * ship, or flock's ship, the attacker went for) with his own date's
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
 * SYSTEM'S CENTRE (REINFORCEMENT_ARRIVAL_CENTER) on a random bearing,
 * heading for the centre at the lead's top speed, and every player in the
 * system is told (ReinforcementArrivalEvent; the display's status line).
 * MEASURED, medium confidence (reference "R19 arrival centre, wave 26",
 * two runs): with the victim and the player 3,000 px from the centre the
 * fleet came in on the centre's side, 1,650-2,600+ px from them, and
 * first flew toward the centre; every earlier arrival had the victim at
 * the centre. Not the player, not the victim. The distance and the random
 * bearing are measured (1,770-1,960 px from a victim at the centre, two
 * bearings; about 1,500-1,650 px from the centre in wave 26's direct
 * read); the speed is a GUESS.
 *
 * THE VICTIM LEAVING (a GUESS): a pending call is CANCELLED when the
 * victim (the call's `victim`) is no longer in the system at the
 * arrival: it jumped out, landed, or was destroyed (a ship in its death
 * sequence included). The call is read as the victim's own, so any way of
 * leaving the system takes it along. Wave 20's one run (an AI 1 victim
 * jumped 10.4 s after the hit, no fleet came) was reread in wave 21 as NO
 * CALL at all (hit from far, wave 22). Since wave 26 it is what keeps the
 * UNARMED AI 3 victims of waves 22-24 (gone within about 2-10 s of the
 * hit, no fleet) from getting a fleet now that an AI 3 calls: a reading
 * those runs fit but do not prove. The caller's day stamp stays spent
 * either way (the call was made).
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
 * govt, every gövt and ränk: makeSystem), the seeded Random (at the
 * arrival: one draw for the bearing, then the escort counts), sums in
 * uuid order, the range as a squared distance; the victim's presence is
 * read from the synced entity map. NpcAttackStartEvent is emitted from
 * NpcDecisionSystem's synced mode / target change, in its query order,
 * and handled after the step's systems (the ECS event queue, FIFO).
 */

/**
 * ReinfTime's unit, per second. MEASURED (reference "R19 reinforcement
 * fleets, wave 20", finding 3): the delay is ReinfTime / 39 s, linear and
 * with NO cap, at every measured point (300 -> 7.7 s, the mean of seven
 * one-hit runs; 600 -> 15.2; 900 -> 23-25, wave 19; 1800 -> 45.7-46.8).
 * That is NOT the Bible's "A value of 30 = one second" (about 0.77 of it).
 */
export const REINFORCEMENT_FRAMES_PER_SECOND = 39;

/**
 * How near the hit's responsible ship must be to a TRADER victim (AI 1 /
 * AI 2) for its call, px. MEASURED bounds (reference "R19 reinforcement
 * fleets, wave 22", finding 1): calls from 40-475 px (seven runs), none
 * from about 700 px and beyond (four runs, one three hits deep). 600 px
 * is a GUESS between the two.
 */
export const REINFORCEMENT_TRADER_CALL_RANGE = 600;

/** Whether a fight between a victim of this aiType and a player's ship
 * `distance` px away may call the fleet: a trader (AI 1 / AI 2) only from
 * within REINFORCEMENT_TRADER_CALL_RANGE, a warship (AI 3) or an
 * interceptor (AI 4) from anywhere (reference "R19 wave 26": an ARMED AI
 * 3 victim called from 86 px, 89 px and about 1,100 px). An unknown
 * distance (a shooter with no position) does not block the call. */
export function reinforcementCallInRange(aiType: number,
    distanceSquared: number | undefined): boolean {
    if (aiType !== 1 && aiType !== 2) {
        return true;
    }
    return distanceSquared === undefined || distanceSquared
        <= REINFORCEMENT_TRADER_CALL_RANGE * REINFORCEMENT_TRADER_CALL_RANGE;
}

/** How far from REINFORCEMENT_ARRIVAL_CENTER the fleet comes in, px.
 * MEASURED: a blip 1,770 px out (wave 19), 1,840 and 1,960 px (wave 20),
 * on random bearings, with the victim and the player by a port at the
 * system's centre; about 1,500-1,650 px from the centre with both 3,000 px
 * away (wave 26, `farm3`; `farm2` 2,600+ px from them, beyond the centre). */
export const REINFORCEMENT_ARRIVAL_DISTANCE = 1_800;

/** Where the fleet comes in around: the SYSTEM'S CENTRE. MEASURED,
 * medium confidence (reference "R19 arrival centre, wave 26", two runs):
 * with the victim and the player beside a port 3,000 px east of the
 * centre, the fleet's first blip was 1,650-2,600+ px from them, on the
 * centre's side, and it flew toward the centre first. Every earlier
 * arrival (waves 19-20) had the victim at the centre, so fits this too. */
export const REINFORCEMENT_ARRIVAL_CENTER: Readonly<{ x: number, y: number }>
    = { x: 0, y: 0 };

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
    /** The player ship whose hit (or whose flock's), or whom an NPC's
     * attack, called it. */
    caller: t.string,
    /** The NPC of the fleet's side that called it: the one hit, or the
     * attacker. The call is cancelled when it has left the system before
     * the arrival. */
    victim: t.string,
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

/** A row of OddsShipsQuery: uuid, ShipData, shield, disabled, govt, npc. */
type OddsShip = readonly [string, { strength: number },
    { current: number, max: number } | undefined, unknown,
    { id: string } | undefined, unknown];
/** A row of PlayersQuery: uuid, ControlledBy, outfits. */
type CallPlayer = readonly [string, unknown,
    ReadonlyMap<string, unknown> | undefined];

/** What a call reads from the world: the two call systems' shared args. */
interface CallContext {
    getEntity: (id: string) => Entity | undefined;
    now: number;
    gameData: SimulationGameDataInterface;
    reinforcements: ReinforcementFleet;
    systemId: string;
    ships: readonly OddsShip[];
    players: readonly CallPlayer[];
}

/**
 * The one call decision, for a hit (ReinforcementCallSystem) and for an
 * attack (ReinforcementAttackCallSystem): `side`, an NPC that may be on
 * the fleet's side, is in a fight with `opponent`, a ship that may be a
 * player's or his flock's (the hit's responsible ship, or the ship the NPC
 * starts attacking). Calls the fleet, with `side` as the call's victim and
 * the opponent's player as its caller, when every test of the module
 * comment's THE CALL passes; otherwise changes nothing. Synced state,
 * staged caches and uuid-ordered sums only; no PRNG draw.
 */
function considerCall(side: string, opponent: string, context: CallContext)
    : void {
    const { getEntity, gameData, reinforcements, systemId } = context;
    const sideEntity = getEntity(side);
    const npc = sideEntity?.components.get(NpcComponent);
    const govt = sideEntity?.components.get(GovtComponent);
    if (!sideEntity || !npc || govt === undefined
        || sideEntity.components.has(DisabledComponent)) {
        return;
    }
    // An anchored hull (Speed 0) never calls: its AI does not run on
    // the original (reference "R19 ..., wave 20", finding 1). A slow
    // one does, when hit from near (wave 22, finding 1).
    const sideData = sideEntity.components.get(ShipDataComponent);
    if (!sideData || sideData.physics.speed <= 0) {
        return;
    }
    const call = getEntity(REINFORCEMENTS_UUID)
        ?.components.get(ReinforcementCallComponent);
    if (!call || call.arriveAt !== undefined) {
        return;
    }
    const caller = getEntity(opponent)?.components.has(ControlledByComponent)
        ? opponent : flockPlayer(opponent, getEntity);
    if (caller === undefined || flockPlayer(side, getEntity) !== undefined) {
        return;
    }
    // A trader calls only when its opponent is near (reference "R19 ...,
    // wave 22", finding 1), measured from the opponent's ship (for a hit,
    // the responsible ship); warships and interceptors from anywhere.
    const at = sideEntity.components.get(MovementStateComponent)?.position;
    const from = getEntity(opponent)?.components
        .get(MovementStateComponent)?.position;
    const distanceSquared = at && from
        ? wrapNearestDelta(from.x - at.x) ** 2
            + wrapNearestDelta(from.y - at.y) ** 2 : undefined;
    if (!reinforcementCallInRange(npc.aiType, distanceSquared)) {
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
    for (const [, , outfits] of context.players) {
        for (const [outfitId] of outfits ?? []) {
            if (inhibitsReinforcements(
                gameData.data.Outfit.getCached(outfitId), fleetGovt)) {
                return;
            }
        }
    }
    let enemies = 0;
    let friends = 0;
    for (const [ship, shipData, shield, shipDisabled, shipGovt, shipNpc]
        of byUuid(context.ships)) {
        if (shipDisabled) {
            continue;
        }
        const strength = effectiveStrength(shipData.strength,
            shieldFraction(shield));
        if (ship === caller || flockPlayer(ship, getEntity) === caller) {
            enemies += strength;
        } else if (shipNpc && flockPlayer(ship, getEntity) === undefined
            && onFleetSide(shipGovt?.id, fleetGovt, getGovt)) {
            friends += strength;
        }
    }
    if (!reinforcementOddsCall(fleetGovt.maxOdds, enemies, friends)) {
        return;
    }
    call.arriveAt = context.now + reinforcements.delayMs;
    call.caller = caller;
    call.victim = side;
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
}

/**
 * Calls the system's reinforcement fleet when a player's hit on an NPC of
 * its govt's side turns the odds, a trader victim only when hit from near
 * (see the module comment).
 */
export const ReinforcementCallSystem = new System({
    name: 'ReinforcementCallSystem',
    events: [DamagedEvent],
    args: [DamagedEvent, NpcComponent, UUID, Entities, TimeResource,
        SimulationGameDataResource, Optional(ReinforcementFleetResource),
        Optional(SystemIdResource), OddsShipsQuery, PlayersQuery] as const,
    step({ damager }, _npc, uuid, entities, time, gameData, reinforcements,
        systemId, ships, players) {
        if (!reinforcements || systemId === undefined) {
            return;
        }
        const getEntity = (id: string) => entities.get(id);
        const source = responsibleShip(entities.get(damager), getEntity);
        if (source === undefined) {
            return;
        }
        considerCall(uuid, source, {
            getEntity, now: time.time, gameData, reinforcements, systemId,
            ships, players,
        });
    },
    // After the hit is applied (the odds read the victim's shield after
    // it: the measured call came at the FIRST hit, 100 against 46.5 + 50)
    // and after the NPC records its aggressor; last of the DamagedEvent
    // handlers (shared: *).
    after: [KnockbackSystem, NpcAggressionSystem, AsteroidDamageSystem],
});

/**
 * Calls the system's reinforcement fleet when an NPC of its govt's side
 * STARTS attacking a player's ship, or a ship of his flock, and the odds
 * pass: the same tests as a hit (considerCall), with the attacker as the
 * call's victim. Reference "R19 arrival centre, wave 26", finding 2: the
 * call came ReinfTime after the take-off with no hit at all, an attacking
 * guard (mïsn ShipBehav 0) beside the player. The trigger,
 * NpcDecisionSystem's NpcAttackStartEvent, is a GUESS (see the module
 * comment).
 */
export const ReinforcementAttackCallSystem = new System({
    name: 'ReinforcementAttackCallSystem',
    events: [NpcAttackStartEvent],
    args: [NpcAttackStartEvent, NpcComponent, UUID, Entities, TimeResource,
        SimulationGameDataResource, Optional(ReinforcementFleetResource),
        Optional(SystemIdResource), OddsShipsQuery, PlayersQuery] as const,
    step({ attacker, target }, _npc, uuid, entities, time, gameData,
        reinforcements, systemId, ships, players) {
        if (!reinforcements || systemId === undefined || attacker !== uuid) {
            return;
        }
        considerCall(uuid, target, {
            getEntity: id => entities.get(id), now: time.time, gameData,
            reinforcements, systemId, ships, players,
        });
    },
});

/** Every NPC, for the arrival's hostility test. */
const AggressorsQuery = new Query([UUID, NpcComponent,
    Optional(GovtComponent)] as const);

/**
 * The kinematics of a reinforcement fleet's lead coming in around
 * `center`: REINFORCEMENT_ARRIVAL_DISTANCE out on a bearing drawn from
 * `random` (one draw), heading for `center` at `speed`. Measured: the
 * original's blips came 1,770-1,960 px out on random bearings, flying in,
 * and wave 26's (`farm3`) first moved toward the system's centre, then
 * turned for the player; the speed is a GUESS. The arrival passes
 * REINFORCEMENT_ARRIVAL_CENTER.
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
 * cancels it when the victim has left, else spawns it around the system's
 * centre, holds it in the system, sets it on the caller
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
        const { caller, victim } = call;
        delete call.arriveAt;
        delete call.caller;
        delete call.victim;
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
            reinforcementArrivalState(REINFORCEMENT_ARRIVAL_CENTER,
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
        world.addSystem(ReinforcementAttackCallSystem);
        world.addSystem(ReinforcementArrivalSystem);
    },
};
