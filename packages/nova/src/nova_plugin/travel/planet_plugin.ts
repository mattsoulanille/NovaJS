import * as t from 'io-ts';
import { GovtData } from "novadatainterface/govt_data";
import { PlanetData } from "novadatainterface/planet_data";
import { ShipData } from "novadatainterface/ship_data";
import { Emit, Entities, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { map } from 'nova_ecs/datatypes/map';
import { EcsEvent } from 'nova_ecs/events';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { Provide } from 'nova_ecs/provide';
import { World } from 'nova_ecs/world';
import { landable } from '../core/index.js';
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
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { OutfitsState, OutfitsStateComponent } from '../ship/index.js';
import { LegalRecords, statusGovtOf } from '../reputation/index.js';
import { GovtsResource, LegalRecordsComponent } from '../reputation/index.js';
import { ActiveRanks, ActiveRanksComponent } from '../ncb/index.js';
import { ranksAllowLanding } from '../ncb/index.js';
import { Missions, MissionsComponent } from '../player/index.js';
import {
    contributeBits, isMissionDestination, planetClearance, StellarClearance,
} from '../reputation/index.js';
import { displayName } from '../core/index.js';

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

export const PlanetTargetComponent = new Component<Target>('PlanetTargetComponent');

const PlanetTargetProvider = Provide({
    name: "PlanetTargetProvider",
    provided: PlanetTargetComponent,
    args: [ShipComponent] as const,
    factory: () => ({ target: undefined }),
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
 * `stellarName` and `gateKind` are only meaningful for `unlandable`, whose
 * message names the stellar; both are optional so the window reasons stay
 * exactly the shape they always were.
 */
/** Why a land attempt was refused (see LandingBlockedEvent). Closed: the
 * event is sim-to-display within one build, never persisted. */
export const LandingBlockReasonType = t.keyof({
    tooFar: null, tooFast: null, unlandable: null, denied: null,
});
export type LandingBlockReason = t.TypeOf<typeof LandingBlockReasonType>;
/** Which kind of gate an `unlandable` stellar is, when it is one. */
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
 */
export const StellarBribesType = map(t.string, t.number);
export type StellarBribes = t.TypeOf<typeof StellarBribesType>;
export const StellarBribesComponent =
    new Component<StellarBribes>('StellarBribes');

/**
 * How long a bribe keeps a stellar's landing pad open, in ms. TUNABLE /
 * ASSUMPTION: the Bible quantifies neither the price nor the duration of a
 * planet bribe. Two minutes matches the ship-bribe reprieve (hail_plugin's
 * BRIBE_PACIFY_MS) — long enough to fly in and land, short enough that the
 * clearance has to be re-bought on a later visit. The legal record is
 * unchanged by a bribe, exactly as a ship bribe leaves it alone.
 */
export const STELLAR_BRIBE_MS = 120_000;

registerSimulationBridgeEvent({ event: LandingBlockedEvent });

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
 * The landing zone's half-width per px of the stellar's frame WIDTH. FITTED
 * on the original (docs/reference_experiments.md, "U9 wave 6: landing range
 * of the tiny stations"): measured as max(|dx|, |dy|), every at-rest bracket
 * of waves 4 and 6 allows k = R / W between 1.66 (88 px frame: landed at
 * 146, too far at 167) and 1.75 (80 px frame: landed at 117.5, too far at
 * 140); the 15x21 and 17x31 stations, the 35x22 one and the 40-112 px
 * planets all agree with about 1.7.
 */
export const LAND_RANGE_PER_FRAME_WIDTH = 1.7;
/**
 * The landing zone's half-width cap, in px. FITTED ("U9 wave 6"): the 250 px
 * art landed at 209.5 and was too far at 235.5, the 325 px art landed at 199
 * and was too far at 213, the 315x200 art landed at 213.5 (each centre good
 * to about 2-5 px, so the last two are within each other's error); the doc
 * brackets the cap at about 210-215 and proposes 212.
 */
export const LAND_RANGE_CAP = 212;
/** getDefaultPlanetData's frame size, used when the frame is unknown. */
const DEFAULT_SPRITE_FRAME_SIZE: readonly [number, number] = [50, 50];

/**
 * The half-width of a stellar's landing zone, in px, from one frame of its
 * sprite ([width, height]): R = min(1.7 W, 212), W the frame's WIDTH.
 *
 * The zone is a SQUARE around the stellar's centre, not a circle: the
 * original lands a ship when max(|dx|, |dy|) <= R (inLandingZone).
 * Measured ("U9 wave 6"): a 17x31 station landed at (-28, -22), 35.6 px
 * away on the diagonal, but was too far at (-6, 34), 34.5 px straight
 * below: no circle fits that pair, the square does. Tall and wide frames
 * land like their width (15x21 -> about 25 px, 17x31 -> 29, 35x22 -> 60),
 * never their height; the station flag changes nothing.
 */
export function landingRange(spriteFrameSize: readonly [number, number]):
    number {
    return Math.min(LAND_RANGE_PER_FRAME_WIDTH * spriteFrameSize[0],
        LAND_RANGE_CAP);
}

/**
 * The distance the landing zone is measured in: the larger of the offset's
 * two components (the Chebyshev distance), in world (= screen) axes.
 */
export function landingDistance(dx: number, dy: number): number {
    return Math.max(Math.abs(dx), Math.abs(dy));
}

/** Whether an offset (dx, dy) from a stellar's centre is inside a landing
 * zone of half-width `range` (inclusive: the original's <= R). */
export function inLandingZone(dx: number, dy: number, range: number):
    boolean {
    return landingDistance(dx, dy) <= range;
}

/**
 * landingRange for a stellar whose data may not have loaded. Unknown data
 * (the provider has not run) and data without a frame size (game data JSON
 * written before PlanetData had the field) use the default 50 px frame,
 * i.e. an 85 px zone. PlanetData is staged identically on every peer, so
 * every peer reads the same range.
 */
export function stellarLandingRange(planetData?: PlanetData): number {
    const frame = planetData?.spriteFrameSize;
    return landingRange(Array.isArray(frame) && frame.length >= 2
        ? frame : DEFAULT_SPRITE_FRAME_SIZE);
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
    const govtId = opts.planetData.govt ?? undefined;
    const lookupGovt = (id: string) =>
        opts.govts?.get(id) ?? opts.gameData.data.Govt.getCached(id);
    const systemStatusGovt = lookupGovt(statusGovtOf(opts.systemId
        ? opts.gameData.data.System.getCached(opts.systemId)?.govt
        : undefined));
    const planetGovt = govtId
        ? (opts.govts?.get(govtId)
            ?? opts.gameData.data.Govt.getCached(govtId))
        : undefined;
    const outfitContributes: string[] = [];
    for (const [id, state] of opts.outfits ?? []) {
        if (state.count <= 0) {
            continue;
        }
        outfitContributes.push(
            opts.gameData.data.Outfit.getCached(id)?.contribute ?? '0x0');
    }
    // ränk 0x0200: a rank affiliated with this stellar's govt that lets the
    // player land "regardless of their MinStatus field" — the stock hypergate
    // network's key (rank_logic.ts). Rank data comes from the same cached
    // simulation game data the govts and outfits above do, so the sim reads it
    // without awaiting: a rank whose data has not loaded yet simply grants
    // nothing this tick, exactly as an unloaded outfit contributes nothing.
    const rankLandingOverride = ranksAllowLanding(opts.ranks,
        id => opts.gameData.data.Rank.getCached(id), govtId ?? null);
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
        Optional(TimeResource), Optional(SystemIdResource)] as const,
    step(planets, playerUuid, { position, velocity }, planetTarget, controls,
        emit, records, shipData, outfits, bribes, ranks, missions, gameData,
        govts, time, systemId) {
        if (controls.get('land') !== 'start') {
            return;
        }

        // With a stellar ALREADY selected, 'land' acts on THAT target: it
        // never retargets to whatever happens to be nearest. Land if inside
        // the window; otherwise give the original's too-far / too-fast
        // feedback. Only when nothing (still in this system) is selected does
        // 'land' pick the nearest stellar (the first press of the two-press
        // land-nearest flow).
        if (planetTarget.target !== undefined) {
            for (const [uuid, { position: planetPosition }, { id }, planetData]
                of planets) {
                if (uuid !== planetTarget.target) {
                    continue;
                }
                const offset = planetPosition.subtract(position);
                const isStation = planetData?.flags.isStation ?? false;
                const range = stellarLandingRange(planetData);
                // "Too far" (outside the square zone) before "too fast", as
                // the original answers.
                if (!inLandingZone(offset.x, offset.y, range)) {
                    emit(LandingBlockedEvent, { reason: 'tooFar', isStation },
                        [playerUuid]);
                } else if (velocity.lengthSquared >= LAND_SPEED_SQUARED) {
                    emit(LandingBlockedEvent, { reason: 'tooFast', isStation },
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
                        ...(planetData.gate
                            ? { gateKind: planetData.gate.kind } : {}),
                    }, [playerUuid]);
                } else if (planetData && !stellarClearanceFor({
                    planetData, gameData, govts, records, shipData, outfits,
                    bribes, ranks, missions,
                    planetId: id, systemId, now: time?.time ?? 0,
                }).cleared) {
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
                    emit(LandingBlockedEvent, {
                        reason: 'denied', isStation,
                        stellarName: displayName(planetData.name),
                    }, [playerUuid]);
                } else {
                    emit(LandEvent, { id, uuid }, [playerUuid]);
                }
                return;
            }
            // The selection is no longer a stellar in this system (jumped
            // away, etc.); fall through and pick the nearest as if unset.
        }

        // No stellar selected: target the nearest one that is a PORT at
        // all (landable.ts — Jupiter, scenery worlds and dead gates are
        // skipped, so 'l' never tries to land on Jupiter; a port may still
        // deny landing, which is the clearance gate above). Unknown planet
        // data (provider not yet run) counts as landable, as elsewhere.
        // Ties break on the lexicographically smaller uuid so every peer
        // picks the same stellar regardless of entity-map iteration order
        // (see ChooseTargetSystem).
        let closestUuid: string | undefined = undefined;
        let minSquared = Infinity;
        for (const [uuid, { position: planetPosition }, , data] of planets) {
            if (data && !landable(data)) {
                continue;
            }
            const distanceSquared =
                planetPosition.subtract(position).lengthSquared;
            if (distanceSquared < minSquared
                || (distanceSquared === minSquared
                    && closestUuid !== undefined && uuid < closestUuid)) {
                closestUuid = uuid;
                minSquared = distanceSquared;
            }
        }
        planetTarget.target = closestUuid;
    }
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
        planetTarget.target = undefined;
        return;
    }
    const targetEntity = world.entities.get(targetUuid);
    if (!targetEntity || !targetEntity.components.has(PlanetComponent)) {
        return;
    }
    planetTarget.target = targetUuid;
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
            planetTarget.target = undefined;
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
                planetTarget.target = uuid;
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
        world.resources.get(SerializerResource)?.addEvent(LandEvent, LandEventType);
        world.resources.get(SerializerResource)?.addEvent(
            LandingBlockedEvent, LandingBlockedEventType);
        deltaMaker.addComponent(PlanetComponent, {
            componentType: PlanetType,
        });
        deltaMaker.addComponent(PlanetTargetComponent, {
            componentType: Target,
        });
        deltaMaker.addComponent(StellarBribesComponent, {
            componentType: StellarBribesType,
        });
        world.addSystem(PlanetTargetProvider);
        world.addSystem(PlanetAnimationProvider);
        world.addSystem(PlanetDataProvider);
        world.addSystem(AttemptLandingSystem);
        world.addSystem(SelectStellarSystem);
    }
};
