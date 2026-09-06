/**
 * ============================================================================
 * Entering a system: the one transition that builds a world
 * ============================================================================
 *
 * Every way the local player arrives in a system — the startup entry, a
 * hyperspace jump, a hypergate pick, a wormhole, a recovery re-entry —
 * comes through {@link jumpTo}. It tears the system being left down,
 * claims the destination (names it, joins its room), builds the
 * serializer world and the simulation worker, joins the room's history,
 * builds the display world, waits for the server peer, inserts the
 * player and its fleet, and publishes the whole thing as ONE
 * {@link LiveSystem} on the client state machine (client/client_state.ts):
 * `beginTransit` -> `originTornDown` -> `claimSystem` -> `arrive`.
 *
 * Under a session generation (client/session_transitions.ts): an
 * exit-to-title mid-way invalidates the scope, the next `check()` throws,
 * the scope's failure cleanups terminate the worker and release the
 * claim, and the escort batch goes back to its rosters. No world is ever
 * published over the title screen.
 */
import * as Comlink from 'comlink';
import { CommunicatorResource } from 'nova_ecs/plugins/multiplayer_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimePlugin } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { filter, firstValueFrom, Subscription, timeout } from 'rxjs';
import { v4 } from 'uuid';
import {
    applySimulationFrame, movementSyncedSinceStep, syncedComponents,
    warnedUnsyncableEntities,
} from '../communication/apply_simulation_frame.js';
import type { AsyncSimulationBridgeClient } from '../communication/async_simulation_bridge_client.js';
import {
    makeBrowserSimulationBridgeClient,
} from '../communication/simulation_bridge_browser_worker.js';
import { DebugSettings } from '../debug_settings.js';
import { Display } from '../display/display_plugin.js';
import { GateArrivalAnticipationEvent } from '../display/gate_animation_plugin.js';
import { PixiAppResource } from '../display/pixi_app_resource.js';
import { DisplayRoot } from '../display/stage_resource.js';
import { ControlsSubject } from '../nova_plugin/controls_plugin.js';
import {
    DisplayAssetDataResource, SimulationGameDataResource,
} from '../nova_plugin/game_data_resource.js';
import { GateArrivalComponent } from '../nova_plugin/gate_transit_plugin.js';
import { reconcileRouteOnArrival } from '../nova_plugin/jump_plugin.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import { restoreSavedEscorts } from '../nova_plugin/save_game.js';
import { SystemIdResource } from '../nova_plugin/system_id_resource.js';
import {
    prepareCarriedEntitiesForFreshWorld,
} from '../nova_plugin/transition_prep.js';
import {
    carriedBatchMustHold, CarriedEscort, restoreFailedTransitionBatch,
    takeEscortsForTransition,
} from '../spaceport/landed_escorts.js';
import { resetOfferRolls } from '../spaceport/mission_offers.js';
import { claimActiveSystem } from './active_system_claim.js';
import {
    arrive, beginTransit, claimSystem, ClientState, liveSystem, LiveSystem,
    originTornDown, releaseClaim, TransitPlan,
} from './client_state.js';
import { insertPlayerAndFleet } from './fleet_insertion.js';
import { prepareMissionShips } from './fleet_ledger.js';
import { ClientRuntime, SERVER_PEER_TIMEOUT_MS } from './runtime.js';
import { isSessionEnded, TransitionScope } from './session_transitions.js';

/**
 * Subscribes the client's handlers to a freshly built display world's
 * events (landing, departure, jumps, gate transits, escort carries, the
 * dialogs' bridge calls). Supplied by the game session, which owns those
 * handlers; kept out of here so this module has no reason to know about
 * them.
 */
export type WorldWiring = (world: World,
    bridge: AsyncSimulationBridgeClient, systemId: string) => void;

/**
 * Moves the player to another system. Takes the escorts riding along out
 * of the client's rosters first, and — whatever happens — never drops
 * them on the floor.
 *
 * The batch has to be taken BEFORE the teardown inside, but everything
 * after that point awaits a world build, a worker, and a room join, any
 * of which can reject. A local variable would take the batch with it, so
 * a failed transition hands it back to the roster it came from, where
 * the standing flush picks it up as soon as there is a player ship to put
 * it beside. (The ship itself is the caller's problem: client/transit.ts
 * recovers it.)
 */
export async function jumpTo(runtime: ClientRuntime, plan: TransitPlan,
    wire: WorldWiring): Promise<void> {
    // Take the escorts that left this system with the player BEFORE the
    // teardown drops the old system's state. Anything left over belongs
    // to another peer's player, whose own client carries it.
    //
    // A landed roster is taken along too rather than discarded: this path
    // also serves a hypergate/wormhole transit, where the player can dock
    // at the gate holding escorts that already left the simulation. They
    // ride to the destination instead of being lost. (A gate transit's
    // escorts arrive on the LANDED roster too — they are swept at the
    // gate, where no destination system exists to name yet — so this one
    // take covers hyperspace jumps, hypergates and wormholes alike.)
    // NEITHER HALF IS RESTOCKED HERE: see takeEscortsForTransition.
    const { fleet } = runtime;
    const { batch: jumpEscorts, fromLanded } = takeEscortsForTransition(
        fleet.jumping, fleet.landed, plan.uuid);
    // Run as a TRACKED transition of the current session: an exit-to-title
    // in the middle of it invalidates the scope, enterSystem bails at its
    // next check, and the teardown waits for that before it resets the
    // rosters — so the batch handed back below lands before the reset,
    // never after it (issue #30).
    try {
        await runtime.transitions.run(scope => enterSystem(runtime, plan,
            jumpEscorts, scope, wire));
    } catch (e) {
        // Never drop a single escort — but put each one back on the
        // roster it came from, so a landed escort keeps its landed
        // bookkeeping instead of being quietly reclassified as mid-jump.
        //
        // UNLESS THE SESSION IS GONE: then the rosters belong to no one
        // (the teardown resets them, and the save that stands predates
        // the jump), and a batch pushed onto them from here would be
        // dealt into the NEXT session's first system.
        if (!isSessionEnded(e)) {
            const back = restoreFailedTransitionBatch(jumpEscorts, fromLanded);
            fleet.landed.push(...back.landed);
            fleet.jumping.push(...back.jumping);
        }
        throw e;
    }
}

async function makeDisplayWorld(runtime: ClientRuntime, systemId: string):
    Promise<World> {
    const displayWorld = new World(`${systemId} display`);
    displayWorld.resources.set(SimulationGameDataResource, runtime.gameData);
    displayWorld.resources.set(DisplayAssetDataResource,
        runtime.displayAssetData);
    displayWorld.resources.set(PixiAppResource, runtime.app);
    displayWorld.resources.set(SystemIdResource, systemId);
    displayWorld.resources.set(ControlsSubject, runtime.controlsSubject);
    displayWorld.resources.set(CommunicatorResource, runtime.communicator);
    // The display world keeps its own wall-clock time for smooth
    // rendering. (The simulation runs on fixed, 0-based logical time,
    // which is not copied into the display world.)
    await displayWorld.addPlugin(TimePlugin);
    await displayWorld.addPlugin(Display);
    return displayWorld;
}

/**
 * Tears a live system down: detaches and closes the simulation bridge,
 * unsubscribes the room forwarders, removes the display stage, leaves
 * the system room, drops the Display plugin, and clears the synced
 * entities. Shared by a system transition (which then joins the next
 * system) and by leaving the game entirely (exit-to-title). The caller
 * moves the state machine; this only performs the effects.
 *
 * THE PLAYER'S SHIP IS NOT REMOVED HERE. It used to be scheduled as a
 * `removeEntity` input just before `close()`, on the theory that every
 * other peer would see it vanish — but an input is only published by a
 * `step()`, and nothing steps between the two calls (the pump is
 * detached first, by design), so the record never left this client
 * (issue #68). On a jump or a gate pick the simulation has already
 * deleted the ship on every peer anyway; on an exit-to-title the
 * mechanism that actually removes it is the room leave below: the
 * server's relay authors a `removePeer` record for a peer that leaves
 * (rollback_relay.ts), which every peer applies deterministically to
 * everything this peer owned.
 */
export async function teardownLiveSystem(runtime: ClientRuntime,
    live: LiveSystem): Promise<void> {
    // Close the bridge FIRST, so no new pump frame starts a call against
    // the dying worker (the pump reads the bridge off the state, which
    // the caller has already moved on from). A frame already awaiting
    // one is unwedged by close(), which settles every in-flight call with
    // SimulationBridgeClosedError (the pump treats that as "a transition
    // took my bridge").
    await live.bridge.close();
    for (const subscription of live.roomSubscriptions) {
        subscription.unsubscribe();
    }
    const root = live.world.resources.get(DisplayRoot);
    if (root) {
        runtime.app.stage.removeChild(root);
    }
    runtime.multiRoom.leave(live.systemId);
    await live.world.removePlugin(Display);
    for (const uuid of syncedComponents.keys()) {
        live.world.entities.delete(uuid);
    }
    syncedComponents.clear();
    // The freshness stamps name uuids from the world being torn down.
    movementSyncedSinceStep.clear();
}

async function enterSystem(runtime: ClientRuntime, plan: TransitPlan,
    jumpEscorts: CarriedEscort[], scope: TransitionScope,
    wire: WorldWiring): Promise<void> {
    const { state, fleet, gameData, multiRoom, app, communicator } = runtime;
    const { entity, to, uuid } = plan;
    // The session may already have ended while the caller was awaiting
    // something ahead of this (the FinishJumpEvent handler's date advance
    // runs the mission preload on the first jump): nothing below may
    // touch the torn-down session.
    scope.check();
    runtime.autopilot?.cancel();
    // A multi-jump chain (ModType 32) is about to auto-continue out of
    // the system we are arriving in. Hold the batch rather than inserting
    // it there: an insertion record that lands after the chain has moved
    // on would strand its escort. Read off the player's own entity,
    // before it is re-inserted and the destination world turns the
    // budget into its continue marker (see multiJumpChainContinues).
    // A GATE arrival is positioned by GateArrivalSystem on the first tick
    // in the destination world, so the entity still holds its ORIGIN
    // station here. Hold the batch exactly as a chained one is and let
    // flushCarriedJumpEscorts put it down once the marker clears (see
    // gateArrivalPending).
    const holdBatch = carriedBatchMustHold(entity);
    fleet.resetSlotFloor(); // Fresh world, fresh slot run.
    // "Mission randomizing values are recalculated each time you warp
    // into a system" (EVN Bible, AvailRandom). The spaceport keys its
    // visit rolls by system id, which cannot see a jump out and straight
    // back in with no landing between; this is the system-entry hook
    // that closes that gap (spaceport/mission_offers.ts).
    resetOfferRolls();
    // LEAVE: the docked handles (if any) go with the system being left;
    // the origin rides the transit state until it is torn down.
    const origin = liveSystem(state.apply(s => beginTransit(s, plan)));
    if (origin) {
        await teardownLiveSystem(runtime, origin);
        state.apply(originTornDown);
    }
    scope.check();
    // Name the destination and join its room, with the undo registered on
    // the scope: a rejection anywhere below, before a world is published,
    // leaves the room again and clears the claim, so the state never
    // names a system with no world behind it (client/active_system_claim.ts).
    const room = claimActiveSystem(scope, to, multiRoom, {
        get: () => {
            const s = state.state;
            return s.kind === 'transit' ? s.claim?.systemId : undefined;
        },
        set: id => {
            if (id === undefined) {
                state.apply(releaseClaim);
            } else {
                state.apply(s => claimSystem(s, { systemId: id }));
            }
        },
        published: () => state.state.kind !== 'transit',
    });
    // The long waits below go through scope.race so an exit-to-title
    // settles them at once instead of waiting out a world build or a
    // room join it is about to throw away.
    const serializerWorld = await scope.race(
        makeSystem(to, gameData, 'worker'));
    const serializer = serializerWorld.resources.get(SerializerResource);
    if (!serializer) {
        throw new Error('Expected simulation serializer resource to exist');
    }
    // Test/driving lever (see visual_compare/driver.mjs): the simulation
    // serializer's componentsByName registry is the only in-page handle
    // on the synced-component singletons (e.g. the Boarding component),
    // which the headless harness needs to inject dialog state the way
    // novaHailDialog drives the comm dialog. Not used by gameplay.
    window.novaSimSerializer = serializer;

    // A loaded save's escorts decode HERE, at the first moment in a
    // session that a serializer exists. They are pushed into this
    // transition's carried batch, which the insertion below already
    // handles — fresh uuids, intra-batch carrier remapping, formation
    // stations, commands reset to 'formation'. Pushing (rather than
    // reassigning) also means jumpTo's failure path hands them back to
    // the jump roster with the rest, so a failed startup transition
    // cannot drop them.
    const restoredSave = fleet.restoredSave;
    if (restoredSave) {
        fleet.restoredSave = undefined; // One-shot: the startup transit.
        const priorPlayer = restoredSave.playerUuid;
        // The pilot's own uuid is what makes the phantom-bay-fighter
        // cleanup possible at all (every reference inside a saved escort
        // is in the pre-save namespace); without one the array is
        // restored verbatim, exactly as it always was.
        const restored = restoreSavedEscorts(restoredSave.escorts, serializer,
            priorPlayer !== undefined
                ? { player: priorPlayer, armament: restoredSave.armament }
                : undefined);
        // `priorPlayer` rides each entry so a fighter the player had
        // launched from its own bays comes back pointing at the LIVE
        // player rather than the pre-save uuid. Absent in a save written
        // before the field existed, in which case nothing is remapped.
        jumpEscorts.push(...restored.map(escort => ({
            ...escort, player: uuid, priorPlayer,
        })));
        if (restored.length > 0) {
            console.info(`Restored ${restored.length} escort(s) from the `
                + `saved game.`);
        }
    }

    // THE CARRIED-ENTITY PREPARATION FOR A FRESH WORLD, player and escorts
    // alike: aggression tables, the player's reticles, every escort's
    // out-of-batch references. Run HERE rather than back in jumpTo
    // because the batch is only final now: a restored save's escorts were
    // pushed onto it just above. See prepareCarriedEntitiesForFreshWorld.
    prepareCarriedEntitiesForFreshWorld(entity, uuid, jumpEscorts);

    const worker = new Worker('/simulation_bridge_browser_worker_bundle.js', {
        type: 'module',
    });
    const { host, client: bridge } = makeBrowserSimulationBridgeClient(
        worker, serializer);

    // From here on there is a Worker to account for. It is published (as
    // part of the LiveSystem) only at the very end, so a rejection
    // anywhere in between — the room join, the snapshot, the display
    // world, an insertion, or the session ending — used to leave it
    // alive for the page lifetime, still joined to the room under this
    // peer's uuid (issue #67). Closing the bridge terminates it; the
    // scope runs this if (and only if) the transition rejects.
    let roomSubscriptions: Subscription[] = [];
    scope.onFailure(async () => {
        for (const subscription of roomSubscriptions) {
            subscription.unsubscribe();
        }
        roomSubscriptions = [];
        await bridge.close();
    });

    // Forward room traffic to the worker BEFORE init: init awaits
    // joinRoom, whose catch-up reply arrives on this channel. With the
    // subscription after init, every join's reply was dropped and the
    // world silently started at tick 0 in a room with real history (the
    // first desync's resync then papered over it). The worker buffers
    // anything that arrives before its communicator exists.
    roomSubscriptions = [
        room.messages.subscribe(({ source, message }) => {
            void host.receiveRoomMessage(source, message);
        }),
        room.peers.current.subscribe(peers => {
            void host.updateRoomState({ peers });
        }),
        room.connected.subscribe(connected => {
            void host.updateRoomState({ connected });
        }),
    ];

    await scope.race(host.init(
        {
            systemId: to,
            roomState: {
                uuid: room.uuid,
                peers: room.peers.current.value,
                connected: room.connected.value,
                servers: room.servers.value,
            },
        },
        Comlink.proxy(async (message, destination) => {
            room.sendMessage(message, destination);
        }),
    ));

    const initialFrame = await scope.race(bridge.snapshot());
    const displayWorld = await makeDisplayWorld(runtime, to);
    scope.check();
    if (plan.arrivalSpob !== undefined) {
        // Announce the incoming gate arrival before the room join
        // completes: the event is queued and processed once this world
        // starts stepping (its planets are inserted by then), opening the
        // destination gate ahead of the ship's appearance.
        displayWorld.emit(GateArrivalAnticipationEvent,
            { spob: plan.arrivalSpob });
    }
    window.simulationWorker = worker;
    window.displayWorld = displayWorld;

    const root = displayWorld.resources.get(DisplayRoot);
    if (!root) {
        throw new Error('World did not have Pixi Stage');
    }
    app.stage.addChild(root);
    root.visible = true;
    // Hand the fresh world the current scales and viewport sizes: the UI
    // layer's transform, the DisplayScale resource the camera reads, and
    // one ResizeEvent so ScreenSize / WorldScreenSize are right from the
    // first frame rather than the window-sized values ScreenSizePlugin
    // seeds them with.
    runtime.applyDisplayScale(displayWorld);
    wire(displayWorld, bridge, to);

    // Wait until the current peer set includes the server, without racing
    // between an immediate state check and a later join event
    // subscription. BOUNDED (issue #72): a socket drop mid-transition
    // used to leave this waiting forever, white screen up, escort batch
    // held in a local. The rxjs timeout drops the subscription and
    // rejects, which lands on the recovery paths like any other failed
    // transition; the session ending settles it sooner still.
    await scope.race(firstValueFrom(room.peers.current.pipe(
        filter(peers => peers.has('server')),
        timeout({ first: SERVER_PEER_TIMEOUT_MS }))));
    // Escorts that followed the player through hyperspace are inserted
    // at formation stations around the arrival point, coasting in at the
    // player's arrival velocity. Instant carry with no warp-in animation
    // of their own (documented v1 seam). Their commands are reset to
    // formation by prepareCarriedEscorts, which also keeps any
    // carrier-and-wing relationships inside the batch intact.
    //
    // UNLESS the batch must be HELD: another hop is coming, or the player
    // has not been placed at its arrival gate yet. Then it waits rather
    // than being put down here. The next jumpTo takes it straight back
    // out of the roster (same player uuid), and flushCarriedJumpEscorts
    // puts it down once the chain ends / the gate exit is known.
    const arrivingEscorts = holdBatch ? [] : jumpEscorts;
    // Mission ships whose spawn system this is (or that follow the
    // player) jump in with the player. Prepared before the player entity
    // is encoded into its insertion record. Unconditional on purpose:
    // every transit carries the LOCAL PLAYER'S ship, and an entity with
    // no MissionsComponent builds nothing anyway.
    const missionShips = await prepareMissionShips(gameData, entity, uuid,
        to, arrivingEscorts.length);
    scope.check();
    // A gate/wormhole arrival reconciles the pinned route with where the
    // player actually is (a hyperspace arrival's route is already right —
    // beginJump shifted it at jump start; see reconcileRouteOnArrival).
    // The entity carries a GateArrivalComponent exactly when it came by
    // gate. Mutating the held entity BEFORE it is encoded into its
    // insertion record keeps this on the owner-driven input path.
    reconcileRouteOnArrival(entity, to,
        entity.components.has(GateArrivalComponent) ? 'gate' : 'jump');
    // THE ONE INSERTION SEQUENCE (client/fleet_insertion.ts): player,
    // carried escorts, mission ships. A fresh world has a fresh slot run
    // (the floor was reset above), so stations start at 0.
    fleet.noteSlotsUsed(uuid, arrivingEscorts.length);
    const inserted = await insertPlayerAndFleet({
        bridge, playerUuid: uuid, player: entity,
        escorts: arrivingEscorts, missionShips,
        ownerUuid: communicator.uuid ?? undefined, baseSlot: 0,
        mintUuid: v4, getShip: id => gameData.data.Ship.get(id),
    });
    window.myShip = entity;
    if (holdBatch) {
        fleet.jumping.push(...jumpEscorts);
    }
    // An escort whose own insertion rejected is not dropped: the standing
    // flush puts it down on a later frame (issue #31).
    fleet.jumping.push(...inserted.failed);
    // The new bridge starts from a fresh delta stream, so drop any
    // bookkeeping from the previous system's sync.
    syncedComponents.clear();
    warnedUnsyncableEntities.clear();
    applySimulationFrame(initialFrame, serializer, displayWorld);
    // The last thing that can fail is behind us: the session is checked
    // one final time so a world is never published over a title screen.
    scope.check();
    const live: LiveSystem = {
        systemId: to, world: displayWorld, bridge, serializer, worker,
        roomSubscriptions,
    };
    state.apply(s => arrive(s, live));
    // Debug toggles, e.g. novaDebug.showCollisionShapes = true. Settings
    // carry over when jumping rebuilds the display world.
    window.novaDebug = new DebugSettings(displayWorld, window.novaDebug);
}

/** Whether `state` has `systemId` up as its live system (recovery asks). */
export function isSystemLive(state: ClientState, systemId: string | undefined):
    boolean {
    return systemId !== undefined && liveSystem(state)?.systemId === systemId;
}
