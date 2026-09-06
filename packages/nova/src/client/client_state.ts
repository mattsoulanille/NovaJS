/**
 * ============================================================================
 * THE CLIENT STATE MACHINE
 * ============================================================================
 *
 * Where the local player is, as ONE value. browser.ts used to keep it as
 * a dozen independent nullable module variables — `activeSystemId`,
 * `displayWorld`, `simulationBridge`, `simulationSerializer`,
 * `simulationWorker`, `pendingDockedShip`, `dockedShip`,
 * `pendingLaunchedShip`, `pendingGateShip`, `gateDockedShip`,
 * `pendingGateLaunch`, `pendingGateArrivalSpob`, plus the title's
 * `entering` / `inGame` flags — that had to agree with each other, and
 * every consumer enumerated the docked handles by hand (issue #73's
 * second half, #146). `buildSaveData` had already missed two of them.
 *
 * Here the same facts are a discriminated union whose variants carry
 * their invariants as REQUIRED fields: a state that has a system has ALL
 * of that system (world, bridge, serializer, worker, room) or none of it;
 * a docked state has the docked ship; a transit names where it is going
 * and where it came from. The compiler flags a consumer that forgets a
 * case, and a transition that does not apply to the current state throws
 * {@link IllegalTransitionError} instead of silently overwriting a handle.
 *
 * PURE. The transitions here compute the next state from the current one
 * and their arguments; the EFFECTS that accompany a transition (building
 * a world, joining a room, removing the docked entity from the
 * simulation, the DOM class for the touch controls) live in the client
 * modules that call them (client/system_entry.ts, client/docking.ts,
 * client/transit.ts, client/game_session.ts, title/title_flow.ts). That
 * split is what makes the machine testable under node with no PIXI, no
 * worker and no socket: the spec drives a scripted title -> space -> land
 * -> launch -> jump -> title run through these functions alone.
 *
 * THE STATES, and the browser.ts variables each one replaces:
 *
 *   title        the title screen (no game session)
 *   rollback     the pilot-history panel over the title (title/rollback_screen)
 *   entering     startGame is preparing the player (the title's `entering`)
 *   inSpace      the player is flying in `system`
 *   landing      LandEvent seen at a spaceport; the pump has not yet pulled
 *                the ship out of the simulation      (`pendingDockedShip`)
 *   landed       docked at a spaceport                (`dockedShip`), with
 *                `launching` set once the player hit Depart
 *                                                      (`pendingLaunchedShip`)
 *   gateLanding  LandEvent seen at a hypergate         (`pendingGateShip`)
 *   gateMap      docked at the gate, its map open      (`gateDockedShip`),
 *                with `launching` once the map closed with no pick
 *                                                      (`pendingGateLaunch`)
 *   transit      between systems: a hyperspace jump, a gate/wormhole
 *                transit, the startup entry, or a recovery re-entry. The
 *                system being left is gone from the state the moment the
 *                transit begins (the pump must not step a world that is
 *                being torn down — browser.ts cleared its bridge handle
 *                synchronously for the same reason); the destination's
 *                room claim sits in `claim` from the moment the room is
 *                joined until the world is published (`activeSystemId`
 *                with no world behind it, made honest)
 *   stranded     a transit whose recovery also failed: no ship anywhere
 *                (the pump "left to run shipless")
 *   tearingDown  teardownGame in progress
 *
 * Client-local module: nothing here touches simulation state.
 */
import type { Entity } from 'nova_ecs/entity';
import type { Serializer } from 'nova_ecs/plugins/serializer_plugin';
import type { World } from 'nova_ecs/world';
import type { Subscription } from 'rxjs';
import type {
    AsyncSimulationBridgeClient,
} from '../communication/async_simulation_bridge_client.js';

/**
 * Everything a live system is made of. Published as a unit by the system
 * entry, torn down as a unit: there is no state in which the display
 * world exists without its bridge, or the bridge without its serializer.
 */
export interface LiveSystem {
    readonly systemId: string;
    /** The display world (display/display_plugin.ts) mirroring the sim. */
    readonly world: World;
    /** The simulation, in its worker. */
    readonly bridge: AsyncSimulationBridgeClient;
    /** The simulation's entity serializer (from the serializer world). */
    readonly serializer: Serializer;
    /** The worker the bridge talks to (a debug handle; the bridge owns it). */
    readonly worker: Worker;
    /** The room-traffic forwarders into the worker, to unsubscribe. */
    readonly roomSubscriptions: readonly Subscription[];
}

/** A player ship held out of the simulation while docked. */
export interface DockedShip {
    /** The ship's in-world uuid, kept across the dock (rosters key on it). */
    readonly uuid: string;
    /**
     * The held entity. Mutable on purpose: a ship bought at the shipyard
     * is a NEW entity, and the handle follows it (see `swapDockedShip`),
     * while the venues mutate the entity's components in place.
     */
    entity: Entity;
    /** The stellar (spaceport or hypergate) the ship is docked at. */
    readonly planetId: string;
}

/** Why the player is between systems. */
export type TransitKind =
    /** The session's first entry (startGame). */
    | 'startup'
    /** A hyperspace jump (FinishJumpEvent). */
    | 'hyper'
    /** A hypergate pick or a wormhole (GateTransitEvent / LeaveGateMapEvent). */
    | 'gate'
    /** A failed transit putting the ship back into the system it left. */
    | 'reenter';

export interface TransitPlan {
    readonly kind: TransitKind;
    /** The system left, when known (undefined for the startup entry). */
    readonly from: string | undefined;
    readonly to: string;
    /** The uuid the player is (re-)inserted under. */
    readonly uuid: string;
    /** The player entity, as the event that started the transit carried it. */
    readonly entity: Entity;
    /**
     * A gate transit's destination spöb: the destination world is told the
     * moment it is created so the gate's opening animation gets a head
     * start (GateArrivalAnticipationEvent). Consumed by the arrival; an
     * aborted transit drops it so the next world entered does not open an
     * unrelated gate (see abortGateTransit).
     */
    readonly arrivalSpob?: string;
}

/** The destination room, joined before its world exists. */
export interface SystemClaim {
    readonly systemId: string;
}

/** The title-screen dialogs that take the menu out of play while up. */
export type TitleDialog = 'newPilot' | 'openPilot' | 'setPrefs' | 'about';

export type ClientState =
    | { readonly kind: 'title', readonly dialog?: TitleDialog }
    | { readonly kind: 'rollback', readonly pilotId: string }
    | { readonly kind: 'entering' }
    | { readonly kind: 'inSpace', readonly system: LiveSystem }
    | {
        readonly kind: 'landing', readonly system: LiveSystem,
        readonly ship: DockedShip,
    }
    | {
        readonly kind: 'landed', readonly system: LiveSystem,
        readonly ship: DockedShip, readonly launching?: Entity,
    }
    | {
        readonly kind: 'gateLanding', readonly system: LiveSystem,
        readonly ship: DockedShip,
    }
    | {
        readonly kind: 'gateMap', readonly system: LiveSystem,
        readonly ship: DockedShip, readonly launching?: Entity,
    }
    | {
        readonly kind: 'transit', readonly transit: TransitPlan,
        /** The destination's room, once joined and until published. */
        readonly claim?: SystemClaim,
    }
    | { readonly kind: 'stranded', readonly reason: string }
    | { readonly kind: 'tearingDown' };

export type ClientStateKind = ClientState['kind'];

/** The states that carry a live system. */
export type LiveState = Extract<ClientState, { system: LiveSystem }>;
/** The states in which the player ship is held out of the simulation. */
export type DockedState = Extract<ClientState, { ship: DockedShip }>;
/** The states a game session is in (everything but the title side). */
export type InGameState = Exclude<ClientState,
    { kind: 'title' } | { kind: 'rollback' }>;

export class IllegalTransitionError extends Error {
    constructor(readonly transition: string, readonly from: ClientState,
        detail?: string) {
        super(`Illegal transition ${transition} from ${describeState(from)}`
            + (detail ? `: ${detail}` : ''));
        this.name = 'IllegalTransitionError';
    }
}

/** A short, log-friendly description: the kind plus where it points. */
export function describeState(state: ClientState): string {
    switch (state.kind) {
        case 'title':
            return state.dialog ? `title(${state.dialog})` : 'title';
        case 'rollback':
            return `rollback(${state.pilotId})`;
        case 'entering':
        case 'tearingDown':
            return state.kind;
        case 'inSpace':
            return `inSpace(${state.system.systemId})`;
        case 'landing':
        case 'gateLanding':
            return `${state.kind}(${state.system.systemId} @ ${state.ship.planetId})`;
        case 'landed':
        case 'gateMap':
            return `${state.kind}(${state.system.systemId} @ ${state.ship.planetId}`
                + `${state.launching ? ', launching' : ''})`;
        case 'transit':
            return `transit(${state.transit.kind} ${state.transit.from ?? '?'}`
                + ` -> ${state.transit.to}`
                + `${state.claim ? ', claimed' : ''})`;
        case 'stranded':
            return `stranded(${state.reason})`;
    }
}

// ── Selectors ──────────────────────────────────────────────────────────
// The questions browser.ts used to answer by testing four or five handles.

/** The live system, if the state has one: the world the pump steps. */
export function liveSystem(state: ClientState): LiveSystem | undefined {
    switch (state.kind) {
        case 'inSpace':
        case 'landing':
        case 'landed':
        case 'gateLanding':
        case 'gateMap':
            return state.system;
        default:
            return undefined;
    }
}

/** The player ship held out of the simulation, if docked or docking. */
export function dockedShip(state: ClientState): DockedShip | undefined {
    switch (state.kind) {
        case 'landing':
        case 'landed':
        case 'gateLanding':
        case 'gateMap':
            return state.ship;
        default:
            return undefined;
    }
}

/**
 * The entity about to lift off, once the player has asked to leave the
 * spaceport or closed the gate map with no pick. It is the freshest
 * player state there is (it carries everything the venues committed).
 */
export function launchingEntity(state: ClientState): Entity | undefined {
    return (state.kind === 'landed' || state.kind === 'gateMap')
        ? state.launching : undefined;
}

/**
 * The system the client has named as the player's, whether or not a
 * world stands behind it yet: a live system's id, or the room claim a
 * transit is holding. What `activeSystemId` used to mean.
 */
export function activeSystemId(state: ClientState): string | undefined {
    return liveSystem(state)?.systemId
        ?? (state.kind === 'transit' ? state.claim?.systemId : undefined);
}

/** Whether a game session is open (anything but the title side). */
export function isInGame(state: ClientState): state is InGameState {
    return state.kind !== 'title' && state.kind !== 'rollback';
}

/**
 * Whether the player is docked in the sense that Escape must NOT leave
 * the game: a landed menu owns the key. The docked class comes off the
 * moment the player hits Depart (the launch is one frame away), which is
 * exactly the `nova-docked` rule browser.ts enforced through the DOM.
 */
export function isDockedForExit(state: ClientState): boolean {
    return (state.kind === 'landed' || state.kind === 'gateMap')
        && state.launching === undefined;
}

/**
 * Whether an exit to the title may start now: a game session is open
 * (which excludes the title, and `entering` — the startup transition is
 * not interruptible, exactly as the title's `entering` flag had it), no
 * teardown is already running, and the player is not docked.
 */
export function canExitToTitle(state: ClientState): boolean {
    return isInGame(state) && state.kind !== 'entering'
        && state.kind !== 'tearingDown' && !isDockedForExit(state);
}

/** Whether the title menu is in play: no game, no dialog, no rollback. */
export function canEnterGame(state: ClientState): boolean {
    return state.kind === 'title' && state.dialog === undefined;
}

// ── Title-side transitions ─────────────────────────────────────────────

export function openTitleDialog(state: ClientState, dialog: TitleDialog):
    ClientState {
    if (state.kind !== 'title' || state.dialog !== undefined) {
        throw new IllegalTransitionError('openTitleDialog', state);
    }
    return { kind: 'title', dialog };
}

export function closeTitleDialog(state: ClientState): ClientState {
    if (state.kind !== 'title' || state.dialog === undefined) {
        throw new IllegalTransitionError('closeTitleDialog', state);
    }
    return { kind: 'title' };
}

/** The rollback panel opens from inside the Open Pilot dialog. */
export function openRollback(state: ClientState, pilotId: string): ClientState {
    if (state.kind !== 'title' || state.dialog !== 'openPilot') {
        throw new IllegalTransitionError('openRollback', state);
    }
    return { kind: 'rollback', pilotId };
}

/** ... and closes back into it. */
export function closeRollback(state: ClientState): ClientState {
    if (state.kind !== 'rollback') {
        throw new IllegalTransitionError('closeRollback', state);
    }
    return { kind: 'title', dialog: 'openPilot' };
}

/**
 * Enter Ship, or a pilot dialog that resolved with a pilot to fly: the
 * dialog (if any) is gone with the title.
 */
export function enterGame(state: ClientState): ClientState {
    if (state.kind !== 'title') {
        throw new IllegalTransitionError('enterGame', state);
    }
    return { kind: 'entering' };
}

/** startGame rejected before the first system came up: back to the title. */
export function enterFailed(state: ClientState): ClientState {
    if (state.kind !== 'entering' && state.kind !== 'transit'
        && state.kind !== 'stranded') {
        throw new IllegalTransitionError('enterFailed', state);
    }
    return { kind: 'title' };
}

// ── Transit ────────────────────────────────────────────────────────────

/**
 * Leaves for another system. From `entering` it is the startup entry;
 * from any live state it is a jump / gate / wormhole, and the system
 * being left goes out of the state with its docked handles (a hypergate
 * pick transits FROM the gate map; enterSystem always cleared every
 * docked handle) — the caller reads `liveSystem` BEFORE this and tears
 * it down after, so the pump never steps a world that is on its way
 * out. From a transit that holds no claim (a failed jump) or a stranded
 * state it is a recovery re-entry.
 */
export function beginTransit(state: ClientState, transit: TransitPlan):
    ClientState {
    switch (state.kind) {
        case 'entering':
        case 'inSpace':
        case 'landing':
        case 'landed':
        case 'gateLanding':
        case 'gateMap':
        case 'stranded':
            return { kind: 'transit', transit };
        case 'transit':
            if (state.claim !== undefined) {
                throw new IllegalTransitionError('beginTransit', state,
                    'the previous transit still holds a room claim');
            }
            return { kind: 'transit', transit };
        default:
            throw new IllegalTransitionError('beginTransit', state);
    }
}

/**
 * The destination is named and its room joined, ahead of its world
 * (client/active_system_claim.ts).
 */
export function claimSystem(state: ClientState, claim: SystemClaim):
    ClientState {
    if (state.kind !== 'transit') {
        throw new IllegalTransitionError('claimSystem', state);
    }
    if (state.claim !== undefined) {
        throw new IllegalTransitionError('claimSystem', state,
            'a claim is already held');
    }
    if (claim.systemId !== state.transit.to) {
        throw new IllegalTransitionError('claimSystem', state,
            `claim on ${claim.systemId} does not match the destination`);
    }
    return { kind: 'transit', transit: state.transit, claim };
}

/** The claim is released again (the transition failed before a world). */
export function releaseClaim(state: ClientState): ClientState {
    if (state.kind !== 'transit' || state.claim === undefined) {
        throw new IllegalTransitionError('releaseClaim', state);
    }
    return { kind: 'transit', transit: state.transit };
}

/**
 * The destination world is up and the player is in it. Requires the
 * claim on that very system: a world is never published for a system
 * whose room was not joined.
 */
export function arrive(state: ClientState, system: LiveSystem): ClientState {
    if (state.kind !== 'transit') {
        throw new IllegalTransitionError('arrive', state);
    }
    if (state.claim?.systemId !== system.systemId) {
        throw new IllegalTransitionError('arrive', state,
            `no claim on ${system.systemId}`);
    }
    if (system.systemId !== state.transit.to) {
        throw new IllegalTransitionError('arrive', state,
            `${system.systemId} is not the destination`);
    }
    return { kind: 'inSpace', system };
}

/**
 * A gate transit that could not be completed while the origin world is
 * still up puts the ship back at the gate it left, armed to lift off —
 * the hypergate lift-off path (transit_recovery.ts's 'gate' plan).
 *
 * The destination is resolved BEFORE the transit state is entered, so
 * this applies out of flight (a wormhole: the simulation has already
 * transited the ship and the client never docked it) or out of the gate
 * map (a hypergate pick whose lookup threw). Once a transit has begun
 * the origin is gone, and the recovery is a re-entry instead.
 */
export function returnToGate(state: ClientState, ship: DockedShip,
    launching: Entity): ClientState {
    if (state.kind !== 'inSpace' && state.kind !== 'gateMap') {
        throw new IllegalTransitionError('returnToGate', state,
            'the origin world is not up');
    }
    return { kind: 'gateMap', system: state.system, ship, launching };
}

/** Nothing further can be tried: the ship is in no world. */
export function strand(state: ClientState, reason: string): ClientState {
    if (state.kind !== 'transit' || state.claim !== undefined) {
        throw new IllegalTransitionError('strand', state);
    }
    return { kind: 'stranded', reason };
}

// ── Docking ────────────────────────────────────────────────────────────

/** LandEvent at a spaceport. Only from flight: a second LandEvent while
 * a dock is pending or standing is ignored by the caller. */
export function land(state: ClientState, ship: DockedShip): ClientState {
    if (state.kind !== 'inSpace') {
        throw new IllegalTransitionError('land', state);
    }
    return { kind: 'landing', system: state.system, ship };
}

/** The pump pulled the ship out of the simulation and opened the port. */
export function dock(state: ClientState): ClientState {
    if (state.kind !== 'landing') {
        throw new IllegalTransitionError('dock', state);
    }
    return { kind: 'landed', system: state.system, ship: state.ship };
}

/** The player hit Depart (LeaveSpaceportEvent); the pump launches next. */
export function requestLaunch(state: ClientState, launching: Entity):
    ClientState {
    if (state.kind !== 'landed') {
        throw new IllegalTransitionError('requestLaunch', state);
    }
    return {
        kind: 'landed', system: state.system, ship: state.ship, launching,
    };
}

/** The relaunch record is in: flying again. */
export function launched(state: ClientState): ClientState {
    if (state.kind !== 'landed' || state.launching === undefined) {
        throw new IllegalTransitionError('launched', state);
    }
    return { kind: 'inSpace', system: state.system };
}

/** LandEvent at a hypergate. */
export function landAtGate(state: ClientState, ship: DockedShip): ClientState {
    if (state.kind !== 'inSpace') {
        throw new IllegalTransitionError('landAtGate', state);
    }
    return { kind: 'gateLanding', system: state.system, ship };
}

/** The pump pulled the ship out and opened the hypergate map. */
export function dockAtGate(state: ClientState): ClientState {
    if (state.kind !== 'gateLanding') {
        throw new IllegalTransitionError('dockAtGate', state);
    }
    return { kind: 'gateMap', system: state.system, ship: state.ship };
}

/** The map closed with no pick (or the pick had nowhere to go). */
export function requestGateLaunch(state: ClientState, launching: Entity):
    ClientState {
    if (state.kind !== 'gateMap') {
        throw new IllegalTransitionError('requestGateLaunch', state);
    }
    return {
        kind: 'gateMap', system: state.system, ship: state.ship, launching,
    };
}

export function gateLaunched(state: ClientState): ClientState {
    if (state.kind !== 'gateMap' || state.launching === undefined) {
        throw new IllegalTransitionError('gateLaunched', state);
    }
    return { kind: 'inSpace', system: state.system };
}

/**
 * A ship bought at the shipyard is a NEW entity; the docked handle
 * follows it so every docked-frame write and every save lands on the
 * hull that will lift off (Spaceport.adoptPurchasedShip). Mutates the
 * handle in place, which is the point: an open venue holds the same
 * handle.
 */
export function swapDockedShip(state: ClientState, entity: Entity): void {
    const docked = dockedShip(state);
    if (!docked) {
        throw new IllegalTransitionError('swapDockedShip', state);
    }
    docked.entity = entity;
}

// ── Session ────────────────────────────────────────────────────────────

/**
 * Exit-to-title begins. From any in-game state — the teardown is what
 * ends whatever was in flight — but not from a teardown already running.
 */
export function beginTeardown(state: ClientState): ClientState {
    if (!isInGame(state) || state.kind === 'tearingDown') {
        throw new IllegalTransitionError('beginTeardown', state);
    }
    return { kind: 'tearingDown' };
}

/** The session is gone; the title is back. */
export function tornDown(state: ClientState): ClientState {
    if (state.kind !== 'tearingDown') {
        throw new IllegalTransitionError('tornDown', state);
    }
    return { kind: 'title' };
}

/**
 * A mutable slot holding the machine's current state, for the modules
 * that share it. `apply` is the one way to move it: a transition that
 * throws leaves the state exactly as it was.
 */
export class ClientStateSlot {
    private current: ClientState;
    private readonly listeners = new Set<
        (next: ClientState, previous: ClientState) => void>();

    constructor(initial: ClientState = { kind: 'title' }) {
        this.current = initial;
    }

    get state(): ClientState {
        return this.current;
    }

    /** Applies `transition` to the current state and publishes the result. */
    apply(transition: (state: ClientState) => ClientState): ClientState {
        const previous = this.current;
        const next = transition(previous);
        this.current = next;
        for (const listener of this.listeners) {
            try {
                listener(next, previous);
            } catch (e) {
                console.warn('Client state listener failed:', e);
            }
        }
        return next;
    }

    /** Observes every state change (debug hooks, the touch-control class). */
    subscribe(listener: (next: ClientState, previous: ClientState) => void):
        () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
}
