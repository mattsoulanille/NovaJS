/**
 * ============================================================================
 * Docking: spaceport landings and hypergate docks, and the lift-offs
 * ============================================================================
 *
 * A landing is a two-phase affair. The simulation announces it
 * (LandEvent) while the ship is still in the world; the CLIENT then, on
 * its next pump frame, removes the ship from the simulation (an input
 * record every peer applies), holds the entity itself, and opens the
 * venue. A lift-off is the mirror: the venue announces the departure
 * (LeaveSpaceportEvent / LeaveGateMapEvent) with the committed entity,
 * and the next pump frame puts the fleet back through the one insertion
 * sequence (client/fleet_insertion.ts).
 *
 * The two phases are the `landing` -> `landed` (-> `landed{launching}`
 * -> `inSpace`) and `gateLanding` -> `gateMap` (-> `gateMap{launching}`
 * -> `inSpace`) legs of the client state machine. The event handlers
 * here move the first half of each leg; {@link runDockingFrame}, called
 * by the frame pump, performs the second half's effects in the order the
 * pump always ran them.
 */
import type { Entity } from 'nova_ecs/entity';
import type { World } from 'nova_ecs/world';
import { v4 } from 'uuid';
import { OpenGateMapEvent } from '../display/gate_map_plugin.js';
import { OpenSpaceportEvent } from '../display/spaceport_plugin.js';
import {
    DISCOVERY_LANDED, markDiscovered, PlayerShipSelector,
} from '../nova_plugin/player/index.js';
import { PlanetTargetComponent } from '../nova_plugin/travel/index.js';
import { TargetComponent } from '../nova_plugin/ship/index.js';
import { PendingEscortsComponent } from '../spaceport/pending_escorts.js';
import {
    dock, dockAtGate, gateLaunched, land, landAtGate, launched, LiveSystem,
    requestLaunch, swapDockedShip,
} from './client_state.js';
import { insertPlayerAndFleet } from './fleet_insertion.js';
import { prepareMissionShips } from './fleet_ledger.js';
import type { ClientRuntime } from './runtime.js';

/**
 * Landing drops your target. In the original you have no reticle while
 * landed and none when you lift off again — targeting simply does not
 * survive a landing — so both the ship target and the stellar selection
 * go as the ship is docked.
 *
 * Done HERE, on the entity the client is holding out of the world, which
 * is the same commit pattern the spaceport uses for everything else it
 * changes while docked (fuel, outfits, cargo): the cleared components
 * ride back into the simulation with the launch's addEntity input
 * record, so every peer sees the same thing at the same tick and nothing
 * is written behind the sim's back. The display's own reticles are taken
 * down by the corner sweep systems (target_corners_plugin): the drawing
 * systems run on the player's entity, and a docked player has no entity
 * in the display world at all.
 */
function clearTargetsOnLanding(ship: Entity): void {
    if (ship.components.has(TargetComponent)) {
        ship.components.set(TargetComponent, { target: undefined });
    }
    if (ship.components.has(PlanetTargetComponent)) {
        ship.components.set(PlanetTargetComponent, { target: undefined });
    }
}

/**
 * LandEvent from the simulation. Only the local player's landing, and
 * only from flight: a landing already pending or standing ignores it.
 */
export function onLand(runtime: ClientRuntime, world: World,
    data: { id: string }, entities: ReadonlyArray<string | Entity> | undefined):
    void {
    const { state, gameData, saves } = runtime;
    if (state.state.kind !== 'inSpace') {
        return;
    }
    // The planet's data is warm here (makeSystem loaded every planet in
    // this system before the world stepped).
    const landedPlanet = gameData.data.Planet.getCached(data.id);
    // Landing on a WORMHOLE transits immediately: the sim handles the
    // whole transfer (GateDepartureSystem -> GateTransitEvent) and nothing
    // docks or opens here.
    if (landedPlanet?.gate?.kind === 'wormhole') {
        return;
    }
    const playerShipRef = entities?.[0];
    const playerShipUuid = typeof playerShipRef === 'string'
        ? playerShipRef : playerShipRef?.uuid;
    const playerShip = playerShipUuid
        ? world.entities.get(playerShipUuid) : undefined;
    if (!playerShipUuid || !playerShip
        || !playerShip.components.has(PlayerShipSelector)) {
        return;
    }
    const ship = { uuid: playerShipUuid, entity: playerShip, planetId: data.id };
    // Landing on a HYPERGATE docks the ship (removed from the system like
    // a spaceport landing) and opens the hypergate map, where the player
    // picks one of the gate's linked neighbors (or lifts back off).
    state.apply(s => landedPlanet?.gate?.kind === 'hypergate'
        ? landAtGate(s, ship) : land(s, ship));
    // Landing is a natural save point — the hypergate dock exactly like
    // the spaceport one: the ship is out of the sim from here until it
    // transits or lifts off, and the periodic save reads it through the
    // docked state (issue #69).
    saves.saveNow();
}

/**
 * LeaveSpaceportEvent: the player hit Depart. Departure is THE
 * checkpoint (the original saved the pilot file on every depart). The
 * relaunching entity carries everything the venues committed, including
 * a ship bought at the shipyard and the escort deals the spaceport
 * settled on the way out (spaceport/escort_deals.ts: the Leave settles
 * them, shows the player the report, and resolves only once that dialog
 * is closed — so by the time this fires the roster already lacks the
 * escorts that were sold and the ledger already holds the money).
 */
export function onLeaveSpaceport(runtime: ClientRuntime, launching: Entity):
    void {
    const { state, gameData, saves } = runtime;
    const current = state.state;
    // The docked handle names the stellar; read it before the state moves
    // (the launch is still one frame away, and the handle survives it).
    const planetId = current.kind === 'landed' ? current.ship.planetId : undefined;
    state.apply(s => requestLaunch(s, launching));
    const planetName = planetId
        ? gameData.data.Planet.getCached(planetId)?.name
        : undefined;
    saves.recordCheckpointNow({
        label: `Departed ${planetName ?? 'the spaceport'}`,
        kind: 'depart',
        entity: launching,
        ...(planetId ? { stellar: planetId } : {}),
    });
}

/**
 * The docking half of a pump frame, in the order the pump always ran
 * its blocks: dock a pending spaceport landing, launch a requested
 * departure, dock a pending hypergate landing, lift off from a gate
 * whose map closed without a pick. Each block re-reads the state, so a
 * block's transition is seen by the ones after it in the same frame
 * exactly as the flag writes were.
 *
 * NOTHING SETTLES HERE while the player is docked. The escort deals
 * queued over the comm channel settle in the SPACEPORT'S Leave
 * (spaceport/escort_deals.ts, ruling #249): the spaceport settles them,
 * shows the player the report, and only then resolves its show() into
 * LeaveSpaceportEvent — which is what sets `launching` and lets the
 * launch block below build the insertion records. So the fleet cannot
 * be in space before the player has closed that dialog, and a frame that
 * runs while the dialog is up finds a `landed` state with nothing to
 * launch and does nothing.
 *
 * `live` is the system this frame captured; every await inside is
 * against its bridge, and a transition that takes the bridge away
 * settles the await with SimulationBridgeClosedError, which the pump
 * treats as the frame's end.
 */
export async function runDockingFrame(runtime: ClientRuntime,
    live: LiveSystem): Promise<void> {
    const { state, fleet, gameData, communicator } = runtime;
    const { bridge, world } = live;

    let current = state.state;
    if (current.kind === 'landing') {
        const { ship } = current;
        await bridge.removeEntity(ship.uuid);
        clearTargetsOnLanding(ship.entity);
        // Landing is how a system reaches discovery level 2: you learn
        // what the ports sell and what they trade in, which is the pilot
        // file's "visited and landed within" (see discovery.ts). Entering
        // the system already set level 1.
        markDiscovered(live.systemId, DISCOVERY_LANDED);
        world.emit(OpenSpaceportEvent, {
            planetId: ship.planetId,
            ship: ship.entity,
            // The ship has just been pulled out of the world, but things
            // it launched (bay fighters) still point at this uuid, so the
            // outfitter can find them.
            uuid: ship.uuid,
            // Live getter, not a snapshot: fighters keep landing into the
            // roster while the player shops, and each one still counts
            // against the outfitter's buy caps.
            landedEscorts: () => fleet.landed,
            // A ship bought at the shipyard is a NEW entity, and every
            // save is built from whichever one the docked handle names.
            // The spaceport publishes the trade as it happens so the
            // handle follows the hull that will actually lift off
            // (Spaceport.adoptPurchasedShip).
            onShipSwap: (hull: Entity) => {
                try {
                    swapDockedShip(state.state, hull);
                } catch (e) {
                    console.warn('Ship swap outside a dock ignored:', e);
                }
            },
        });
        current = state.apply(dock);
    }
    if (current.kind === 'landed' && current.launching) {
        const launching = current.launching;
        const docked = current.ship;
        // Escorts hired in the bar spawn alongside the relaunched player
        // ship. The pending list is display-side bookkeeping; pop it
        // before the entity is encoded into the addEntity input record.
        const pendingEscorts =
            launching.components.get(PendingEscortsComponent) ?? [];
        launching.components.delete(PendingEscortsComponent);
        // Escorts that landed with the player take off with them, still
        // carrying their damage, outfits, and (for deployed bay fighters)
        // their bay identity. Escorts that never made it down are
        // re-attached in the simulation instead (EscortReattachSystem).
        const returningEscorts =
            await fleet.takeLandedEscortsRestocked(docked.uuid, gameData);
        try {
            // One slot run across all three batches inserted by this
            // launch: the display world does not see any of them until a
            // later frame, so each batch must be told where to start.
            const launchBaseSlot = fleet.nextClientSlot(world, docked.uuid);
            const missionBaseSlot = launchBaseSlot
                + returningEscorts.length + pendingEscorts.length;
            // Mission ships spawn alongside the relaunch; prepared before
            // the player entity is encoded, inserted after it.
            const missionShips = await prepareMissionShips(gameData,
                launching, docked.uuid, live.systemId, missionBaseSlot, world);
            fleet.noteSlotsUsed(docked.uuid, missionBaseSlot);
            // THE ONE INSERTION SEQUENCE (client/fleet_insertion.ts):
            // player (stamped with the multiplayer identity — a ship
            // bought at the shipyard is a fresh entity), returning
            // escorts, hires, mission ships.
            const inserted = await insertPlayerAndFleet({
                bridge, playerUuid: docked.uuid, player: launching,
                escorts: returningEscorts, hires: pendingEscorts, missionShips,
                ownerUuid: communicator.uuid ?? undefined,
                baseSlot: launchBaseSlot, mintUuid: v4,
                getShip: id => gameData.data.Ship.get(id),
            });
            // An escort whose own insertion rejected goes back on the
            // roster; the in-flight flush retries it.
            fleet.landed.push(...inserted.failed);
        } catch (e) {
            // The player's own insertion rejected: nothing went in.
            // Everything goes back where it was — the escorts to the
            // landed roster, the hires onto the docked entity — and the
            // block runs again next frame with the state still `landed`
            // and `launching` (issue #31). Before this, the re-run found
            // an empty roster and a popped hire list: the fleet was gone
            // from the session and from the next save.
            fleet.landed.push(...returningEscorts);
            if (pendingEscorts.length > 0) {
                launching.components.set(PendingEscortsComponent,
                    pendingEscorts);
            }
            throw e;
        }
        if (launching.components.has(PlayerShipSelector)) {
            window.myShip = launching;
        }
        current = state.apply(launched);
    }
    // Hypergate docking, mirroring the spaceport dock above: remove the
    // landed ship from the sim and open the hypergate map.
    if (current.kind === 'gateLanding') {
        const { ship } = current;
        await bridge.removeEntity(ship.uuid);
        // Docking at a gate drops the target too — same rule, and the
        // ship either transits (new world) or lifts back off.
        clearTargetsOnLanding(ship.entity);
        world.emit(OpenGateMapEvent, {
            gateSpob: ship.planetId,
            systemId: live.systemId,
            ship: ship.entity,
        });
        current = state.apply(dockAtGate);
    }
    // The map closed without a destination: lift back off from the gate
    // into the origin system (nothing strands the ship).
    if (current.kind === 'gateMap' && current.launching) {
        const launching = current.launching;
        const docked = current.ship;
        // Any escorts that had already landed also lift off here, exactly
        // as at a spaceport — otherwise a roster captured before the gate
        // dock would be stranded out of the world.
        const gateEscorts =
            await fleet.takeLandedEscortsRestocked(docked.uuid, gameData);
        try {
            const gateBaseSlot = fleet.nextClientSlot(world, docked.uuid);
            // Mission ships despawned while gate-docked; respawn them with
            // the lift-off (same shape as the spaceport launch above).
            const gateMissionShips = await prepareMissionShips(gameData,
                launching, docked.uuid, live.systemId,
                gateBaseSlot + gateEscorts.length, world);
            fleet.noteSlotsUsed(docked.uuid, gateBaseSlot + gateEscorts.length);
            // The same insertion sequence as the spaceport launch.
            const inserted = await insertPlayerAndFleet({
                bridge, playerUuid: docked.uuid, player: launching,
                escorts: gateEscorts, missionShips: gateMissionShips,
                ownerUuid: communicator.uuid ?? undefined,
                baseSlot: gateBaseSlot, mintUuid: v4,
                getShip: id => gameData.data.Ship.get(id),
            });
            fleet.landed.push(...inserted.failed);
        } catch (e) {
            // Same failure policy as the spaceport launch above.
            fleet.landed.push(...gateEscorts);
            throw e;
        }
        if (launching.components.has(PlayerShipSelector)) {
            window.myShip = launching;
        }
        state.apply(gateLaunched);
    }
}
