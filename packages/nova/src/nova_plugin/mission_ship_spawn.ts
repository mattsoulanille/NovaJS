import { GovtData } from 'novadatainterface/govt_data';
import { MissionData } from 'novadatainterface/mission_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { FiringGroupComponent } from './firing_group.js';
import { auxShipsMatchSystem, SystemInfo } from './mission_ship_logic.js';
import { MissionShipComponent } from './mission_ship_plugin.js';
import {
    GOAL_CHASE_OFF, GOAL_ESCORT, GOAL_RESCUE, ShipObjective, shipsToSpawn, GOAL_NONE } from './mission_ship_state.js';
import { FormationComponent, NpcComponent } from './npc_ai_plugin.js';
import {
    applyStartsDisabledData,
    INITIAL_SPAWN_HALF_SIZE,
    makeHulk,
    jumpInState,
    makeNpcShip,
    pickWeighted,
} from './npc_spawn_plugin.js';
import { MissionsComponent } from './player_state_plugin.js';
import { ControlBitsComponent } from './ncb_plugin.js';
import { SystemHoldComponent } from './system_hold.js';
import { TargetComponent } from './target_component.js';

/**
 * Builds the mission special/aux ships the owning player's client
 * must insert when its ship enters a system — the player-local half
 * of the multiplayer design documented in mission_ship_plugin.ts.
 *
 * Runs on the OWNER'S CLIENT, before the (docked or jumping) player
 * entity is re-inserted into the simulation: it clears the stale
 * `live` rosters ON THE PLAYER ENTITY (so the mutation rides the
 * player's own insertion record) and returns the fully-formed ship
 * entities for the caller to push through the same input-record
 * addEntity path as hired escorts. Plain randomness (dude table
 * picks, spawn placement) is fine here: the resulting entities are
 * baked into the records, so every peer sees identical ships.
 *
 * mïsn ShipStart placement:
 *  - 1 (jump in from hyperspace): jump-in kinematics at the system
 *    edge. The Bible's "short delay" is approximated by the travel
 *    time from the edge (a ships-jumping-in feel without a timer).
 *  - 0 (randomly in the system): scattered in the gameplay box.
 *  - 2 (randomly, cloaked): scattered; spawning pre-cloaked is a
 *    documented gap (NPCs don't manage cloaks yet).
 *  - -1..-16 (on a nav default): nav defaults aren't modeled;
 *    scattered (documented gap).
 *
 * mïsn ShipBehav:
 *  - 0 (always attack the player): spawns aggressed at the owner.
 *  - 1 (protect the player): flies in formation on the owner and
 *    shares the owner's firing group (like hired escorts). Escort-goal
 *    ships behave the same way.
 *  - 2 (destroy enemy stellars): planet bombardment isn't modeled;
 *    standard AI (documented gap).
 *
 * ONE LIVE BATCH PER SYSTEM — mïsn ShipSyst -6, "Whatever system the
 * player is in (i.e. follow him around)". The parenthetical describes the
 * EFFECT, not the mechanism: ShipSyst is a spawn-system SELECTOR, and every
 * other value of it names where the ships appear (-1 the initial system, -3
 * TravelStel's, a specific id, a govt's). -6 names "here, wherever here is"
 * — so the ships keep turning up wherever the player goes because they are
 * SPAWNED THERE, not because they flew there. They are despawned with the
 * system the player leaves (MissionShipCleanupSystem's owner-absence rule)
 * and a fresh batch appears in the one they enter.
 *
 * Two rules keep that to ONE batch, and both are needed because a
 * ShipBehav 1 ship is indistinguishable from a hired escort by every
 * structural test — it flies in formation on the player and shares their
 * firing group, so the escort chain genuinely tops out at the player:
 *
 *  1. A mission ship NEVER RIDES a transition. MarkPlayerEscortsSystem
 *     will not mark one, and sweepableEscorts will not sweep one whatever
 *     markers it wears (player_escort_plugin.ts).
 *  2. The respawn only builds the SHORTFALL against what the system
 *     already holds (LiveMissionShips below), so the entry that does NOT
 *     rebuild the world — a lift-off back into the system just landed in —
 *     cannot lay a second batch on top of the first either.
 *
 * Without them the batch grows by its ShipCount at every hop, which is
 * Matthew's playtest report against "Cause Havoc for Dani" (stock mïsn
 * 665, whose OnAccept `S792` starts the invisible mïsn 792: ShipCount 1,
 * ShipSyst -6, ShipBehav 1 — Karrod's flagship).
 *
 * SPECIAL SHIPS WITH AN OUTSTANDING GOAL DO NOT LEAVE THE SYSTEM. The
 * Bible does not say so in as many words, but ShipGoal 6 does: "Chase
 * them off (either kill them or scare them into jumping out of the
 * system)". A goal that is ABOUT making the ships leave is only a goal at
 * all if the ships of the other goals — destroy, disable, board, escort,
 * observe, rescue — stay put; otherwise every destroy target could
 * quietly satisfy nothing by warping out, and the player would be left
 * hunting a system that no longer contains their quarry.
 *
 * So goal ships other than chase-off targets get BOTH a suppressed
 * departure timer (MISSION_SHIP_NO_DEPART_MS) and a SystemHoldComponent
 * (system_hold.ts, reason 'missionGoal'), which between them close every
 * route a ship has out of a system under its own power. Chase-off targets
 * keep natural timers and flee behavior, since leaving is the point. Aux
 * ships are pure atmosphere and keep ordinary NPC behavior throughout.
 *
 * The hold is released — by MissionShipTrackSystem — as soon as the
 * objective is complete or failed, so a boarded sample-carrier or a
 * chased-down bounty is free to go about its business again.
 */

/** Sim time (ms) that never arrives: suppresses NPC auto-departure.
 * A large finite number (not Infinity) so it survives JSON codecs. */
export const MISSION_SHIP_NO_DEPART_MS = 1e15;

/** What spawn building needs from the mission universe (implemented
 * by spaceport/mission_universe.ts; narrowed here so the sim-side
 * modules never depend on the spaceport). */
export interface MissionShipUniverse {
    getMission(id: string): MissionData | undefined;
    systemIdOfPlanet(planetId: string, bits?: ReadonlySet<number>):
        string | undefined;
    getGovt(id: string): GovtData | undefined;
    getSystemInfo(systemId: string): SystemInfo | undefined;
    /**
     * Whether two system ids are stacked copies of one system (same name
     * and map position under mutually exclusive Visibility), so a ship
     * objective frozen to the copy the player cannot enter still spawns
     * in the copy they do (mïsn 737's Moash fleet, frozen to nova:765
     * while the player flies into nova:308).
     */
    sameSystem?(a: string, b: string): boolean;
}

function scatter(random: () => number): Position {
    return new Position(
        (random() * 2 - 1) * INITIAL_SPAWN_HALF_SIZE,
        (random() * 2 - 1) * INITIAL_SPAWN_HALF_SIZE);
}

/**
 * The parts of an ActiveMission the spawn builders read. Structural
 * rather than the io-ts type so the in-flight accept path can hand over
 * the mission it JUST resolved, before it is on any entity.
 */
type MissionShipSource = {
    shipObjective?: ShipObjective,
    shipName?: string,
    shipSubtitle?: string,
    travelPlanet: string | null,
    returnPlanet: string | null,
};

interface SpawnContext {
    gameData: SimulationGameDataInterface;
    universe: MissionShipUniverse;
    ownerUuid: string;
    random(): number;
    /** Next free formation slot on the owner. */
    nextSlot: number;
    /** The owner's control bits, for resolving stellars to the VISIBLE
     * copy of a stacked duplicate system (mission_universe.ts). */
    bits?: ReadonlySet<number>;
}

/**
 * Where a replacement ship is put: the përs hull's own place in the
 * world (përs Flags 0x0040). Passed instead of a ShipStart roll, so the
 * special ship appears exactly where the ship you were talking to was.
 */
export interface ReplacementPlacement {
    position: Position;
    rotation: Angle;
    velocity: Vector;
    /**
     * The përs's own shïp class. The Bible's replacement is a swap of
     * one hull for another, and the stock data is authored so the
     * mission's ShipDude can produce the same class the përs flies — so
     * when it CAN, it does, and the trader you hailed keeps its
     * silhouette instead of turning into a different ship mid-sentence.
     * A dude table that cannot produce it falls back to a normal
     * weighted draw.
     */
    preferShipId?: string;
}

/** Builds one mission ship from a dude draw; null if data is missing. */
async function buildShip(ctx: SpawnContext, missionId: string,
    dudeId: string, options: {
        aux: boolean,
        shipStart: number,
        behavior: number,
        goal: number,
        name?: string,
        subtitle?: string,
        replace?: ReplacementPlacement,
    }): Promise<Entity | null> {
    let dude, shipData;
    try {
        dude = await ctx.gameData.data.Dude.get(dudeId);
        // A replacement keeps the përs's own class when the düde can
        // produce it (see ReplacementPlacement.preferShipId).
        const prefer = options.replace?.preferShipId;
        const choice = (prefer !== undefined
            && dude.ships.some(s => s.id === prefer))
            ? { id: prefer }
            : pickWeighted(dude.ships, { next: ctx.random });
        if (!choice) {
            return null;
        }
        shipData = await ctx.gameData.data.Ship.get(choice.id);
    } catch (e) {
        console.warn(`Mission ship from düde ${dudeId} failed to load:`, e);
        return null;
    }

    const state = options.replace
        ? {
            position: options.replace.position,
            rotation: options.replace.rotation,
            velocity: options.replace.velocity,
        }
        : options.shipStart === 1
            ? jumpInState(shipData, { next: ctx.random })
            : {
                position: scatter(ctx.random),
                rotation: new Angle(ctx.random() * 2 * Math.PI),
                velocity: new Vector(0, 0),
            };
    const ship = makeNpcShip(shipData, dude.aiType, dude.govt,
        state.position, state.rotation, state.velocity);
    if (options.name) {
        // Entity.name is a debugging label; the DISPLAYED name rides the
        // serializer-registered MissionShipComponent below, which is what
        // reaches the target pane and the hail dialog on every client.
        ship.name = options.name;
    }
    ship.components.set(MissionShipComponent, {
        mission: missionId,
        owner: ctx.ownerUuid,
        ...(options.aux ? { aux: true } : {}),
        ...(options.name ? { name: options.name } : {}),
        ...(options.subtitle ? { subtitle: options.subtitle } : {}),
    });
    // Derelict-govt (gövt Flags1 0x0800) mission ships spawn disabled
    // like every other spawn path — e.g. the Kontik probe's derelict
    // Aurora Cruiser, which otherwise flies around alive and well. This
    // path builds ships client-side before any provider system runs, so
    // the data-driven variant seeds the stats directly from ShipData.
    let govtData: GovtData | undefined;
    if (dude.govt) {
        try {
            govtData = await ctx.gameData.data.Govt.get(dude.govt);
        } catch {
            // Unknown govt: not a derelict; spawn normally.
        }
    }
    applyStartsDisabledData(ship, govtData, {
        disableArmorFraction: shipData.disableArmorFraction,
        armor: shipData.physics.armor,
        armorRecharge: shipData.physics.armorRecharge,
        shield: shipData.physics.shield,
        shieldRecharge: shipData.physics.shieldRecharge,
    });
    // mïsn ShipGoal 5: "Rescue them (they start out disabled and stay
    // that way until you board them)". Here it is the MISSION rather than
    // the government that makes the ship a hulk, so the same state is
    // applied unconditionally — a rescue target of an ordinary trading
    // govt is still found adrift. Idempotent with the derelict-govt path
    // above, which writes the identical components.
    if (options.goal === GOAL_RESCUE) {
        makeHulk(ship, {
            armor: shipData.physics.armor,
            armorRecharge: shipData.physics.armorRecharge,
            shield: shipData.physics.shield,
            shieldRecharge: shipData.physics.shieldRecharge,
        });
        // ...and it STAYS here until it has been rescued (Matthew's
        // ruling: a ship that needs refuelling must not leave before it
        // is refuelled). Belt and braces over the hulk state and the
        // suppressed departure timer below — see system_hold.ts for why
        // the invariant is stated outright rather than inferred from
        // them. Released by MissionShipTrackSystem's rescueBoarded, with
        // the disable it lifts, so the refuelled ship really does fly off.
        ship.components.set(SystemHoldComponent, { reason: 'rescue' });
    }
    if (options.aux) {
        return ship;
    }

    const npc = ship.components.get(NpcComponent);
    // GOAL_NONE ships (ambushers, scenery) have no goal to keep them here
    // and nothing that would ever release a hold — they behave like any
    // other ship of their düde (review r14 M2). Chase-off ships must be
    // free to leave: leaving is the goal.
    if (options.goal !== GOAL_CHASE_OFF && options.goal !== GOAL_NONE) {
        // Goal targets must stick around to be fought/boarded/observed.
        //
        // TWO MECHANISMS, because there are two ways out. Pushing
        // `departAt` past any session stops the TIMER-driven departure
        // ("this ship has been here long enough"), and that is all it
        // stops. The hold stops the ones that are not timer-driven:
        //  - a trader with NOWHERE TO GO. The trader loop's fallback when
        //    it cannot pick a stellar to fly to is to leave the system,
        //    and it takes that branch on its FIRST think. That is the
        //    "Take Hyperioid Sample" bug: More Blasters CHEAT mïsn 1000
        //    puts a brave trader (düde nova:147) in NGC-1317, which has
        //    no stellars at all, so the ship the player has to board
        //    warped out about a sixtieth of a second after it appeared.
        //  - a FLEE that reaches the rim, which jumps out (or, failing
        //    that, despawns) without ever being a departure decision.
        // See system_hold.ts, and mission_ship_hold_integration_test.ts.
        if (npc) {
            npc.departAt = MISSION_SHIP_NO_DEPART_MS;
        }
        // GOAL_RESCUE already carries its own hold (below/above), for its
        // own reason; don't overwrite the more specific one.
        if (options.goal !== GOAL_RESCUE) {
            ship.components.set(SystemHoldComponent,
                { reason: 'missionGoal' });
        }
    }
    if (options.behavior === 0 && npc) {
        // Always attack the player: spawn already aggressed.
        npc.aggressor = ctx.ownerUuid;
        ship.components.set(TargetComponent, { target: ctx.ownerUuid });
    } else if (options.behavior === 1 || options.goal === GOAL_ESCORT) {
        // Protect the player / escort cargo: formation on the owner,
        // sharing the owner's firing group (like hired escorts).
        ship.components.set(FormationComponent, {
            leader: ctx.ownerUuid,
            slot: ctx.nextSlot++,
        });
        ship.components.set(FiringGroupComponent,
            { group: ctx.ownerUuid });
    }
    return ship;
}

/**
 * The mission ships of `ownerUuid` that are STILL IN THE WORLD the player
 * is (re)entering, counted per mission. Empty for a hyperspace jump or a
 * gate transit, where the destination world is built from scratch; not
 * empty on a lift-off, where the player returns to the very world they
 * landed in and the owner-absence cleanup may not have swept the previous
 * batch out of it yet.
 *
 * THIS IS WHAT MAKES THE RESPAWN IDEMPOTENT, and it is the second half of
 * "one live batch per system" (the first is that mission ships never ride a
 * transition — see sweepableEscorts). Spawning a full ShipCount into a
 * system that already holds the batch is how a mission's escort turns into
 * a fleet: Matthew's "I gain more escorts every time I change systems".
 * Counting what is already there and building only the difference closes
 * that for every route into a system at once, rather than trusting each of
 * them to have emptied the world first.
 */
export interface LiveMissionShips {
    /** Live special (non-aux) ship uuids, per mission id. */
    special: Map<string, Set<string>>;
    /** Live aux ship count, per mission id. */
    aux: Map<string, number>;
}

export function liveMissionShips(entities: Iterable<[string, Entity]>,
    ownerUuid: string): LiveMissionShips {
    const live: LiveMissionShips = { special: new Map(), aux: new Map() };
    for (const [uuid, entity] of entities) {
        const missionShip = entity.components.get(MissionShipComponent);
        if (!missionShip || missionShip.owner !== ownerUuid) {
            continue;
        }
        if (missionShip.aux) {
            live.aux.set(missionShip.mission,
                (live.aux.get(missionShip.mission) ?? 0) + 1);
        } else {
            const uuids = live.special.get(missionShip.mission)
                ?? new Set<string>();
            uuids.add(uuid);
            live.special.set(missionShip.mission, uuids);
        }
    }
    return live;
}

/**
 * Prepares the mission ships to insert alongside the player entering
 * `systemId`: reconciles the rosters on the player entity's missions
 * (call BEFORE the player entity is encoded into its insertion
 * record) and builds the special/aux ships whose spawn triggers
 * match. `firstSlot` continues the owner's formation slot numbering
 * (after hired escorts).
 *
 * `live` is the batch the world ALREADY holds (see liveMissionShips);
 * omitting it means "a fresh world", which is what a jump or a gate
 * transit hands us.
 */
export async function buildMissionShipSpawns(playerEntity: Entity,
    ownerUuid: string, systemId: string,
    gameData: SimulationGameDataInterface, universe: MissionShipUniverse,
    firstSlot = 0, random: () => number = Math.random,
    live?: LiveMissionShips): Promise<Entity[]> {
    const missions = playerEntity.components.get(MissionsComponent);
    if (!missions || missions.size === 0) {
        return [];
    }
    const ctx: SpawnContext = {
        gameData, universe, ownerUuid, random, nextSlot: firstSlot,
        bits: playerEntity.components.get(ControlBitsComponent),
    };
    const system = universe.getSystemInfo(systemId);
    const ships: Entity[] = [];

    for (const [missionId, active] of missions) {
        const objective = active.shipObjective;
        const stillHere = live?.special.get(missionId) ?? new Set<string>();
        if (objective) {
            // The previous system's ships are gone (the owner-absence
            // cleanup deleted them); forget their uuids so they are
            // not misread as departures. Ships that are demonstrably
            // still in this world KEEP their entries — with them the
            // per-ship progress flags (observed / disabled / boarded)
            // the goal has already banked against those very hulls.
            objective.live = new Map([...objective.live]
                .filter(([uuid]) => stillHere.has(uuid)));
        }
        ships.push(...await buildShipsForMission(ctx, missionId, active,
            systemId, system, undefined, {
            special: stillHere.size,
            aux: live?.aux.get(missionId) ?? 0,
        }));
    }
    return ships;
}

/**
 * One mission's ships for `systemId`: its special ships (when their
 * resolved spawn system matches) and its aux ships (when their
 * membership rule matches). Shared by the per-system-entry sweep above
 * and the IN-FLIGHT accept path (a mission taken from a ship spawns its
 * ships immediately, into the system the player is already flying in),
 * so both produce identical ships from identical state.
 *
 * Does NOT clear the objective's `live` roster — the sweep above owns
 * that, because it also has to clear rosters for missions whose ships
 * do not spawn here.
 */
async function buildShipsForMission(ctx: SpawnContext, missionId: string,
    active: MissionShipSource,
    systemId: string, system: SystemInfo | undefined,
    replace?: ReplacementPlacement,
    /** What this system already holds of this mission's batch. */
    alreadyHere: { special: number, aux: number }
        = { special: 0, aux: 0 }): Promise<Entity[]> {
    const { universe, random } = ctx;
    const mission = universe.getMission(missionId);
    const objective = active.shipObjective;
    const ships: Entity[] = [];
    if (objective
        && (objective.systemId === null || objective.systemId === systemId
            || (universe.sameSystem?.(objective.systemId, systemId)
                ?? false))) {
        // The mission's special ships all wear the name picked
        // from its ShipNameID STR# list when the mission was
        // accepted (mission_logic.ts), which is also what <SN>
        // expands to — so the target pane and the briefing
        // agree, and re-entering the system respawns the same
        // name. Missions accepted before <SN> existed carry no
        // shipName; they keep the old per-spawn random pick.
        const names = mission?.shipNames ?? [];
        const name = active.shipName
            ?? (names.length > 0
                ? names[Math.floor(random() * names.length)]
                : undefined);
        // The ShipSubtitle sibling, frozen at accept the same way.
        const subtitle = active.shipSubtitle;
        // Only the SHORTFALL: whatever of this batch is already flying
        // here counts towards ShipCount (see LiveMissionShips).
        const count = Math.max(0,
            shipsToSpawn(objective) - alreadyHere.special);
        for (let i = count; i > 0; i--) {
            const ship = await buildShip(ctx, missionId, objective.dudeId, {
                aux: false,
                shipStart: objective.shipStart,
                behavior: objective.behavior,
                goal: objective.goal,
                name,
                subtitle,
                // A përs replacement is by the Bible's own wording a
                // SINGLE special ship ("with a single special ship");
                // only the first gets the përs's berth, and a
                // (non-stock) multi-ship mission scatters the rest.
                ...(replace && i === count ? { replace } : {}),
            });
            if (ship) {
                ships.push(ship);
            }
        }
    }
    // Aux ships: pure atmosphere, membership-matched per system.
    // Flag 0x0010 (infinite aux ships) is not modeled beyond the
    // once-per-system-entry respawn that naturally happens here.
    if (mission && system && auxShipsMatchSystem(mission, active,
        system, id => universe.systemIdOfPlanet(id, ctx.bits),
        id => universe.getGovt(id))) {
        const auxWanted =
            Math.max(0, mission.auxShipCount - alreadyHere.aux);
        for (let i = 0; i < auxWanted; i++) {
            const ship = await buildShip(ctx, missionId,
                mission.auxShipDudeId!, {
                aux: true, shipStart: 1, behavior: -1, goal: -1,
            });
            if (ship) {
                ships.push(ship);
            }
        }
    }
    return ships;
}

/**
 * The ships a mission accepted IN FLIGHT (from a përs ship — see
 * mission_accept.ts) must spawn right now, in the system the player is
 * already in. The sibling of buildMissionShipSpawns, which handles the
 * ships a mission spawns when its owner ENTERS a system; this is the
 * case where the mission arrives instead of the player.
 *
 * `replace` (përs Flags 0x0040) puts the mission's single special ship
 * at the offering hull's own position; the sim then deletes that hull in
 * the same apply, so it "becomes" the special ship in place.
 *
 * `active` is the ActiveMission the accept resolved, NOT yet on the
 * player entity — the whole batch rides the acceptMission input record
 * with it, so the mission and its ships land on the same tick.
 */
export async function buildAcceptedMissionShips(missionId: string,
    active: MissionShipSource,
    ownerUuid: string, systemId: string,
    gameData: SimulationGameDataInterface, universe: MissionShipUniverse,
    options: {
        replace?: ReplacementPlacement,
        firstSlot?: number,
        random?: () => number,
        /** The player's control bits (visible-copy stellar resolution). */
        bits?: ReadonlySet<number>,
    } = {}): Promise<Entity[]> {
    const ctx: SpawnContext = {
        gameData, universe, ownerUuid,
        random: options.random ?? Math.random,
        nextSlot: options.firstSlot ?? 0,
        bits: options.bits,
    };
    return buildShipsForMission(ctx, missionId, active, systemId,
        universe.getSystemInfo(systemId), options.replace);
}
