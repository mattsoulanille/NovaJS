import { Entity } from 'nova_ecs/entity';
import * as t from 'io-ts';
import { GovtData } from "novadatainterface/govt_data";
import { PlanetData } from "novadatainterface/planet_data";
import { RankData } from "novadatainterface/rank_data";
import { ShipData } from "novadatainterface/ship_data";
import { Emit, Entities, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { map } from 'nova_ecs/datatypes/map';
import { EcsEvent } from 'nova_ecs/events';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { MovementStateComponent, MovementSystem } from 'nova_ecs/plugins/movement_plugin';
import { Position } from 'nova_ecs/datatypes/position';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { Provide } from 'nova_ecs/provide';
import { World } from 'nova_ecs/world';
import { landable, UpdateHitboxHullSystem, UpdateHurtboxHullSystem } from '../core/index.js';
import { ProvideFromCache } from '../core/index.js';
import { registerEntityDeriver } from '../core/index.js';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import { registerSimulationBridgeEvent } from '../../communication/simulation_bridge_events.js';
import { AnimationComponent, ExplosionAnimationProvider } from '../core/index.js';
import { ControlAction } from '../core/index.js';
import { findControlledEntity, ShipControlEvent, ShipControlStateComponent } from '../player/index.js';
import { SimulationGameDataResource } from '../core/index.js';
import { gameDataRefType } from '../core/index.js';
import { SystemIdResource } from '../core/index.js';
import { PlayerShipSelector } from '../player/index.js';
import { ExplodingFinishedSystem, ShipComponent, ShipDataComponent } from '../ship/index.js';
import { Target } from '../ship/index.js';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { OutfitsState, OutfitsStateComponent } from '../ship/index.js';
import { LegalRecords, statusGovtOf } from '../reputation/index.js';
import { GovtsResource, LegalRecordsComponent } from '../reputation/index.js';
import { ActiveRanks, ActiveRanksComponent } from '../ncb/index.js';
import { ranksAllowLanding } from '../ncb/index.js';
import { Missions, MissionsComponent } from '../player/index.js';
import {
    avalanche, contributeBits, hashString, isMissionDestination,
    planetClearance, StellarClearance,
} from '../reputation/index.js';
import { displayName } from '../core/index.js';
import { JumpComponent } from './jump_state.js';

export const PlanetType = t.type({
    id: t.string // Not a UUID. A nova id.
});
export type PlanetType = t.TypeOf<typeof PlanetType>;

export const PlanetComponent = new Component<PlanetType>('Planet');

export const PlanetDataComponent = new Component<PlanetData>('PlanetData');

function derivePlanetData(gameData: SimulationGameDataInterface, planet: { id: string }) {
    return gameData.data.Planet.getCached(planet.id);
}

export const PlanetDataProvider = ProvideFromCache({
    name: "PlanetDataProvider",
    provided: PlanetDataComponent,
    args: [SimulationGameDataResource, PlanetComponent] as const,
    factory: derivePlanetData,
    // #237 pin: the pair no longer shares state (the provider declares
    // its write with SetComponent now), but the edge carries the
    // transitive order — PlanetPlugin registers before DeathPlugin.
    before: [ExplodingFinishedSystem],
});

/**
 * A ship's selected stellar (`target`, the stellar entity's uuid) and
 * where the ship stands with that stellar's traffic control. Hypergates,
 * planets and stations alike (reference "Hypergates, wave 30" and "Planet
 * and station clearance, wave 31": the same two zones at all three;
 * wormholes have no clearance step):
 *
 * - `cleared` holds the uuid of the stellar whose CLEARANCE the ship
 *   holds (a gate's STR# 2002 #91-93, a station's #94-96, a planet's
 *   #97-99). The clearance is what lets the next `l` inside the stellar's
 *   landing window (stellarLandingRange) land, dock or enter the gate, and
 *   at a gate what OPENS it (display/gate_animation_plugin.ts); a request
 *   line outside the clearance zone clears nothing (reference "Hypergate
 *   `l` range and the request lines, wave 29").
 * - `clearedUntil`, with a clearance: the sim time (ms) it lapses at
 *   (STELLAR_CLEARANCE_MS after it was given, one clock for ports,
 *   stations and hypergates; reference "Landing clearance lapse, wave
 *   32", findings 1 and 3, and "..., wave 36", findings 1-5). A lapsed
 *   clearance is not honoured,
 *   and the next press starts over; the lapse itself is silent and leaves
 *   no request behind (wave 32, findings 2 and 4). A clearance stored
 *   without one (a snapshot from before wave 32) never lapses.
 * - `requested` holds the uuid of the stellar whose REQUEST line the
 *   ship's selecting `l` drew from outside the clearance zone and that
 *   has not cleared it yet: the ship that then comes inside the zone is
 *   cleared with no press (StellarAutoClearanceSystem; reference
 *   "Hypergates, wave 30", finding 3; "Planet and station clearance, wave
 *   31", finding 2), once, and the field is dropped.
 *
 * Each counts only while it equals `target` (see {@link holdsClearance}),
 * and any write that changes the selection drops them (selectPlanetTarget).
 *
 * OPTIONAL and absent until traffic control answers the ship, so ships
 * that never press `l` keep their components and hash inputs unchanged.
 * Synced sim state (delta-registered below), written only by
 * AttemptLandingSystem on the tick every peer applies the `l` press and by
 * StellarAutoClearanceSystem on the tick the ship enters the zone.
 */
export const PlanetTargetType = t.intersection([
    Target,
    t.partial({
        cleared: t.string, clearedUntil: t.number, requested: t.string,
    }),
]);
export type PlanetTarget = t.TypeOf<typeof PlanetTargetType>;

export const PlanetTargetComponent =
    new Component<PlanetTarget>('PlanetTargetComponent');

/**
 * Whether the ship holds a clearance at its selected stellar at sim time
 * `now`: until its `clearedUntil` (a gate's, a planet's or a station's
 * alike).
 */
export function holdsClearance(planetTarget: PlanetTarget | undefined,
    now: number): boolean {
    return planetTarget?.target !== undefined
        && planetTarget.cleared === planetTarget.target
        && (planetTarget.clearedUntil === undefined
            || now < planetTarget.clearedUntil);
}

/**
 * Whether the ship holds a hypergate clearance at its selected stellar at
 * sim time `now` (what opens the gate, display/gate_animation_plugin.ts).
 * A gate's clearance lapses on the planets' clock (reference "Landing
 * clearance lapse, wave 32", finding 3), so this is {@link holdsClearance}
 * by another name: the caller knows the stellar is a gate.
 */
export function holdsGateClearance(planetTarget: PlanetTarget | undefined,
    now: number): boolean {
    return holdsClearance(planetTarget, now);
}

/** Whether the ship's clearance at its selected stellar has LAPSED by
 * `now` (STELLAR_CLEARANCE_MS after it was given). */
export function clearanceLapsed(planetTarget: PlanetTarget | undefined,
    now: number): boolean {
    return planetTarget?.target !== undefined
        && planetTarget.cleared === planetTarget.target
        && planetTarget.clearedUntil !== undefined
        && now >= planetTarget.clearedUntil;
}

/** Whether the ship holds a standing REQUEST (not yet cleared) at its
 * selected stellar. */
export function holdsRequest(planetTarget: PlanetTarget | undefined):
    boolean {
    return planetTarget?.target !== undefined
        && planetTarget.requested === planetTarget.target;
}

/**
 * Selects `target` (or nothing) on a PlanetTargetComponent, dropping a
 * clearance or request held at a different stellar. Every in-sim writer
 * of the selection goes through this, so a stale `cleared` /
 * `clearedUntil` / `requested` never lingers in the synced (hashed) state.
 */
export function selectPlanetTarget(planetTarget: PlanetTarget,
    target: string | undefined) {
    planetTarget.target = target;
    if (planetTarget.cleared !== undefined
        && planetTarget.cleared !== target) {
        delete planetTarget.cleared;
        delete planetTarget.clearedUntil;
    }
    if (planetTarget.requested !== undefined
        && planetTarget.requested !== target) {
        delete planetTarget.requested;
    }
}

const PlanetTargetProvider = Provide({
    name: "PlanetTargetProvider",
    provided: PlanetTargetComponent,
    args: [ShipComponent] as const,
    factory: (): PlanetTarget => ({ target: undefined }),
    // #237 pin: the pair no longer shares state (the providers declare
    // their writes with SetComponent now), but the edge carries the
    // providers' transitive order — PlanetPlugin registers after core's
    // AnimationPlugin.
    after: [ExplosionAnimationProvider],
});

export const LandEvent = new EcsEvent<{ id: string, uuid: string }>('LandEvent');
export const LandEventType = t.type({
    id: t.string,
    uuid: t.string,
});

registerSimulationBridgeEvent({ event: LandEvent });

/**
 * Emitted (targeted at the player's ship) when the player presses 'land'
 * with a stellar already selected and the landing is refused. The reason
 * drives the original's on-screen feedback: "You're too far away to..." /
 * "You're moving too fast to..." for the landing window, and "Your ship is
 * unable to..." for a stellar that is not a port at all (`unlandable` —
 * see landable.ts). Consumed display-side by the status line
 * (status_message_plugin.ts). Never mutates the simulation.
 *
 * `stellarName` is only meaningful for `unlandable`, whose message names the
 * stellar, and `denied`. `gateKind` rides with every reason a gate refuses:
 * `unlandable`, `denied` (a hypergate says "Hypergate usage denied.") and the
 * window reasons, whose gate lines read "... enter this hypergate." /
 * "... enter this wormhole." (reference "Gate approach lines, wave 25").
 * Both are optional, absent for a planet or station.
 */
/** Why a land attempt was refused (see LandingBlockedEvent). Closed: the
 * event is sim-to-display within one build, never persisted. */
export const LandingBlockReasonType = t.keyof({
    tooFar: null, tooFast: null, unlandable: null, denied: null,
});
export type LandingBlockReason = t.TypeOf<typeof LandingBlockReasonType>;
/** Which kind of gate a refusing stellar is, when it is one. */
export const GateKindType = t.keyof({ hypergate: null, wormhole: null });
export type GateKind = t.TypeOf<typeof GateKindType>;
export const LandingBlockedEventType = t.intersection([
    t.type({
        reason: LandingBlockReasonType,
        isStation: t.boolean,
    }),
    t.partial({
        stellarName: t.string,
        gateKind: GateKindType,
    }),
]);
export type LandingBlocked = t.TypeOf<typeof LandingBlockedEventType>;
export const LandingBlockedEvent =
    new EcsEvent<LandingBlocked>('LandingBlockedEvent');

/** Which kind of stellar a landing request or clearance line names. */
export const LandingRequestKindType = t.keyof({
    hypergate: null, station: null, planet: null,
});
export type LandingRequestKind = t.TypeOf<typeof LandingRequestKindType>;

/**
 * Emitted (targeted at the player's ship) when traffic control CLEARS the
 * player: a working hypergate, a port or a station, when the ship is
 * inside the stellar's CLEARANCE zone (STELLAR_CLEARANCE_RANGE, a 249 px
 * square whatever the art): on the `l` that selects the stellar there (or
 * a later `l` there after a click or number-key selection, or after a
 * clearance lapsed), or with no press at all when a ship that holds a
 * request comes inside the zone (`automatic`; reference "Hypergates, wave
 * 30", finding 3; "Planet and station clearance, wave 31", findings 1-2).
 * The emitter also records the clearance (PlanetTarget `cleared`), which
 * opens a gate and lets the next `l` inside the landing window land.
 *
 * The line: a gate's is one of STR# 2002 one-based 91-93 ("You are cleared
 * for hypergate entry." etc.; reference "Gate map, wave 27"), the form
 * picked display-side (#91 when `automatic`); a station's or planet's is
 * #94-96 / #97-99 ("Cleared to dock" / "<ship>, you're cleared to land."
 * / "You are cleared to land.") then #100 "Commence final approach." or
 * #101 "Welcome to <port>.", the two pieces drawn in the sim by salted
 * hash (`form` 0..2, `welcome`: {@link stellarClearedForm}) and carried
 * here with `stellarName`. A stellar that refuses the player emits
 * LandingBlockedEvent 'denied' instead. Consumed display-side by the
 * status line (status_message_plugin.ts). The event itself carries no
 * state.
 */
export const LandingClearedEventType = t.intersection([
    t.type({ kind: LandingRequestKindType }),
    t.partial({
        /** Cleared on entering the zone with a standing request, no press
         * (a gate's line is then #91: GUESS that it always is, one run). */
        automatic: t.boolean,
        /** A port's or station's display name, for #101 "Welcome to". */
        stellarName: t.string,
        /** A port's or station's first piece, 0..2 for #97..99 (#94..96). */
        form: t.number,
        /** A port's or station's tail is #101 "Welcome to <port>." rather
         * than #100 "Commence final approach.". */
        welcome: t.boolean,
    }),
]);
export type LandingCleared = t.TypeOf<typeof LandingClearedEventType>;
export const LandingClearedEvent =
    new EcsEvent<LandingCleared>('LandingClearedEvent');
export const LandingRequestEventType = t.intersection([
    t.type({
        kind: LandingRequestKindType,
        /** The stellar's display name (a port's or station's own form). */
        stellarName: t.string,
        /** Which form of the line, 0..3 ({@link LANDING_REQUEST_FORMS}):
         * bit 0 adds the ship's name, bit 1 picks a port's or station's
         * second phrase. A salted hash, never Math.random. */
        form: t.number,
    }),
    t.partial({
        /** A hypergate's phrase drew "Hypergate is online" (#75) for "is
         * energized" (#74): {@link hypergateRequestOnline}. */
        online: t.boolean,
    }),
]);
export type LandingRequest = t.TypeOf<typeof LandingRequestEventType>;
/**
 * Emitted (targeted at the player's ship) when the press that SELECTS a
 * stellar (or the first press after its clearance lapsed) finds the ship
 * outside its clearance zone and the stellar would take it: traffic
 * control acknowledges the request, one of STR# 2002 one-based 74-79 + 80
 * "Begin initial approach." ("Hypergate is energized, <ship>. Begin
 * initial approach.", "<port> traffic control reads you. Begin initial
 * approach.", "Docking request received, <ship>. Begin initial
 * approach.": reference "Hypergate `l` range and the request lines, wave
 * 29"). Nothing opens and nothing is cleared: later presses outside the
 * zone say "too far", the ship that comes inside it is cleared with no
 * press (StellarAutoClearanceSystem), and the request does not lapse
 * (GUESS: only a clearance was seen to). Consumed display-side by the
 * status line (status_message_plugin.ts). Never mutates the simulation.
 */
export const LandingRequestEvent =
    new EcsEvent<LandingRequest>('LandingRequestEvent');

/** How many forms a landing request line has (see LandingRequestEvent's
 * `form`). */
export const LANDING_REQUEST_FORMS = 4;

/**
 * The form of the request line for one press: a salted hash of the
 * stellar, the pilot and the sim time, so every peer and every replay
 * prints the same line. GUESS on the odds (uniform over the four forms):
 * the original adds the ship's name in some draws and not others (gates 5
 * of 8, the station yes, the port no in wave 29; a port both ways in wave
 * 28), and a port answered both "<port> traffic control reads you" and
 * "Landing request received", so the pick looks random; nothing measured
 * its odds.
 */
export function landingRequestForm(stellarId: string, pilotUuid: string,
    now: number): number {
    return avalanche(hashString(
        `landingRequest:${stellarId}:${pilotUuid}:${now}`))
        % LANDING_REQUEST_FORMS;
}

/**
 * How far out (px, centre to centre, EUCLIDEAN) `l` with nothing selected
 * picks a hypergate or a wormhole. Measured on a hypergate at rest
 * (reference "Hypergate `l` range and the request lines, wave 29"):
 * selected at 490 px on the axis and at the 467 px diagonal (330, 330);
 * nothing at 500 px on the axis nor at the 594 px diagonal (420, 420),
 * whose larger coordinate is inside the 475 px the axis selected, so the
 * range is a CIRCLE, not a square like the landing zone. GUESS on the
 * exact radius inside the 490-500 bracket: a gate is skipped at
 * `distance >= 500`. A WORMHOLE gets the same circle, MEASURED (reference
 * "Wormholes, wave 35", finding 2: a stopped ship's `l` selected the stock
 * 104 px wormhole at 400 and 498 px and nothing at 500 and 600 px, nor on
 * the (400, 400) diagonal, inside a 500 px square but 566 px away: a
 * circle of 498-500, as the gates'; wave 34 had it at 290-300 px, not at
 * about 730). Ports and stations are picked
 * from any distance (a port and a station from 1,000 px, a port from
 * beyond the radar's edge: same section, and "R7 planet bribe withdrawal,
 * wave 29").
 */
export const HYPERGATE_SELECT_RANGE = 500;

/**
 * The half-side (px) of a stellar's CLEARANCE zone, a SQUARE around its
 * centre (max(|dx|, |dy|), like the landing zone) that does NOT depend on
 * the art, the same for hypergates, ports and stations. Inside it the `l`
 * that selects the stellar clears the ship (a gate's #91-93, a station's
 * #94-96, a port's #97-99) and opens a gate, and a ship holding a request
 * is cleared on entering it with no press; outside it the selecting `l`
 * only requests (#74-79 + #80). Measured: the 150 px gate cleared at 248
 * px on the axis and at the (180, 180) diagonal (255 px away, so a square,
 * not a circle) and only requested at 250 (reference "Hypergates, wave
 * 30", finding 2); gates of 17 and 325 px art cleared at 245 and requested
 * at 255 ("Hypergates across art sizes, wave 31"); 72 and 250 px planets
 * and 17 and 315 px stations cleared at 230 / 245 and requested at 260,
 * and a coasting request was cleared at max(|dx|, |dy|) 244-246 for both
 * port arts ("Planet and station clearance, wave 31", finding 2). GUESS on
 * the exact edge inside the 248-250 bracket: 249, inclusive
 * (inClearanceZone; the landing window's strict edge, wave 34, was
 * measured on the window alone). Wormholes have no clearance step. The
 * LANDING window (the press that lands, docks or opens the gate map) is
 * separate and goes by the art: {@link stellarLandingRange}.
 */
export const STELLAR_CLEARANCE_RANGE = 249;

/**
 * How long a clearance holds, in sim ms: one clock for ports, stations
 * and hypergates. MEASURED (reference "Landing clearance lapse, wave 36"):
 * nine edges of one evening (a 72 px planet, a 250 px planet art with the
 * station flag, a 315 x 200 station art with the planet flags, a 100 x 70
 * station, a 325 px gate) fell between 24.18 and 24.54 s with no order by
 * flag or art (finding 4), and the 100 x 70 station pressed at a constant
 * 24.40 s lapsed five times and then docked (finding 3); 24.4 s is their
 * centre. Wave 35's two clocks (a planet's 24.63 s, a station's 24.42 s
 * by the station flag) were two runs, not two kinds: its own planet rig
 * lapsed by 24.36 s on wave 36's evening (finding 2). GUESS: a fixed
 * value; the original's life scatters by a few frames per clearance and
 * its centre drifts between sessions (24.18-24.65 s over waves 32-36),
 * which is not modelled (it would need a deterministic draw for an effect
 * under 0.1 s). The lapse is silent (wave 32, finding 2) and leaves
 * nothing standing (finding 4).
 */
export const STELLAR_CLEARANCE_MS = 24_400;

/**
 * The odds of a port's or station's clearance line, out of
 * STELLAR_CLEARED_OUT_OF: the first piece #97 / #98 / #99 (a station's
 * #94 / #95 / #96) by STELLAR_CLEARED_FORM_ODDS, and the tail #101
 * "Welcome to <port>." in STELLAR_CLEARED_WELCOME (else #100 "Commence
 * final approach."). GUESS: the measured counts, 8 : 5 : 3 and Welcome 7
 * of 16 (reference "Planet and station clearance, wave 31", finding 1:
 * sixteen clearances, the two pieces apparently independent).
 */
export const STELLAR_CLEARED_OUT_OF = 16;
export const STELLAR_CLEARED_FORM_ODDS: readonly number[] = [8, 5, 3];
export const STELLAR_CLEARED_WELCOME = 7;

/**
 * The two pieces of a port's or station's clearance line for one
 * clearance: a salted hash of the stellar, the pilot and the sim time
 * (each piece its own salt, so the two are independent), so every peer
 * and every replay prints the same line. `form` 0..2 picks #97..99
 * (#94..96), `welcome` #101 over #100.
 */
export function stellarClearedForm(stellarId: string, pilotUuid: string,
    now: number): { form: number, welcome: boolean } {
    let draw = avalanche(hashString(
        `stellarCleared:${stellarId}:${pilotUuid}:${now}`))
        % STELLAR_CLEARED_OUT_OF;
    let form = 0;
    while (form < STELLAR_CLEARED_FORM_ODDS.length - 1
        && draw >= STELLAR_CLEARED_FORM_ODDS[form]) {
        draw -= STELLAR_CLEARED_FORM_ODDS[form];
        form++;
    }
    const welcome = avalanche(hashString(
        `stellarWelcome:${stellarId}:${pilotUuid}:${now}`))
        % STELLAR_CLEARED_OUT_OF < STELLAR_CLEARED_WELCOME;
    return { form, welcome };
}

/**
 * How often a gate's request line draws "Hypergate is online" (#75) for
 * "Hypergate is energized" (#74): HYPERGATE_ONLINE in
 * HYPERGATE_ONLINE_OUT_OF. Measured as a draw, not the gate's state
 * (reference "Hypergates, wave 30", finding 4: every gate closed and
 * nobody else in the system, "online" 4 and "energized" 4 there,
 * energized 12 : online 5 over waves 28-30, and 300 px said one in wave 29
 * and the other in wave 30). GUESS on the odds: the measured 5 in 17.
 */
export const HYPERGATE_ONLINE = 5;
export const HYPERGATE_ONLINE_OUT_OF = 17;

/**
 * Whether one gate request draws #75 "online": a salted hash of the gate,
 * the pilot and the sim time, so every peer and replay prints the same
 * line. Its own salt, so the draw is independent of the line's form
 * ({@link landingRequestForm}: the ship's name or not).
 */
export function hypergateRequestOnline(stellarId: string, pilotUuid: string,
    now: number): boolean {
    return avalanche(hashString(
        `hypergateOnline:${stellarId}:${pilotUuid}:${now}`))
        % HYPERGATE_ONLINE_OUT_OF < HYPERGATE_ONLINE;
}

/**
 * Per-player temporary landing clearance bought with a bribe: the stellar's
 * NOVA ID (PlanetComponent.id, e.g. 'nova:133' — not the entity uuid, which
 * changes when a system is rebuilt) -> the simulation time the reprieve
 * lapses.
 *
 * Lives on the PLAYER entity, like LegalRecordsComponent and CreditsComponent,
 * because clearance is a fact about a pilot rather than about the port. It is
 * written only by the deterministic input path (hail_plugin's applyHail, on
 * the tick every peer applies the bribe record) and read by the pure
 * clearance predicate, so it is ordinary synced sim state — nothing derives
 * it and nothing races on it.
 *
 * Expiry is compared against TimeResource, never Date.now, and lapsed entries
 * are simply not honoured rather than pruned, so no system has to run to keep
 * the map correct and two peers cannot prune on different ticks.
 *
 * The pilot's, not the hull's: it follows the pilot onto a new hull
 * (missions/mission_ship_change.ts's PLAYER_STATE_COMPONENTS), by
 * reference, so every write replaces the map rather than editing it.
 */
export const StellarBribesType = map(t.string, t.number);
export type StellarBribes = t.TypeOf<typeof StellarBribesType>;
export const StellarBribesComponent =
    new Component<StellarBribes>('StellarBribes');

/**
 * Where the pilot stands with each planet's bribe haggle in this system
 * visit: the stellar's NOVA id (as StellarBribes) -> { countered,
 * withdrawn } (reputation/hail.ts's StellarHaggleState; reference "R7
 * planet bribe, wave 28" and "R7 planet bribe withdrawal, wave 29").
 * `countered` while the planet's 3/4 counter to a Lower Price is on the
 * table (Accept Price then pays it); `withdrawn` once a Lower Price made it
 * withdraw its offer, after which it refuses every offer until the pilot
 * leaves the system. Landings and take-offs keep it (the ship carries it
 * down and back up); the crossing into another system drops the whole
 * component (pilot/transition_prep.ts's
 * prepareCarriedEntitiesForFreshWorld), which is the only pruning.
 *
 * Player state like StellarBribes: written only by applyHail on the tick
 * every peer applies the lowerPrice / bribe record, serialized and
 * delta-synced so the comm dialog quotes and refuses what the simulation
 * will. Like StellarBribes it follows the pilot onto a new hull by
 * reference within the visit, so every write replaces the map.
 */
export const StellarHaggleEntryType = t.type({
    countered: t.boolean,
    withdrawn: t.boolean,
});
export const StellarHaggleType = map(t.string, StellarHaggleEntryType);
export type StellarHaggle = t.TypeOf<typeof StellarHaggleType>;
export const StellarHaggleComponent =
    new Component<StellarHaggle>('StellarHaggle');

/**
 * The pilot's SYSTEM-VISIT ordinal: how many crossings into another system
 * (a jump, a hypergate or wormhole transit, a mission's system move) this
 * ship has made in the session, absent (0) before the first.
 * pilot/transition_prep.ts's prepareCarriedEntitiesForFreshWorld advances
 * it at the same crossing that drops StellarHaggle, and a planet's fresh
 * bribe refusal is drawn by it (reputation/hail.ts's planetRefusesBribe;
 * reference "R7 planet bribe withdrawal, wave 30": a fresh refusal held
 * through re-hails and a landing a day later), so the verdict lasts the
 * visit, landings and take-offs included, and is drawn afresh on the next.
 * Only ever compared for equality inside a hash seed, so its absolute
 * value means nothing.
 *
 * Player state like StellarHaggle: replaced (never mutated), serialized
 * and delta-synced so the comm dialog draws the verdict the simulation
 * will.
 */
export const SystemVisitType = t.number;
export const SystemVisitComponent = new Component<number>('SystemVisit');

/**
 * The expiry a paid planet bribe is written with: a sim time that never
 * arrives (a large finite number, not Infinity, so it survives JSON
 * codecs). A bribe has no clock: it lasts until the pilot next LANDS
 * anywhere or leaves the system (endPlanetBribes, called from the
 * landing reset and the system crossing). MEASURED (reference "How long
 * an accepted planet bribe lasts (R8), wave 41"): the bribe cleared the
 * player at once, and after a landing at the system's other port about
 * 45 s later the bribed port denied him again, Hostile on the comm and
 * offering a new bribe (twice). GUESS: time alone does not end it (a
 * 3-minute wait in flight would tell). Was a 2-minute clock. The legal
 * record is unchanged by a bribe, exactly as a ship bribe leaves it alone.
 */
export const STELLAR_BRIBE_NO_EXPIRY = 1e15;

/**
 * Ends every paid planet bribe the pilot holds: at his landing (any
 * stellar, the bribed one included) and at a crossing into another
 * system. Removes the component (the map is shared by reference, never
 * edited in place).
 */
export function endPlanetBribes(player: Entity): void {
    player.components.delete(StellarBribesComponent);
}

registerSimulationBridgeEvent({ event: LandingBlockedEvent });
registerSimulationBridgeEvent({ event: LandingClearedEvent });
registerSimulationBridgeEvent({ event: LandingRequestEvent });

/**
 * The landing speed gate: a ship lands only below 20 px/s (speed², strict).
 * Measured on the original (docs/reference_experiments.md, "U9 wave 4"):
 * the first press that landed was read at 19.0 px/s on one hull and 15.7 on
 * another, the presses before them at 21.7 and 20.5 said "too fast". The
 * gate is absolute: the same for a 100 and a 200 px/s hull, not a share of
 * the hull's top speed. So an inertialess ship at full speed never lands.
 */
export const LAND_SPEED_SQUARED = 400;

/**
 * The landing window's factor on the stellar's frame WIDTH: the window is
 * trunc(1.75 W), strict (landingRange, inLandingZone). MEASURED to the
 * pixel at rest on four arts (docs/reference_experiments.md, "Cleared
 * landing window, wave 34", finding 1): a cleared ship landed / was too
 * far at 69 / 70 px from a 40 px planet, 125 / 126 from a 72 px planet,
 * 28 / 29 from the 17 x 31 station (1.75 W = 29.75: the truncation) and
 * 174 / 175 from the 100 x 70 station, so every art lands one pixel inside
 * trunc(1.75 W) and refuses ON it. Every older reading fits: wave 6's 80 px
 * frame too far at exactly 140 ("U9 wave 6"; its 88 px frame landed at
 * 146, too far at 167), wave 31's walk-out landing from 425.4 and wave
 * 33's 250 px planet landing from 432.4 and too far at 439.4 (437), the
 * 315 x 200 station docked from 545.4 (551), the 96 px gate in at 155 and
 * out at 172 (168). Stations go by their width like planets (finding 2),
 * and the ship's own size plays no part (finding 3: 96 and 160 px hulls
 * too far at 150 px from the 72 px planet), so the window is centre to
 * centre; no plain inclusive factor fits all four arts (finding 4).
 */
export const LAND_RANGE_PER_FRAME_WIDTH = 1.75;
/**
 * A WORMHOLE's landing-window cap, in px: wave 6's planet cap ("U9 wave
 * 6": the 250 px art too far at 235.5, the 325 px art at 213), kept for
 * wormholes alone. Wave 31 showed the planets' "cap" was never the window
 * (a cleared ship landed on a 250 px planet from 294, 359 and 425 px; the
 * reliability note "U9's 212 px landing cap is superseded"), and gates
 * have none (waves 30-31: a 325 px gate's map at 245); nothing measured a
 * wormhole wider than 125 px, so wormholes keep the old rule (GUESS: the
 * cap binds only a wormhole art wider than 121 px, and none is stock; keep
 * it or drop it with the planets' cap, Matthew's call). Below it the
 * wormhole's window is the planets' trunc(1.75 W), strict, MEASURED
 * ("Wormholes, wave 35", finding 1): the stock 104 px wormhole took the
 * ship through at 180 and 181 px and was "too far" at 182 and 183, so
 * trunc(1.75 x 104) = 182 is its edge (wave 34: through at 150, "too far"
 * at 230).
 */
export const WORMHOLE_LAND_RANGE_CAP = 212;
/** getDefaultPlanetData's frame size, used when the frame is unknown. */
const DEFAULT_SPRITE_FRAME_SIZE: readonly [number, number] = [50, 50];

/**
 * The half-width of a stellar's landing window, in px, from one frame of
 * its sprite ([width, height]): R = trunc(1.75 W)
 * (LAND_RANGE_PER_FRAME_WIDTH), W the frame's WIDTH, with no cap, and a
 * ship lands only STRICTLY inside it (inLandingZone; reference "Cleared
 * landing window, wave 34": 40 px -> 70, 72 px -> 126, 17 px -> 29, 100 px
 * -> 175, each refused on the edge and landed a pixel inside it).
 *
 * The zone is a SQUARE around the stellar's centre, not a circle: the
 * original lands a ship when max(|dx|, |dy|) < R (inLandingZone).
 * Measured ("U9 wave 6"): a 17x31 station landed at (-28, -22), 35.6 px
 * away on the diagonal, but was too far at (-6, 34), 34.5 px straight
 * below: no circle fits that pair, the square does. Tall and wide frames
 * land like their width (15x21 -> 26 px, 17x31 -> 29, 35x22 -> 61),
 * never their height; the station flag changes nothing.
 *
 * Only a CLEARED ship lands inside it (a port, a station or a gate): an
 * uncleared press is answered by the clearance zone,
 * STELLAR_CLEARANCE_RANGE.
 */
export function landingRange(spriteFrameSize: readonly [number, number]):
    number {
    return Math.trunc(LAND_RANGE_PER_FRAME_WIDTH * spriteFrameSize[0]);
}

/**
 * The distance the landing zone is measured in: the larger of the offset's
 * two components (the Chebyshev distance), in world (= screen) axes.
 */
export function landingDistance(dx: number, dy: number): number {
    return Math.max(Math.abs(dx), Math.abs(dy));
}

/** Whether an offset (dx, dy) from a stellar's centre is inside a landing
 * window of half-width `range`: STRICT, the original's max(|dx|, |dy|) < R
 * (reference "Cleared landing window, wave 34": every art refused a ship
 * exactly on trunc(1.75 W)). */
export function inLandingZone(dx: number, dy: number, range: number):
    boolean {
    return landingDistance(dx, dy) < range;
}

/** Whether an offset (dx, dy) from a stellar's centre is inside its
 * CLEARANCE zone, the square of half-side STELLAR_CLEARANCE_RANGE,
 * inclusive (a GUESS inside the measured 248-250 bracket, unchanged by
 * wave 34, which measured only the landing window's edge). */
export function inClearanceZone(dx: number, dy: number): boolean {
    return landingDistance(dx, dy) <= STELLAR_CLEARANCE_RANGE;
}

/**
 * landingRange for a stellar whose data may not have loaded. Unknown data
 * (the provider has not run) and data without a frame size (game data JSON
 * written before PlanetData had the field) use the default 50 px frame,
 * i.e. an 85 px zone. PlanetData is staged identically on every peer, so
 * every peer reads the same range.
 *
 * A HYPERGATE's entry window (the `l` that opens the gate map once the
 * ship is cleared) goes by the art like a planet's: the stock 150 px
 * gate's map opened at 248 px and on the 255 px (180, 180) diagonal
 * (trunc(1.75 x 150) = 262), a 72 px gate's second `l` was "too far" at
 * 140 px (126; reference "Hypergates, wave 30", finding 2), a 96 px
 * gate's map opened at 155 and not at 172 (168), and a 325 px gate's at
 * 245
 * ("Hypergates across art sizes, wave 31"). A WORMHOLE's window is the
 * same trunc(1.75 W), strict (MEASURED on the 104 px art: through at 181,
 * "too far" at 182, "Wormholes, wave 35") under the old 212 px cap
 * (WORMHOLE_LAND_RANGE_CAP; the cap is not measured). Clearing the ship is
 * a separate, art-independent zone: STELLAR_CLEARANCE_RANGE.
 */
export function stellarLandingRange(planetData?: PlanetData): number {
    const frame = planetData?.spriteFrameSize;
    const size = Array.isArray(frame) && frame.length >= 2
        ? frame : DEFAULT_SPRITE_FRAME_SIZE;
    const range = landingRange(size);
    return planetData?.gate?.kind === 'wormhole'
        ? Math.min(range, WORMHOLE_LAND_RANGE_CAP) : range;
}

/**
 * Whether a stellar answers `l` through traffic control's clearance (a
 * request outside STELLAR_CLEARANCE_RANGE, a clearance inside it, and a
 * landing only for a cleared ship): hypergates, ports and stations. A
 * WORMHOLE has no clearance step (its first `l` goes straight through in
 * its window: reference "Gate approach lines, wave 25"), and neither has
 * a stellar whose data has not loaded (the provider has not run), which
 * keeps the plain window.
 */
export function stellarUsesClearance(planetData?: PlanetData): boolean {
    return planetData !== undefined && planetData.gate?.kind !== 'wormhole';
}

/**
 * How close a ship must come to a stellar to be both cleared and inside
 * its landing window: the smaller of STELLAR_CLEARANCE_RANGE and
 * stellarLandingRange for a stellar that uses clearance, the window
 * alone for a wormhole. The client autopilot (autopilot.ts) aims inside
 * it, so its first `l` there clears and the next lands.
 */
export function stellarApproachRange(planetData?: PlanetData): number {
    const window = stellarLandingRange(planetData);
    return stellarUsesClearance(planetData)
        ? Math.min(window, STELLAR_CLEARANCE_RANGE) : window;
}

/**
 * The landing-clearance decision for one player at one stellar, assembled from
 * synced simulation state. The ONE place the sim resolves a stellar's govt,
 * the player's record with it, the player's Contribute bits and their bribe,
 * so AttemptLandingSystem and applyHail (hail_plugin) cannot disagree about
 * whether a port is open. Pure given its inputs; the rules live in
 * stellar_clearance.ts.
 *
 * Government data comes from GovtsResource when it is staged (makeSystem sets
 * it before the world steps) and falls back to the cached game data, exactly
 * as hail_plugin's lookupGovt does.
 */
export function stellarClearanceFor(opts: {
    planetData: PlanetData,
    gameData: SimulationGameDataInterface,
    govts?: Map<string, GovtData>,
    records?: LegalRecords,
    shipData?: ShipData,
    outfits?: OutfitsState,
    bribes?: StellarBribes,
    /** The player's active ränks (ActiveRanksComponent). */
    ranks?: ActiveRanks,
    /** The player's active missions (MissionsComponent). */
    missions?: Missions,
    /**
     * The duplicate-stellar rule (mission_logic.ts's `sameStellar`). The
     * simulation has no system topology to build it from, so it is omitted
     * there and mission destinations match by exact id; the spaceport, which
     * has MissionUniverse, may pass one.
     */
    sameStellar?: (a: string, b: string) => boolean,
    planetId: string,
    /**
     * The system the stellar is in — the player's current system, whose
     * record MinStatus is judged on (records are per system, ruling #380).
     * Its sÿst must be warm in the cache (makeSystem stages the world's
     * own system on every peer).
     */
    systemId: string | undefined,
    now: number,
}): StellarClearance {
    const lookupGovt = (id: string) =>
        opts.govts?.get(id) ?? opts.gameData.data.Govt.getCached(id);
    // Rank data comes from the same cached simulation game data the govts
    // and outfits do, so the sim reads it without awaiting: a rank whose
    // data has not loaded yet simply grants nothing this tick, exactly as an
    // unloaded outfit contributes nothing.
    return stellarClearanceWith({
        ...opts,
        lookups: {
            govt: lookupGovt,
            systemGovt: id => opts.gameData.data.System.getCached(id)?.govt,
            outfitContribute: id =>
                opts.gameData.data.Outfit.getCached(id)?.contribute,
            rank: id => opts.gameData.data.Rank.getCached(id),
        },
    });
}

/**
 * The data {@link stellarClearanceWith} resolves ids through: the sim's
 * cached game data in {@link stellarClearanceFor}, a loaded MissionUniverse
 * on the star map (starmap.ts systemRefusesLanding).
 */
export interface ClearanceLookups {
    govt(id: string): GovtData | undefined;
    /** A sÿst's owning gövt id (null / undefined when independent). */
    systemGovt(id: string): string | null | undefined;
    /** An oütf's Contribute (hex string), undefined when unknown. */
    outfitContribute(id: string): string | undefined;
    rank(id: string): RankData | undefined;
}

/**
 * {@link stellarClearanceFor} with its id lookups injected: the ONE
 * assembly of a clearance decision (records, status govt, Contribute bits,
 * ränk 0x0200, mission destination, bribe) from the player's components,
 * so the landing gate, the hail dialog, the radar blip and the star map's
 * red dot all read the player the same way.
 */
export function stellarClearanceWith(opts: {
    planetData: PlanetData,
    lookups: ClearanceLookups,
    records?: LegalRecords,
    shipData?: { contribute?: string },
    outfits?: OutfitsState,
    bribes?: StellarBribes,
    ranks?: ActiveRanks,
    missions?: Missions,
    sameStellar?: (a: string, b: string) => boolean,
    planetId: string,
    systemId: string | undefined,
    now: number,
    /** Skip the gövt Require travel-permit test (the star map's dot
     * colour, which a permit refusal does not change: reference "Map dot
     * colours, wave 27"). The landing gate never sets it. */
    ignoreTravelPermit?: boolean,
}): StellarClearance {
    const { lookups } = opts;
    const govtId = opts.planetData.govt ?? undefined;
    const systemStatusGovt = lookups.govt(statusGovtOf(opts.systemId
        ? lookups.systemGovt(opts.systemId) : undefined));
    const planetGovt = govtId ? lookups.govt(govtId) : undefined;
    const outfitContributes: string[] = [];
    for (const [id, state] of opts.outfits ?? []) {
        if (state.count <= 0) {
            continue;
        }
        outfitContributes.push(lookups.outfitContribute(id) ?? '0x0');
    }
    // ränk 0x0200: a rank affiliated with this stellar's govt that lets the
    // player land "regardless of their MinStatus field" — the stock hypergate
    // network's key (rank_logic.ts).
    const rankLandingOverride = ranksAllowLanding(opts.ranks,
        id => lookups.rank(id), govtId ?? null);
    return planetClearance({
        planet: opts.planetData,
        planetGovt,
        records: opts.records,
        systemId: opts.systemId,
        systemStatusGovt,
        contribute: contributeBits(opts.shipData?.contribute,
            outfitContributes),
        bribedUntil: opts.bribes?.get(opts.planetId),
        now: opts.now,
        rankLandingOverride,
        missionDestination: isMissionDestination(opts.missions?.values(),
            opts.planetId, opts.sameStellar),
        ignoreTravelPermit: opts.ignoreTravelPermit,
    });
}

const LandablePlanetsQuery = new Query(
    [UUID, MovementStateComponent, PlanetComponent,
        Optional(PlanetDataComponent)] as const);
const AttemptLandingSystem = new System({
    name: 'AttemptLandingSystem',
    events: [ShipControlEvent] as const,
    args: [LandablePlanetsQuery, UUID,
        MovementStateComponent, PlanetTargetComponent,
        ShipControlStateComponent, Emit,
        Optional(LegalRecordsComponent), Optional(ShipDataComponent),
        Optional(OutfitsStateComponent), Optional(StellarBribesComponent),
        Optional(ActiveRanksComponent), Optional(MissionsComponent),
        SimulationGameDataResource, Optional(GovtsResource),
        Optional(TimeResource), Optional(SystemIdResource),
        Optional(JumpComponent)] as const,
    step(planets, playerUuid, { position, velocity }, planetTarget,
        controls, emit, records, shipData, outfits, bribes, ranks, missions,
        gameData, govts, time, systemId, jump) {
        if (controls.get('land') !== 'start') {
            return;
        }
        // A started jump cannot be stopped by the player: `l` is ignored
        // for the whole sequence (reference "Jump phases and fuel (U8),
        // wave 38", finding 4, u8_x3). Without this a ship holding still
        // beside a port it was cleared for would land out of its own
        // hyperspace sequence. GUESS that the press does nothing at all
        // (no selection, no traffic-control line): the reference records
        // only that the jump went ahead on time.
        if (jump) {
            return;
        }

        const now = time?.time ?? 0;
        // Whether this stellar's traffic control clears the player now.
        const cleared = (id: string, planetData: PlanetData) =>
            stellarClearanceFor({
                planetData, gameData, govts, records, shipData, outfits,
                bribes, ranks, missions,
                planetId: id, systemId, now,
            }).cleared;

        // Traffic control clears the ship: the clearance line, a gate
        // opens, and the next `l` inside the window lands (PlanetTarget
        // `cleared`).
        const clear = (uuid: string, id: string, planetData: PlanetData) => {
            emit(LandingClearedEvent, grantClearance(planetTarget, uuid, id,
                planetData, playerUuid, now), [playerUuid]);
        };

        // The press that SELECTS a stellar (or the first press after its
        // clearance lapsed) answers at once (reference "Hypergate `l` range
        // and the request lines, wave 29", finding 2; "Hypergate clearance
        // lines, wave 28"; "Gate map, wave 27"; "Planet and station
        // clearance, wave 31", findings 1, 2 and 5):
        //  - a stellar that refuses the player says so ("Hypergate usage
        //    denied." from the very first `l`, wave 28; a port's or a
        //    station's denial the same way: GUESS, measured at gates only,
        //    though wave 28's Kit Map Picky row expected one far out);
        //  - inside the CLEARANCE zone (STELLAR_CLEARANCE_RANGE, a 249 px
        //    square whatever the art; distance only: a coasting ship 250
        //    px off was cleared, wave 28) traffic control clears the ship
        //    ("Cleared for hypergate entry." / "<ship>, you're cleared to
        //    land. Welcome to <port>." etc.) and a gate opens; the next `l`
        //    inside the landing window lands;
        //  - outside it, traffic control acknowledges the REQUEST ("...
        //    Begin initial approach.", LandingRequestEvent) and nothing
        //    opens: later presses outside the zone say "too far"
        //    (`attempt`), and the ship that comes inside the zone is
        //    cleared with no press (StellarAutoClearanceSystem).
        const answerSelection = (uuid: string, stellarPosition: Position,
            id: string, planetData: PlanetData) => {
            const isStation = planetData.flags.isStation;
            const isHypergate = planetData.gate?.kind === 'hypergate';
            if (!cleared(id, planetData)) {
                emit(LandingBlockedEvent, {
                    reason: 'denied', isStation,
                    stellarName: displayName(planetData.name),
                    ...(isHypergate
                        ? { gateKind: 'hypergate' as const } : {}),
                }, [playerUuid]);
                return;
            }
            const offset = stellarPosition.subtract(position);
            if (inClearanceZone(offset.x, offset.y)) {
                clear(uuid, id, planetData);
                return;
            }
            // A gate's #74 / #75 is a draw (reference "Hypergates, wave
            // 30", finding 4), independent of the form's.
            const online = isHypergate
                && hypergateRequestOnline(id, playerUuid, now);
            delete planetTarget.cleared;
            delete planetTarget.clearedUntil;
            planetTarget.requested = uuid;
            emit(LandingRequestEvent, {
                kind: isHypergate ? 'hypergate'
                    : isStation ? 'station' : 'planet',
                stellarName: displayName(planetData.name),
                form: landingRequestForm(id, playerUuid, now),
                ...(online ? { online } : {}),
            }, [playerUuid]);
        };

        // The landing window, then is-it-a-port, then clearance, against one
        // stellar: land, or emit the original's refusal.
        const attempt = (uuid: string, planetPosition: Position,
            id: string, planetData: PlanetData | undefined) => {
            const usesClearance = stellarUsesClearance(planetData);
            // A clearance that has LAPSED, a port's, a station's or a
            // hypergate's (reference "Landing clearance lapse, wave 32",
            // findings 1 and 3, and "..., wave 35": a fresh clearance at
            // rest inside the zone once its clock has run, a station's
            // sooner than a planet's; wave 31, finding 5: a fresh request
            // from outside it): the press starts over.
            if (usesClearance && clearanceLapsed(planetTarget, now)) {
                answerSelection(uuid, planetPosition, id, planetData!);
                return;
            }
            const offset = planetPosition.subtract(position);
            const isStation = planetData?.flags.isStation ?? false;
            // A stellar the ship is not yet cleared at (selected by a click
            // or a number key, or requested from farther out) answers the
            // press by its CLEARANCE zone, distance only like the selecting
            // press (wave 28: a coasting ship cleared); a cleared one by
            // its LANDING window, the art's (reference "Hypergates, wave
            // 30", finding 2: a 72 px gate cleared at 140 px said "too far"
            // to the next press there; "Planet and station clearance, wave
            // 31", findings 3-4: a 250 px planet requested at 260 px said
            // "too far" inside its 425 px window, and landed from 425 px
            // once cleared).
            const awaitingClearance = usesClearance
                && !holdsClearance(planetTarget, now);
            const inZone = awaitingClearance
                ? inClearanceZone(offset.x, offset.y)
                : inLandingZone(offset.x, offset.y,
                    stellarLandingRange(planetData));
            // A gate's window lines name the gate ("You're too far away to
            // enter this hypergate." / "... wormhole.", STR# 2002 one-based
            // 65 / 66 and 69 / 70, reference "Gate approach lines, wave
            // 25"), so the gate kind rides with every refusal.
            const gateKind = planetData?.gate
                ? { gateKind: planetData.gate.kind } : {};
            // "Too far" (outside the square zone) before "too fast", as
            // the original answers.
            if (!inZone) {
                emit(LandingBlockedEvent,
                    { reason: 'tooFar', isStation, ...gateKind },
                    [playerUuid]);
            } else if (!awaitingClearance
                && velocity.lengthSquared >= LAND_SPEED_SQUARED) {
                emit(LandingBlockedEvent,
                    { reason: 'tooFast', isStation, ...gateKind },
                    [playerUuid]);
            } else if (planetData && !landable(planetData)) {
                // Not a port: Jupiter and the other scenery worlds, and
                // the destroyed hypergates of the collapsed network
                // (landable.ts). Checked AFTER the window so the
                // original's approach feedback still comes first — the
                // engine only answers a landing request the ship is
                // actually close enough and slow enough to make.
                // Unknown planet data (the provider has not run) is
                // treated as landable, exactly as before.
                emit(LandingBlockedEvent, {
                    reason: 'unlandable', isStation,
                    stellarName: displayName(planetData.name),
                    ...gateKind,
                }, [playerUuid]);
            } else if (planetData && !cleared(id, planetData)) {
                // CLEARANCE. A port that is shut to this pilot answers
                // "Landing request denied." (STR# 2002 index 82; index 81
                // for a station), which is all the original says — it does
                // not explain whether you are forbidden, unwelcome or
                // missing a permit. Checked AFTER the landing window and
                // after the is-it-a-port test, so the approach feedback
                // still comes first: traffic control only answers a
                // request the ship was actually able to make.
                //
                // The verdict is the same pure predicate the radar blip
                // and the planet comm dialog read (stellar_clearance.ts),
                // over synced state only, so every peer refuses on the
                // same tick and the player's comm dialog never offers a
                // bribe for a landing the gate would have allowed.
                //
                // A working HYPERGATE refusing the player says "Hypergate
                // usage denied." instead (STR# 2002 index 80, measured:
                // reference "Stellar hail graphic, wave 23", HG-V01).
                emit(LandingBlockedEvent, {
                    reason: 'denied', isStation,
                    stellarName: displayName(planetData.name),
                    ...gateKind,
                }, [playerUuid]);
            } else if (awaitingClearance) {
                // A stellar the ship has only selected (a click or a number
                // key; a ship holding a REQUEST is cleared on entering the
                // zone, StellarAutoClearanceSystem): the press inside the
                // clearance zone is the clearance, which opens a gate; the
                // next `l` inside the landing window lands or enters it
                // (reference "Hypergate `l` range and the request lines,
                // wave 29": only the clearance opens the gate, and a
                // cleared gate's second `l` opens the map). GUESS for a
                // port selected by a click: measured only on gates.
                clear(uuid, id, planetData!);
            } else {
                emit(LandEvent, { id, uuid }, [playerUuid]);
            }
        };

        // With a stellar ALREADY selected, 'land' acts on THAT target: it
        // never retargets to whatever happens to be nearest. Land if inside
        // the window; otherwise give the original's too-far / too-fast
        // feedback. Only when nothing (still in this system) is selected does
        // 'land' pick the nearest stellar (the first press of the two-press
        // land-nearest flow).
        if (planetTarget.target !== undefined) {
            for (const [uuid, { position: planetPosition }, { id }, planetData]
                of planets) {
                if (uuid === planetTarget.target) {
                    attempt(uuid, planetPosition, id, planetData);
                    return;
                }
            }
            // The selection is no longer a stellar in this system (jumped
            // away, etc.); fall through and pick the nearest as if unset.
        }

        // No stellar selected: target the nearest one that is a PORT at
        // all (landable.ts — Jupiter, scenery worlds and dead gates are
        // skipped, so 'l' never tries to land on Jupiter; a port may still
        // deny landing, which is the clearance gate above). A hypergate or
        // a wormhole counts only inside HYPERGATE_SELECT_RANGE (a circle,
        // wave 29; the wormhole's measured in wave 35), so from farther
        // out `l` picks a port or nothing at all. Unknown
        // planet data (provider not yet run) counts as landable, as
        // elsewhere. Ties break on the lexicographically smaller uuid so every peer
        // picks the same stellar regardless of entity-map iteration order
        // (see ChooseTargetSystem).
        let closest: [string, Position, string, PlanetData | undefined]
            | undefined = undefined;
        let minSquared = Infinity;
        for (const [uuid, { position: planetPosition }, { id }, data]
            of planets) {
            if (data && !landable(data)) {
                continue;
            }
            const distanceSquared =
                planetPosition.subtract(position).lengthSquared;
            // A gate (a hypergate or a wormhole) is picked only inside a
            // CIRCLE of HYPERGATE_SELECT_RANGE (waves 29, 34, 35); ports at
            // any distance.
            const gateKind = data?.gate?.kind;
            if ((gateKind === 'hypergate' || gateKind === 'wormhole')
                && distanceSquared
                >= HYPERGATE_SELECT_RANGE * HYPERGATE_SELECT_RANGE) {
                continue;
            }
            if (distanceSquared < minSquared
                || (distanceSquared === minSquared
                    && closest !== undefined && uuid < closest[0])) {
                closest = [uuid, planetPosition, id, data];
                minSquared = distanceSquared;
            }
        }
        selectPlanetTarget(planetTarget, closest?.[0]);
        if (!closest) {
            return;
        }
        const [closestUuid, closestPosition, closestId, closestData] = closest;
        // A WORMHOLE has no clearance step: the first `l` both targets it
        // and answers at once (too far / too fast / through it), where a
        // planet's or a hypergate's first `l` only selects (measured:
        // reference "Gate approach lines, wave 25", the stock wormhole with
        // Nav System Off).
        if (closestData?.gate?.kind === 'wormhole') {
            attempt(...closest);
            return;
        }
        if (!closestData) {
            // Unknown data (the provider has not run): select only.
            return;
        }
        answerSelection(closestUuid, closestPosition, closestId, closestData);
    }
});

/**
 * Records a clearance on a ship's selection (a gate opens, the standing
 * request if any is answered; it lapses STELLAR_CLEARANCE_MS later, a
 * gate's as a port's or a station's) and returns the LandingClearedEvent
 * that prints its line: a
 * gate's form is picked display-side, a port's or station's two pieces
 * here by salted hash (stellarClearedForm).
 */
function grantClearance(planetTarget: PlanetTarget, uuid: string,
    id: string, planetData: PlanetData, shipUuid: string, now: number,
    automatic?: boolean): LandingCleared {
    planetTarget.cleared = uuid;
    delete planetTarget.requested;
    // One clock for every kind (reference "Landing clearance lapse, wave
    // 36", findings 1-5); a hypergate's clearance lapses on it too (wave
    // 32, finding 3; wave 36, finding 5); the gate then closes as for
    // any clearance it no longer sees (GateAnimationSystem; GUESS: the
    // original's lapsed-gate animation is unmeasured).
    planetTarget.clearedUntil = now + STELLAR_CLEARANCE_MS;
    const flag = automatic ? { automatic } : {};
    if (planetData.gate?.kind === 'hypergate') {
        return { kind: 'hypergate', ...flag };
    }
    return {
        kind: planetData.flags.isStation ? 'station' : 'planet',
        stellarName: displayName(planetData.name),
        ...stellarClearedForm(id, shipUuid, now),
        ...flag,
    };
}

/**
 * A standing REQUEST at a hypergate, a port or a station is cleared with
 * no press when the ship comes inside the stellar's clearance zone (the
 * same line as a press there; a gate opens). Measured: the Kit Ring
 * Lancer coasting in at 49 px/s, its last press 2.5 s earlier, was told
 * "Cleared for hypergate entry, <ship>." as the gate came about 245-250
 * px ahead (reference "Hypergates, wave 30", finding 3); requests at a 72
 * and a 250 px port were cleared by themselves at max(|dx|, |dy|) 244-246
 * ("You are cleared to land. Welcome to Kit Land Toward P72.", "<ship>,
 * you're cleared to land. Commence final approach.": "Planet and station
 * clearance, wave 31", finding 2). Once per request: the clearance drops
 * `requested`, and a ship that leaves and comes back hears nothing more
 * (the clearance lapses with time, a gate's too, and leaves no request
 * behind: a ship that let it lapse 359 px out crossed back into the zone
 * with no line and its press got a fresh clearance, reference "Landing
 * clearance lapse, wave 32", finding 4; the next press starts over).
 *
 * Distance only, like the selecting press (speed never stopped a
 * clearance). Traffic control re-judges the pilot on entry, with the same
 * predicate as the press (stellarClearanceFor): a stellar that would now
 * refuse leaves the request standing, silent, and the next `l` gets the
 * denial (GUESS: nothing measured a status change mid-approach).
 *
 * Deterministic sim state: reads synced positions, the sim clock (bribe
 * expiries, the clearance's lapse time and line draw) and the player's
 * records; writes only PlanetTarget and the targeted event, on whichever
 * tick every peer sees the ship inside.
 */
export const StellarAutoClearanceSystem = new System({
    name: 'StellarAutoClearanceSystem',
    args: [LandablePlanetsQuery, UUID, MovementStateComponent,
        PlanetTargetComponent, Emit,
        Optional(LegalRecordsComponent), Optional(ShipDataComponent),
        Optional(OutfitsStateComponent), Optional(StellarBribesComponent),
        Optional(ActiveRanksComponent), Optional(MissionsComponent),
        SimulationGameDataResource, Optional(GovtsResource),
        Optional(TimeResource), Optional(SystemIdResource)] as const,
    step(planets, shipUuid, { position }, planetTarget, emit, records,
        shipData, outfits, bribes, ranks, missions, gameData, govts, time,
        systemId) {
        if (planetTarget.requested === undefined) {
            return;
        }
        if (!holdsRequest(planetTarget)) {
            // Stale (every selection write goes through
            // selectPlanetTarget, which drops it; belt and braces).
            delete planetTarget.requested;
            return;
        }
        const now = time?.time ?? 0;
        for (const [uuid, { position: stellarPosition }, { id }, planetData]
            of planets) {
            if (uuid !== planetTarget.requested) {
                continue;
            }
            if (!planetData || !stellarUsesClearance(planetData)) {
                return;
            }
            const offset = stellarPosition.subtract(position);
            if (!inClearanceZone(offset.x, offset.y)) {
                return;
            }
            if (!stellarClearanceFor({
                planetData, gameData, govts, records, shipData, outfits,
                bribes, ranks, missions,
                planetId: id, systemId, now,
            }).cleared) {
                return;
            }
            emit(LandingClearedEvent, grantClearance(planetTarget, uuid, id,
                planetData, shipUuid, now, true), [shipUuid]);
            return;
        }
        // The stellar is gone from this system: the request lapses.
        delete planetTarget.requested;
    },
    // After the move it judges, and after TimeSystem (bribe expiries).
    // #237 pins (shared: MovementState, and * with the combat systems):
    // before the hull updaters, so CollisionSystem and everything after it
    // follow transitively; BeamSystem pins itself after this one.
    after: [TimeSystem, MovementSystem],
    before: [UpdateHitboxHullSystem, UpdateHurtboxHullSystem],
});

/**
 * Applies a peer's explicit stellar selection (a tap/click that starts an
 * autopilot to a planet) to the ship it controls, mirroring applySetTarget
 * for ships. Selecting the stellar keeps the land handshake acting on the
 * autopilot's destination even when another stellar was already picked, and
 * lights up the "Stellar Navigation" readout the moment you tap. An invalid
 * choice (not a stellar in this world) is dropped so every peer resolves the
 * input identically. `null` clears the selection.
 */
export function applySetPlanetTarget(world: World, peerId: string | undefined,
    targetUuid: string | null) {
    const found = findControlledEntity(world, peerId);
    if (!found) {
        return;
    }
    const planetTarget = found.entity.components.get(PlanetTargetComponent);
    if (!planetTarget) {
        return;
    }
    if (targetUuid === null) {
        selectPlanetTarget(planetTarget, undefined);
        return;
    }
    const targetEntity = world.entities.get(targetUuid);
    if (!targetEntity || !targetEntity.components.has(PlanetComponent)) {
        return;
    }
    selectPlanetTarget(planetTarget, targetUuid);
}

// Stellar-body hotkeys (controls_nits.txt): number keys 1..9 select the
// Nth stellar body in the current system, and resetNav (tilde/backquote)
// clears the selection. Selection routes through the SAME per-player
// PlanetTargetComponent that clicking/landing use, so the statusbar's
// "Stellar Navigation" readout, the on-screen planet reticle, and the
// land handshake all agree with the number-key pick.
//
// Ordering is the system's own SystemData.planets array — the exact order
// make_system.ts spawns the planet entities in, each under the
// deterministic `planet ${planetId}` UUID. getCached(systemId) is warm
// (this world's own system; the make_system staging contract), and the
// system is event-driven on ShipControlEvent (like AttemptLandingSystem),
// so no clock read / after:[TimeSystem] is needed. Display-synced via the
// existing PlanetTargetComponent delta registration.
const NUM_STELLAR_HOTKEYS = 9;
export const SelectStellarSystem = new System({
    name: 'SelectStellarSystem',
    events: [ShipControlEvent] as const,
    args: [ShipControlStateComponent, PlanetTargetComponent,
        SystemIdResource, SimulationGameDataResource, Entities] as const,
    step(controls, planetTarget, systemId, gameData, entities) {
        // Tilde/backquote clears the selected stellar body.
        if (controls.get('resetNav') === 'start') {
            selectPlanetTarget(planetTarget, undefined);
            return;
        }
        for (let i = 1; i <= NUM_STELLAR_HOTKEYS; i++) {
            const action = `selectStellar${i}` as ControlAction;
            if (controls.get(action) !== 'start') {
                continue;
            }
            const planetIds =
                gameData.data.System.getCached(systemId)?.planets ?? [];
            // Hidden stellars (wormholes) are skipped: they never appear in
            // the number-key enumeration, so pressing N selects the Nth
            // NON-wormhole stellar. The order is SystemData.planets (identical
            // on every peer) filtered by each entity's synced, genesis
            // PlanetDataComponent, so the skip is deterministic across peers.
            // Players still transit a wormhole by flying into it and landing
            // (AttemptLandingSystem), which does not go through this selection.
            const selectable = planetIds.filter(id =>
                entities.get(`planet ${id}`)?.components
                    .get(PlanetDataComponent)?.gate?.kind !== 'wormhole');
            const planetId = selectable[i - 1];
            if (planetId === undefined) {
                return;
            }
            const uuid = `planet ${planetId}`;
            if (entities.has(uuid)) {
                selectPlanetTarget(planetTarget, uuid);
            }
            return;
        }
    },
    // #237 pin (shared: *): PlanetPlugin registers landing before stellar
    // selection among its ShipControlEvent handlers.
    after: [AttemptLandingSystem],
});

// Landing no longer refuels for free: the spaceport's Refuel button
// (spaceport.ts) charges credits, appears only while fuel isn't full,
// and greys out when unaffordable, matching the original game. The
// paid fill commits with the rest of the docked entity's state via the
// launch addEntity input record.

const PlanetAnimationProvider = Provide({
    name: "PlanetAnimationProvider",
    provided: AnimationComponent,
    update: [PlanetDataComponent],
    args: [PlanetDataComponent],
    factory: planetData => planetData.animation,
    // #237 pins: after PlanetTargetProvider (the pair no longer shares
    // state — the providers declare their writes with SetComponent now —
    // but the edge carries the providers' transitive order); before
    // PlanetDataProvider (shared: PlanetData, read here and written
    // there). PlanetDataProvider is in turn pinned before ship's
    // ExplodingFinishedSystem (see there).
    after: [PlanetTargetProvider],
    before: [PlanetDataProvider],
});

export const PlanetPlugin: Plugin = {
    name: 'PlanetPlugin',
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }

        world.addComponent(PlanetComponent);
        world.addComponent(PlanetDataComponent);
        world.addComponent(StellarBribesComponent);
        world.addComponent(StellarHaggleComponent);
        world.addComponent(SystemVisitComponent);
        registerEntityDeriver(world, {
            name: 'PlanetDataDeriver',
            provided: PlanetDataComponent,
            requires: [PlanetComponent],
            derive: (entity, gameData) =>
                derivePlanetData(gameData, entity.components.get(PlanetComponent)!),
        });
        // On the wire as `{id}` (core/game_data_ref.ts).
        world.resources.get(SerializerResource)?.addComponent(
            PlanetDataComponent, gameDataRefType<PlanetData>(world, 'Planet', 'PlanetData'));
        // Bought landing clearance is ordinary synced player state: it has to
        // survive a snapshot (a peer joining mid-bribe must honour it) and be
        // delta-synced so the display's comm dialog and radar see it.
        world.resources.get(SerializerResource)?.addComponent(
            StellarBribesComponent, StellarBribesType);
        world.resources.get(SerializerResource)?.addComponent(
            StellarHaggleComponent, StellarHaggleType);
        world.resources.get(SerializerResource)?.addComponent(
            SystemVisitComponent, SystemVisitType);
        world.resources.get(SerializerResource)?.addEvent(LandEvent, LandEventType);
        world.resources.get(SerializerResource)?.addEvent(
            LandingBlockedEvent, LandingBlockedEventType);
        world.resources.get(SerializerResource)?.addEvent(
            LandingClearedEvent, LandingClearedEventType);
        world.resources.get(SerializerResource)?.addEvent(
            LandingRequestEvent, LandingRequestEventType);
        deltaMaker.addComponent(PlanetComponent, {
            componentType: PlanetType,
        });
        deltaMaker.addComponent(PlanetTargetComponent, {
            componentType: PlanetTargetType,
        });
        deltaMaker.addComponent(StellarBribesComponent, {
            componentType: StellarBribesType,
        });
        deltaMaker.addComponent(StellarHaggleComponent, {
            componentType: StellarHaggleType,
        });
        deltaMaker.addComponent(SystemVisitComponent, {
            componentType: SystemVisitType,
        });
        world.addSystem(PlanetTargetProvider);
        world.addSystem(PlanetAnimationProvider);
        world.addSystem(PlanetDataProvider);
        world.addSystem(AttemptLandingSystem);
        world.addSystem(SelectStellarSystem);
        world.addSystem(StellarAutoClearanceSystem);
    }
};
