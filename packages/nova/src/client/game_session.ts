/**
 * ============================================================================
 * A game session: from Enter Ship to the title screen coming back
 * ============================================================================
 *
 * {@link startGame} opens a session generation, builds the player
 * (client/player_start.ts), enters the first system
 * (client/system_entry.ts), and installs everything a session needs on
 * the page-lifetime surfaces: the keyboard and touch controls, tap
 * targeting, the frame pump (client/frame_pump.ts), the stats overlay,
 * the console levers. It returns the teardown that reverses all of it,
 * so the player can be dropped back on the title screen and re-enter
 * cleanly (enter -> esc -> enter -> esc ...).
 *
 * The display-world event wiring lives here too ({@link wireWorld}):
 * each system entry builds a fresh display world, and this is where its
 * landing / departure / jump / gate / escort-carry events are routed to
 * the docking, transit and save modules, and its dialogs' actions to the
 * bridge.
 */
import type { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import Stats from 'stats.js';
import { v4 } from 'uuid';
import { Autopilot, ControlSinks } from '../autopilot.js';
import type { AsyncSimulationBridgeClient } from '../communication/async_simulation_bridge_client.js';
import { warnedUnsyncableEntities } from '../communication/apply_simulation_frame.js';
import { PlunderActionEvent } from '../display/boarding_plugin.js';
import { LeaveGateMapEvent } from '../display/gate_map_plugin.js';
import {
    EscortActionEvent, HailRequestEvent,
} from '../display/hail_dialog_plugin.js';
import { resetJumpFade } from '../display/jump_fade_plugin.js';
import { AcceptShipMissionEvent } from '../display/ship_mission_offer_plugin.js';
import { LeaveSpaceportEvent } from '../display/spaceport_plugin.js';
import { SetJumpRouteEvent } from '../display/starmap_plugin.js';
import { AddEnemyEvent, DebugActionEvent } from '../display/status_bar.js';
import { isTextEntryActive } from '../input_focus.js';
import { ControlEvent, EcsControlEvent } from '../nova_plugin/core/controls_plugin.js';
import { Controls, getActions } from '../nova_plugin/core/controls.js';
import { SimulationGameDataResource } from '../nova_plugin/core/game_data_resource.js';
import { GateTransitEvent } from '../nova_plugin/travel/gate_transit_plugin.js';
import { FinishJumpEvent } from '../nova_plugin/travel/jump_plugin.js';
import type { AcceptedMission } from '../nova_plugin/missions/mission_accept.js';
import { MultiRoomResource, NovaPlugin } from '../nova_plugin/nova_plugin.js';
import { LandEvent } from '../nova_plugin/travel/planet_plugin.js';
import {
    EscortJumpEvent, EscortLandedEvent,
} from '../nova_plugin/escorts/player_escort_plugin.js';
import { PlayerShipSelector } from '../nova_plugin/player/player_ship_plugin.js';
import { resetMostRecentlyActivatedRank } from '../nova_plugin/ncb/rank_logic.js';
import { AnalogControlState } from '../nova_plugin/player/ship_control.js';
import type { CarriedEscort } from '../spaceport/landed_escorts.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { clearShipDoneTextShown } from '../spaceport/ship_done_shown.js';
import { installTapTargeting } from '../tap_targeting.js';
import { installTouchControls, wantsTouchControls } from '../touch_controls.js';
import {
    beginTeardown, dockedShip, enterFailed, enterGame, liveSystem, tornDown,
} from './client_state.js';
import { onLand, onLeaveSpaceport } from './docking.js';
import {
    localPlayerShipUuid, spawnHiredEscorts,
} from './fleet_ledger.js';
import { FramePump } from './frame_pump.js';
import { preparePlayerStart } from './player_start.js';
import { ClientRuntime, sendToBridge } from './runtime.js';
import { jumpTo, teardownLiveSystem, WorldWiring } from './system_entry.js';
import {
    followGateTransit, followHyperspaceJump, leaveGateMap,
} from './transit.js';

/** What the session needs from the page beyond the runtime. */
export interface SessionHost {
    /** The live control map (the active pilot's bindings). */
    controls(): Controls | undefined;
    /**
     * The client-local scale hotkeys: returns true when the event was
     * one (it never reaches the simulation). See browser.ts.
     */
    applyScaleControl(event: ControlEvent): boolean;
    /** The global display scale, for the tap hit test. */
    globalScale(): number;
}

// Tap/click targeting and the touch controls live on the persistent
// canvas/body and read live state through the runtime, so they are
// installed exactly once (not per session).
let tapTargetingInstalled = false;
let touchControlsInstalled = false;

/**
 * Whether a carry event belongs to the LOCAL player, so other peers'
 * escorts are never added to this client's rosters (it would never
 * respawn them, and in a busy room the arrays would grow all session).
 * While the local player is out of the world — landed or mid-jump, which
 * is exactly when its own escorts are handed over — there is no local
 * ship to compare against, so an unattributable event is accepted and
 * pruned at consume time.
 */
function isLocalCarriedEscort(runtime: ClientRuntime, world: World,
    player: string): boolean {
    if (dockedShip(runtime.state.state)?.uuid === player) {
        return true;
    }
    const local = localPlayerShipUuid(world);
    return local === undefined || local === player;
}

/**
 * Routes a fresh display world's events to the client. Every handler
 * that leaves the system captures the system as it stands NOW (for the
 * recovery paths) rather than reading the state later.
 */
function wireWorld(runtime: ClientRuntime, pump: FramePump): WorldWiring {
    const wire: WorldWiring = (world: World,
        bridge: AsyncSimulationBridgeClient) => {
        const { gameData, fleet } = runtime;
        world.events.get(LeaveSpaceportEvent).subscribe(({ data }) => {
            onLeaveSpaceport(runtime, data);
        });
        world.events.get(AddEnemyEvent).subscribe(({ data }) => {
            const { shipId } = data;
            sendToBridge(gameData.data.Ship.get(shipId)
                .then(() => bridge.spawnNpc(shipId)), 'Add enemy');
        });
        // Plunder/capture dialog buttons drive the sim through the control
        // input path: a single 'start' edge fires the edge-triggered
        // boarding action system (BoardingActionSystem) once, replayed on
        // every peer. Idempotency lives in the sim.
        world.events.get(PlunderActionEvent).subscribe(({ data }) => {
            sendToBridge(bridge.controlEvents([
                { action: data.action, state: 'start' }]), 'Plunder action');
        });
        // Debug-button cheats (status_bar.ts): forwarded on the same
        // control-event input path as the plunder actions, so the
        // +credits / clear-record edge fires DebugCheatSystem once,
        // replayed on every peer.
        world.events.get(DebugActionEvent).subscribe(({ data }) => {
            sendToBridge(bridge.controlEvents([
                { action: data.action, state: 'start' }]), 'Debug action');
        });
        world.events.get(SetJumpRouteEvent).subscribe(({ data }) => {
            pump.noteJumpRouteSent(data.route);
            sendToBridge(bridge.setPlayerJumpRoute(data.route), 'Jump route');
        });
        // Hail dialog actions become deterministic input records:
        // assist/bribe go through bridge.hail.
        world.events.get(HailRequestEvent).subscribe(({ data }) => {
            sendToBridge(bridge.hail(data.action), 'Hail');
        });
        // The escort comm dialog's MANAGEMENT functions (release / sell /
        // upgrade — nova_plugin/escorts/escort_action.ts) take the same road, on
        // their own bridge call for the shape of the record rather than
        // for any staging: NOTHING is staged here. A release only drops
        // components, and queueing an upgrade only writes the target
        // class's id onto the escort's ownership marker — the class is
        // loaded, and the hull actually swapped, much later, by the
        // client that settles the deal as the player leaves a spaceport
        // (spaceport/escort_deals.ts).
        world.events.get(EscortActionEvent).subscribe(({ data }) => {
            sendToBridge(bridge.escortAction(data.action), 'Escort action');
        });
        // A mission accepted from a përs ship in flight (mïsn AvailLoc 2).
        // The display resolved the whole acceptance against a detached
        // copy of the player and handed over the resulting record plus
        // the raw mission ships; the ships are ENCODED here, where the
        // bridge's serializer lives, and the pair goes out as ONE input
        // record so the mission and its ambush land on the same tick on
        // every peer.
        world.events.get(AcceptShipMissionEvent).subscribe(({ data }) => {
            const serializer = bridge.getSerializer();
            const record: AcceptedMission = data.ships.length > 0
                ? {
                    ...data.record,
                    ships: data.ships.map(ship => ({
                        uuid: v4(),
                        entity: serializer.encode(ship) as never,
                    })),
                }
                : data.record;
            void bridge.acceptMission(record).catch(e => {
                console.warn('Failed to accept a ship-offered mission:', e);
            });
        });
        world.events.get(LandEvent).subscribe(({ data, entities }) => {
            onLand(runtime, world, data, entities);
        });
        // The player's escorts, handed over by the simulation as it
        // deletes them from this system. Collected synchronously here;
        // the transit / launch that consumes them runs later. Entries for
        // other peers' players are dropped when a batch is consumed —
        // only the owning client respawns them.
        const pushCarried = (rows: CarriedEscort[],
            data: { player: string, uuid: string, entity: Entity }) => {
            if (!isLocalCarriedEscort(runtime, world, data.player)) {
                return;
            }
            fleet.pushCarried(rows, data);
        };
        world.events.get(EscortJumpEvent).subscribe(({ data }) => {
            pushCarried(fleet.jumping, data);
        });
        world.events.get(EscortLandedEvent).subscribe(({ data }) => {
            pushCarried(fleet.landed, data);
        });
        world.events.get(FinishJumpEvent).subscribe(({ data }) => {
            // Every peer simulates every ship's jump; only follow it to
            // the new system if the jumping ship is the local player's.
            // (The event carries the ship, which the sim already removed
            // this frame, so the display entity cannot be consulted.)
            if (!data.entity.components.has(PlayerShipSelector)) {
                return;
            }
            followHyperspaceJump(runtime, data, wire);
        });
        world.events.get(GateTransitEvent).subscribe(({ data }) => {
            // Wormhole transit reuses the jump room-switch. Only the local
            // player follows it to the destination system (like a jump);
            // the sim already removed the carried ship this frame.
            if (!data.entity.components.has(PlayerShipSelector)) {
                return;
            }
            followGateTransit(runtime, data, wire);
        });
        world.events.get(LeaveGateMapEvent).subscribe(({ data }) => {
            leaveGateMap(runtime, data, wire);
        });
    };
    return wire;
}

/**
 * Enters the game. Resolves to the teardown that leaves it again. If the
 * entry fails (the startup transit rejected, the socket never got a
 * uuid, ...), everything it had installed is released and the state is
 * back at the title before the rejection reaches the caller — so a
 * failed Enter Ship can be retried, and a half-entered session can never
 * be "exited".
 */
export async function startGame(runtime: ClientRuntime, host: SessionHost):
    Promise<() => Promise<void>> {
    runtime.state.apply(enterGame);
    // Cleanups for everything this session registers on shared,
    // session-independent surfaces — document/window listeners, the PIXI
    // ticker, the frame-pump worker, the stats overlay. Run (and cleared)
    // when the player leaves the game back to the title, so re-entering
    // doesn't stack duplicate listeners/tickers/workers.
    const sessionDisposers: Array<() => void> = [];
    try {
        return await enterSession(runtime, host, sessionDisposers);
    } catch (e) {
        await abandonEntry(runtime, sessionDisposers);
        throw e;
    }
}

async function enterSession(runtime: ClientRuntime, host: SessionHost,
    sessionDisposers: Array<() => void>): Promise<() => Promise<void>> {
    const { app, gameData, communicator, multiRoom, state, fleet, saves } =
        runtime;
    // "Which ShipDoneTexts has the player already read in flight" belongs
    // to ONE pilot's session; a switch to another pilot (or a reset)
    // starts with none read. Cheap insurance: an entry is normally
    // consumed by the very next date advance anyway.
    clearShipDoneTextShown();
    // Likewise the <RRK> "most recently activated rank" pointer, which the
    // Bible says is not kept between game sessions: it must not carry one
    // pilot's rank into another pilot's briefing.
    resetMostRecentlyActivatedRank();
    // A fresh session generation: every transition from here on (the
    // startup entry included) runs under it, and teardownGame ends it.
    runtime.transitions.begin();
    const world = new World();
    world.resources.set(SimulationGameDataResource, gameData);
    // NO legacy delta-sync multiplayer plugin on this world (and no 'main
    // room' lobby). The simulation lives in the worker (a per-system
    // rollback room) and the picture in the display world; this outer
    // world is stepped for NovaPlugin's bookkeeping only, and nothing
    // reads its entities. See nova_ecs/plugins/multiplayer_plugin.ts
    // (ownership checks commented out) and server.ts.
    world.resources.set(MultiRoomResource, multiRoom);
    await world.addPlugin(NovaPlugin);
    window.world = world;

    // Make the player's ship
    while (!communicator.uuid) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    const query = new URLSearchParams(window.location.search);
    const start = await preparePlayerStart(runtime, query, communicator.uuid);
    window.myShip = start.ship;

    const stats = new Stats();
    document.body.appendChild(stats.dom);
    sessionDisposers.push(() => stats.dom.remove());

    function emitControlEvents(controlEvents: ControlEvent[]) {
        if (controlEvents.length === 0) {
            return;
        }
        for (const controlEvent of controlEvents) {
            host.applyScaleControl(controlEvent);
        }
        const live = liveSystem(state.state);
        live?.world.emit(EcsControlEvent, controlEvents);
        for (const controlEvent of controlEvents) {
            runtime.controlsSubject.next(controlEvent);
        }
        sendToBridge(live?.bridge.controlEvents(controlEvents),
            'Control events');
    }

    const controlSinks: ControlSinks = {
        controlEvents: emitControlEvents,
        analogControl(control: AnalogControlState) {
            sendToBridge(liveSystem(state.state)?.bridge.analogControl(control),
                'Analog control');
        },
    };
    const autopilot = new Autopilot(controlSinks);
    runtime.autopilot = autopilot;
    const pump = new FramePump(runtime, world, autopilot, stats);
    const wire = wireWorld(runtime, pump);

    await jumpTo(runtime, {
        kind: 'startup', from: undefined, to: start.systemId,
        uuid: v4(), entity: start.ship,
    }, wire);

    // Warm the mission/cron/planet caches in the background so the first
    // landing or jump doesn't stall on them. Deliberately after the
    // initial join: these ~2000 fetches share Chrome's per-host
    // connection pool with the world-load fetches above.
    void MissionUniverse.shared(gameData).load().catch(e => {
        console.warn('Failed to preload mission data:', e);
    });

    saves.installSaveTriggers();

    // Console levers for tests/debugging.
    window.novaAutopilot = autopilot;
    // Inject control events directly (bypassing the keyboard), e.g.
    //   novaControls.send([{action: 'nearestTarget', state: 'start'}])
    // followed by the matching {state: false} release.
    window.novaControls = { send: emitControlEvents };
    // Hire escorts onto the player through the SAME spawn path the bar's
    // hire flow uses (formation slots, firing group, default escort
    // command), without the landing UI — e.g.
    // novaSpawnEscorts(['nova:133', 'nova:133']).
    window.novaSpawnEscorts = async (shipIds: string[]) => {
        const live = liveSystem(state.state);
        if (!live) {
            throw new Error('No live system');
        }
        const playerUuid = localPlayerShipUuid(live.world);
        const player = playerUuid
            ? live.world.entities.get(playerUuid) : undefined;
        if (!playerUuid || !player) {
            throw new Error('No player ship');
        }
        await spawnHiredEscorts({
            fleet, gameData, ownerUuid: () => communicator.uuid ?? undefined,
        }, live.bridge, live.world, playerUuid, player, shipIds);
    };
    // What the client is currently holding for its escorts (see
    // spaceport/landed_escorts.ts). `landed` is the roster held while
    // docked or swept at a gate; `jumping` is the batch waiting for the
    // destination system's world to be built — or riding out a multi-
    // jump chain.
    window.novaEscortRosters = () => fleet.summary();
    // The same-system convergence invariant, live (FleetLedger.audit).
    window.novaEscortAudit = (expected?: string[]) => {
        const live = liveSystem(state.state);
        return live ? fleet.audit(live.world, expected) : null;
    };

    // User movement input cancels the autopilot (the autopilot's own
    // inputs go through controlSinks directly and don't loop back here).
    // Firing and targeting deliberately don't cancel, so the player can
    // defend themselves on the way to a planet.
    const movementActions = new Set<string>(['accelerate', 'turnLeft',
        'turnRight', 'reverse', 'pointTo', 'land', 'hyperjump',
        'afterburner', 'board']);

    function handleControlEvent(event: KeyboardEvent) {
        const controls = host.controls();
        if (!controls) {
            return;
        }
        // A focused text-entry surface (the starmap Find dialog, the
        // quantity dialog, an HTML input overlay, ...) owns the keyboard:
        // generate no game control PRESSES at all, so typing can't fire
        // hotkeys (digits selecting stellar bodies, 'd' departing, 'm'
        // opening the map). Releases still flow (like the overlay case
        // below) so a control held when the field opened can't stay
        // stuck on. Determinism-safe: dropped presses are never recorded
        // as inputs, so no peer is affected.
        if (isTextEntryActive() && event.type !== 'keyup') {
            return;
        }
        if (event.key === 'Tab') {
            event.preventDefault();
        }
        const actions = getActions(controls, event);
        const controlEvents: ControlEvent[] = actions.map(action => ({
            action,
            state: event.type === 'keyup' ? false
                : event.repeat ? 'repeat' : 'start',
        }));
        // A modal overlay (starmap, gate map, player info, spaceport
        // menus) owns the keyboard while it holds focus: its own control
        // bindings still fire (via controlsSubject), but the same keys
        // must NOT also drive the ship in the sim underneath — otherwise
        // Tab cycles the ship target while it cycles the map's jump
        // route, Space fires the primary weapon, and the arrows turn the
        // ship. Route presses to the menu layer (and display-only
        // handlers) only.
        //
        // Key RELEASES are the exception: they still reach the sim, so a
        // control held down when the overlay opened (e.g. accelerate)
        // doesn't stay stuck on after the overlay closes.
        if (MenuControls.focused && event.type !== 'keyup') {
            if (controlEvents.length === 0) {
                return;
            }
            liveSystem(state.state)?.world.emit(EcsControlEvent, controlEvents);
            for (const controlEvent of controlEvents) {
                runtime.controlsSubject.next(controlEvent);
            }
            return;
        }
        if (actions.some(action => movementActions.has(action))) {
            autopilot.cancel();
        }
        emitControlEvents(controlEvents);
    }
    document.addEventListener('keydown', handleControlEvent);
    document.addEventListener('keyup', handleControlEvent);
    sessionDisposers.push(() => {
        document.removeEventListener('keydown', handleControlEvent);
        document.removeEventListener('keyup', handleControlEvent);
    });

    // Like tap targeting: the on-screen touch controls live on the
    // persistent body and drive live state through the runtime, so
    // install them once.
    if (wantsTouchControls() && !touchControlsInstalled) {
        touchControlsInstalled = true;
        installTouchControls({
            sinks: controlSinks,
            onMovementInput: () => runtime.autopilot?.cancel(),
        });
    }

    // Tap or click on a ship to target it; on a planet to autopilot there
    // and land. Installed once on the persistent canvas (never torn
    // down): it reads the live world / bridge / autopilot through the
    // runtime, so it keeps working across re-entries without stacking
    // duplicate listeners.
    if (!tapTargetingInstalled) {
        tapTargetingInstalled = true;
        installTapTargeting(app.view as unknown as HTMLElement, {
            getWorld: () => liveSystem(state.state)?.world,
            getMyPeerId: () => communicator.uuid ?? undefined,
            targetShip: uuid => sendToBridge(
                liveSystem(state.state)?.bridge.setTarget(uuid), 'Target ship'),
            navigateToPlanet: uuid => {
                // Select the stellar (so the land handshake acts on THIS
                // planet even if another was already picked, and the nav
                // readout lights up immediately), then autopilot to it.
                sendToBridge(liveSystem(state.state)?.bridge.setPlanetTarget(uuid),
                    'Target planet');
                runtime.autopilot?.navigateTo(uuid);
            },
            // A click on the map, a dialog, a button or the status bar is
            // NOT a click on space: while a modal menu owns the keyboard,
            // or when PIXI's hit test finds an interactive UI object under
            // the pointer (only UI is interactive; ships/planets are
            // picked by distance above), the tap stops here instead of
            // targeting/landing on whatever is drawn underneath. hitTest
            // takes LOGICAL stage coordinates; a pointer event's clientX/Y
            // are CSS pixels, which differ by the global scale.
            isBlocked: (x, y) => MenuControls.focused !== undefined
                || app.renderer.events.rootBoundary.hitTest(
                    x / host.globalScale(), y / host.globalScale()) !== null,
        });
    }

    sessionDisposers.push(pump.install(app));

    // The teardown returned to the title orchestrator: reverse everything
    // this session set up, so the player can be dropped back on the title
    // screen and re-enter cleanly.
    return async function teardownGame() {
        // END THE SESSION GENERATION FIRST (issue #30): every transition
        // still in flight — a jump on its white screen, a gate pick
        // building its destination — is invalidated at once and bails at
        // its next check, terminating the worker it made and handing its
        // escort batch back to the rosters. Waited for below, BEFORE the
        // save and the reset, so nothing lands on the rosters after they
        // have been snapshotted and cleared, and no world is ever
        // published over the title screen.
        const transitionsSettled = runtime.transitions.end();
        // Stop the pump, heartbeat and input listeners BEFORE closing the
        // bridge, so no frame pumps against a dying worker and no stray
        // keypress reaches a torn-down world.
        for (const dispose of sessionDisposers) {
            try {
                dispose();
            } catch (e) {
                console.warn('Session teardown step failed:', e);
            }
        }
        sessionDisposers.length = 0;
        // The frame already in flight completes against the still-open
        // bridge (a lift-off in progress finishes putting its fleet in,
        // so the save below sees it), and the transitions finish bailing
        // out.
        await pump.frameInFlight;
        await transitionsSettled;
        // Persist: a pure read of the display world, still intact.
        try {
            saves.saveNow();
        } catch (e) {
            console.warn('Failed to save on exit to title:', e);
        }
        // Tear down the system room + bridge + display world. Leaving the
        // room is what removes this player's ship (and everything else it
        // owns) for every other peer: the server authors a removePeer
        // record (see teardownLiveSystem).
        const live = liveSystem(state.state);
        state.apply(beginTeardown);
        if (live) {
            await teardownLiveSystem(runtime, live);
        }
        // The hyperspace white-out (display/jump_fade_plugin.ts) lives on
        // the APP stage by design: it has to outlive the display world
        // that is torn down mid-jump, and only the destination world's
        // JumpFadeSystem clears it. An exit-to-title during the white
        // screen has no destination world, so the title would come back
        // under a full-white cover until the next Enter Ship (issue #30).
        // Nothing else of a session's is left on the app stage.
        resetJumpFade(app);

        // Reset the session state so the next entry starts clean. The
        // rosters, and any stash the last session never got to spend
        // (leaving it would deal a dead save's escorts into the NEXT
        // pilot's first system).
        fleet.reset();
        warnedUnsyncableEntities.clear();
        autopilot.cancel();
        runtime.autopilot = undefined;
        state.apply(tornDown);
    };
}

/**
 * The entry rejected. Whatever it had installed comes down: the
 * listeners and pump (if it got that far), the session generation (so a
 * transition still bailing out finishes doing so), and a live system if
 * one was published before the failure. The state ends at the title.
 */
async function abandonEntry(runtime: ClientRuntime,
    sessionDisposers: Array<() => void>): Promise<void> {
    for (const dispose of sessionDisposers) {
        try {
            dispose();
        } catch (e) {
            console.warn('Session teardown step failed:', e);
        }
    }
    sessionDisposers.length = 0;
    await runtime.transitions.end();
    runtime.fleet.reset();
    runtime.autopilot?.cancel();
    runtime.autopilot = undefined;
    const { state } = runtime;
    const live = liveSystem(state.state);
    if (live) {
        state.apply(beginTeardown);
        try {
            await teardownLiveSystem(runtime, live);
        } catch (e) {
            console.warn('Failed to tear down the system after a failed '
                + 'entry:', e);
        }
        state.apply(tornDown);
    } else if (state.state.kind !== 'title') {
        state.apply(enterFailed);
    }
}
