import { Emit, Entities, UUID } from "nova_ecs/arg_types";
import { Plugin } from "nova_ecs/plugin";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { World } from "nova_ecs/world";
import { BEEP_CANT_DO, UiSoundEvent } from "./ui_sound.js";
import * as PIXI from "pixi.js";
import {
    DisplayAssetDataResource, SimulationGameDataResource, SystemIdResource,
    ProjectileAnimationProvider, displayName,
} from '../nova_plugin/core/index.js';
import { Entity } from "nova_ecs/entity";
import { SingletonComponent } from "nova_ecs/world";
import { DISTRESS_MESSAGES_STRING_TABLE } from "novadatainterface/string_table_data";
import { ShipDataComponent } from '../nova_plugin/ship/index.js';
import { SimulationTimeResource } from './simulation_time.js';
import {
    GameDateComponent, PlayerNamesComponent, playerShipName, PlayerShipSelector,
} from '../nova_plugin/player/index.js';
import { Optional } from 'nova_ecs/optional';
import { ArrivalRoute, bayCaptureMessage, boardingBlockedMessage, captureRepelledMessage, cargoRetrievedMessage, contrabandScanMessage, escortRepairedMessage, HYPERGATE_CLEARED_FORMS, hypergateClearedMessage, JUMP_COLLAPSED_MESSAGE, jumpArrivalMessage, landingBlockedMessage, landingRequestMessage, playerHailMessage, playerPlunderedMessage, plunderSelfDestructMessage, SHIP_DISABLED_MESSAGE, SHIP_REPAIRED_MESSAGE, stellarClearedMessage } from "./status_bar_content.js";
import { LandingBlockedEvent, LandingClearedEvent, LandingRequestEvent } from "../nova_plugin/travel/index.js";
import { BayCaptureEvent, BOARD_SOUND, BoardingBlockedEvent, BoardingRepelledEvent, EscortRepairedEvent, MissionCargoRetrievedEvent, PlunderSelfDestructEvent, SentHailComponent, ShipDisabledEvent, ShipRepairedEvent } from "../nova_plugin/encounters/index.js";
import { missionCargoName } from '../nova_plugin/missions/index.js';
import {
    ContrabandScanEvent, DistressCallEvent, distressCallMessage, distressLine,
    PlayerPlunderedEvent,
} from "../nova_plugin/npc/index.js";
import { MissionShipComponent } from '../nova_plugin/player/index.js';
import {
    PersComponent, REINFORCEMENT_STRING_TABLE, ReinforcementArrivalEvent,
    reinforcementArrivalMessage,
} from '../nova_plugin/spawn/index.js';
import { loadPilotProfile } from '../title/client_prefs.js';
import { targetIdentity } from './target_identity.js';
import { ResizeEvent, ScreenSize } from "./screen_size_plugin.js";
import { Stage } from "./stage_resource.js";
import { DrawDockedStatus } from "./status_bar_docked.js";
import { showStatusMessage, StatusLineResource } from "./status_line_resource.js";

/**
 * The bottom-left on-screen status line the original game uses for the date on
 * system entry and transient gameplay messages (e.g. "Jumping into the Sanddown
 * system on November 21st, 1177 NC."). Display-only: it reads simulation state
 * (never writes it) and clears a message after STATUS_LINE_HOLD_MS.
 */
/**
 * How long a status-line message stays, in (display, TimeScale-scaled)
 * ms; then the line goes dark AT ONCE, with no fade. Reference "P1 wave 16"
 * (docs/reference_experiments.md, the status line): read frame by frame
 * from a 10 fps recording, eight distress lines each stayed 8.0-8.2 s and
 * then the line went dark at once, and wave 14's recording re-read the same
 * way gives back-to-back 8.0-8.3 s segments. NovaJS uses the one rule for
 * every line (arrival, landing and boarding feedback, scans, hails,
 * distress): only the distress lines were timed closely, and the doc
 * reads its finding as "a status line stays 8 s".
 *
 * Not matched (open): the original's TAKE-OFF line ("Leaving / Taking off
 * from ...", which NovaJS does not print) stayed only 4.3-4.6 s, and a
 * contraband detection long enough to wrap onto two lines stayed at least
 * 12.7 s; whether the hold depends on the message is unmeasured.
 */
export const STATUS_LINE_HOLD_MS = 8000;

/** The status line's opacity `age` ms after its message was set: fully
 * shown for STATUS_LINE_HOLD_MS, then gone (no fade). */
export function statusLineAlpha(age: number): number {
    return age < STATUS_LINE_HOLD_MS ? 1 : 0;
}

export class StatusLine {
    readonly container = new PIXI.Container();
    private readonly text: PIXI.Text;
    /** Wall-clock time (TimeResource) the current message was set. */
    private shownAt = -Infinity;
    /**
     * Insets from the screen edge. Measured on the original's status line
     * (map/mini_map/mini_map.png, "Jumping into the Tau Ceti system on March
     * 17th, 1178 NC."): its first glyph starts at x=25 on a 1920-wide frame,
     * with the line's descenders reaching y=1071 of 1080.
     */
    private static readonly INSET_X = 24;
    private static readonly INSET_Y = 8;

    constructor() {
        this.text = new PIXI.Text("", new PIXI.TextStyle({
            fontFamily: 'Geneva',
            fontSize: 12,
            fill: 0xffffff,
        }));
        this.text.anchor.set(0, 1);
        this.container.addChild(this.text);
        this.container.name = 'StatusLine';
    }

    /** The message currently displayed (empty when none). */
    get message(): string {
        return this.text.text;
    }

    setMessage(message: string, time: number) {
        this.text.text = message;
        this.shownAt = time;
    }

    /** Shows the message for STATUS_LINE_HOLD_MS, then clears the line at
     * once (statusLineAlpha). */
    update(time: number) {
        this.container.alpha = statusLineAlpha(time - this.shownAt);
    }

    reposition(screenHeight: number) {
        this.container.position.set(StatusLine.INSET_X,
            screenHeight - StatusLine.INSET_Y);
    }
}

// The resource and showStatusMessage live in status_line_resource.ts (so
// modules this one imports can post a line without a cycle).
export { showStatusMessage, StatusLineResource };
/** The scenario's date suffix (e.g. " NC"), fetched once at build. */
export const DateSuffixResource = new Resource<{ suffix: string }>('StatusLineDateSuffix');
/** The scenario's cargo names (STR# 4000 and the lowercase STR# 4001, from
 * the player start), fetched once at build: what a retrieved mission cargo
 * is called. */
const CargoNamesResource = new Resource<{ names: string[], lower: string[] }>(
    'StatusLineCargoNames');
/** The scenario's distress lines (STR# 5003), fetched once at build; empty
 * until they load (a call before then shows nothing). */
const DistressLinesResource = new Resource<{ lines: string[] }>(
    'StatusLineDistressLines');
/** Marks that the arrival message has been shown for this system's world,
 * and how the player came in (which picks the line's lead). */
export const ArrivalShownResource = new Resource<{
    shown: boolean, route: ArrivalRoute,
}>('StatusLineArrivalShown');

/**
 * Tells a freshly built display world how the player is entering it, so its
 * arrival line reads "Exiting hypergate in the ..." or "Passing through a
 * wormhole into the ..." instead of "Jumping into the ...". Called by the
 * client's system entry (client/system_entry.ts) before the world first
 * steps; a no-op on a world without the plugin, or once the line is up.
 */
export function setArrivalRoute(world: World, route: ArrivalRoute) {
    const arrival = world.resources.get(ArrivalShownResource);
    if (arrival && !arrival.shown) {
        arrival.route = route;
    }
}

const StatusLineResize = new System({
    name: 'StatusLineResize',
    events: [ResizeEvent],
    args: [StatusLineResource, ResizeEvent] as const,
    step(statusLine, { y }) {
        statusLine.reposition(y);
    },
});

// Composes the "Jumping into ..." arrival line once per system (the display
// world is rebuilt on each jump; a gate transit's world gets the hypergate
// or wormhole lead through setArrivalRoute), then clears it (statusLineAlpha). Reads the player's synced
// game date; never mutates the simulation.
export const DrawStatusMessage = new System({
    name: 'DrawStatusMessage',
    args: [StatusLineResource, ArrivalShownResource, DateSuffixResource,
        GameDateComponent, TimeResource, SimulationGameDataResource,
        SystemIdResource, PlayerShipSelector] as const,
    step(statusLine, arrivalShown, dateSuffix, date, { time }, gameData,
        systemId) {
        if (!arrivalShown.shown) {
            const systemName = gameData.data.System.getCached(systemId)?.name;
            if (systemName) {
                statusLine.setMessage(
                    jumpArrivalMessage(systemName, date, dateSuffix.suffix,
                        arrivalShown.route),
                    time);
                arrivalShown.shown = true;
            }
        }
        statusLine.update(time);
    },
    // #156 pin (shared: SimulationGameData; GameDate, ShipControl):
    // StatusMessagePlugin registers between StatusBarPlugin and the core
    // AnimationPlugin.
    after: [DrawDockedStatus],
    before: [ProjectileAnimationProvider],
});

// Shows the original's too-far / too-fast land feedback on the bottom-left
// status line. LandingBlockedEvent is emitted in the simulation targeted at
// the player's ship and re-emitted here (via the simulation bridge), so the
// PlayerShipSelector arg fires it only on the local player's client — the
// same targeting the arrival line and player sounds use.
const ShowLandingBlockedMessage = new System({
    name: 'ShowLandingBlockedMessage',
    events: [LandingBlockedEvent],
    args: [LandingBlockedEvent, StatusLineResource, TimeResource,
        PlayerShipSelector, Emit] as const,
    step({ reason, isStation, stellarName, gateKind }, statusLine, { time },
        _player, emit) {
        statusLine.setMessage(
            landingBlockedMessage(reason, isStation, stellarName, gateKind),
            time);
        emit(UiSoundEvent, { id: BEEP_CANT_DO });
    },
});

// Traffic control cleared the player. At a hypergate: one of the three
// stock clearance lines (status_bar_content.ts hypergateClearedMessage),
// the form picked at random as the original seems to (ten clearances,
// 1 / 6 / 3; reference "Hypergate clearance lines, wave 28"). Math.random
// is fine here: the line is this client's own status line and nothing in
// the simulation reads it. The clearance a standing request gets on
// entering the zone with no press (`automatic`) is #91, "Cleared for
// hypergate entry, <ship>." (reference "Hypergates, wave 30", finding 3;
// GUESS that it is always that form: one run). At a port or a station:
// the two pieces the sim drew (stellarClearedMessage; reference "Planet
// and station clearance, wave 31", finding 1), automatic or not.
// No beep: nothing was refused.
const ShowLandingClearedMessage = new System({
    name: 'ShowLandingClearedMessage',
    events: [LandingClearedEvent],
    args: [LandingClearedEvent, StatusLineResource, TimeResource,
        PlayerShipSelector, Optional(PlayerNamesComponent),
        Optional(ShipDataComponent)] as const,
    step({ kind, automatic, form, welcome, stellarName }, statusLine,
        { time }, _player, names, shipData) {
        const shipName = playerShipName(names, shipData?.name);
        if (kind !== 'hypergate') {
            statusLine.setMessage(stellarClearedMessage(kind === 'station',
                form ?? 0, welcome ?? false, stellarName ?? '', shipName),
                time);
            return;
        }
        const gateForm = automatic ? 0
            : Math.floor(Math.random() * HYPERGATE_CLEARED_FORMS);
        statusLine.setMessage(hypergateClearedMessage(gateForm, shipName),
            time);
    },
});

// The `l` that selects a stellar from outside its entry window: traffic
// control acknowledges the request ("Hypergate is energized, <ship>. Begin
// initial approach." etc., status_bar_content.ts landingRequestMessage;
// reference "Hypergate `l` range and the request lines, wave 29"). The
// form comes from the sim's salted hash (LandingRequestEvent `form`), so
// it is the same on every peer. No beep: nothing was refused.
const ShowLandingRequestMessage = new System({
    name: 'ShowLandingRequestMessage',
    events: [LandingRequestEvent],
    args: [LandingRequestEvent, StatusLineResource, TimeResource,
        PlayerShipSelector, Optional(PlayerNamesComponent),
        Optional(ShipDataComponent)] as const,
    step({ kind, form, stellarName, online }, statusLine, { time }, _player,
        names, shipData) {
        statusLine.setMessage(landingRequestMessage(kind, form, stellarName,
            playerShipName(names, shipData?.name), online), time);
    },
});

// The boarding-gate feedback, mirroring the landing one: emitted in the
// sim targeted at the boarding ship, re-emitted here, shown only on the
// local player's client (PlayerShipSelector).
const ShowBoardingBlockedMessage = new System({
    name: 'ShowBoardingBlockedMessage',
    events: [BoardingBlockedEvent],
    args: [BoardingBlockedEvent, StatusLineResource, TimeResource,
        PlayerShipSelector, Emit] as const,
    step({ reason }, statusLine, { time }, _player, emit) {
        const message = boardingBlockedMessage(reason);
        // An empty message is the original's SILENT refusal (a misaligned
        // press, ruling #378): the line is cleared and nothing is said,
        // so the cant-do beep stays quiet too.
        statusLine.setMessage(message, time);
        if (message !== '') {
            emit(UiSoundEvent, { id: BEEP_CANT_DO });
        }
    },
});

// The ONE capture attempt a plunder session gets was repelled. The sim
// ends the session on the same tick, so the plunder dialog has already
// closed by the time this arrives — the status line is the only place the
// player is told what happened, which is why the sim emits an event for
// it at all. A failure, so it takes the cant-do beep.
const ShowBoardingRepelledMessage = new System({
    name: 'ShowBoardingRepelledMessage',
    events: [BoardingRepelledEvent],
    args: [StatusLineResource, TimeResource, PlayerShipSelector,
        Emit] as const,
    step(statusLine, { time }, _player, emit) {
        statusLine.setMessage(captureRepelledMessage(), time);
        emit(UiSoundEvent, { id: BEEP_CANT_DO });
    },
});

// A booty take tripped the hulk's security self-destruct
// (boarding_plugin's tripPlunderSelfDestruct): the hulk is destroyed and
// the session over on the same tick, so the dialog has already closed and
// the status line says why. No beep: the hulk's own explosion is the
// sound of it.
const ShowPlunderSelfDestructMessage = new System({
    name: 'ShowPlunderSelfDestructMessage',
    events: [PlunderSelfDestructEvent],
    args: [StatusLineResource, TimeResource, PlayerShipSelector] as const,
    step(statusLine, { time }) {
        statusLine.setMessage(plunderSelfDestructMessage(), time);
    },
});

// Pirates boarded the LOCAL PLAYER's disabled ship and took cargo and a
// share of their cash (gövt Flags 0x1000): "<N> tons of cargo and <M>
// credits stolen!" (reference A9, wave 38). Emitted in the sim targeted at the
// plundered ship, re-emitted here, shown on that player's client only.
// No dialog opens (the take is over in one tick), so this line and the
// boarding beep are the whole of the experience — hence the sound: it is
// the same clamp-on beep the player hears when THEY board somebody
// (BOARD_SOUND, snd nova:390), which is exactly what has just happened to
// them. No cant-do beep: nothing was refused.
const ShowPlayerPlunderedMessage = new System({
    name: 'ShowPlayerPlunderedMessage',
    events: [PlayerPlunderedEvent],
    args: [PlayerPlunderedEvent, StatusLineResource, TimeResource,
        PlayerShipSelector, Emit] as const,
    step({ credits, tons }, statusLine, { time }, _player, emit) {
        statusLine.setMessage(playerPlunderedMessage(credits, tons), time);
        emit(UiSoundEvent, { id: BOARD_SOUND });
    },
});

// An AI 4 interceptor scanned the LOCAL PLAYER's ship and found
// contraband (npc/contraband_scan.ts). Emitted in the sim targeted at the
// scanned ship, re-emitted here, shown on that player's client only — in
// multiplayer every pilot is scanned, and told, separately. The scanner
// is named as the target pane names it (target_identity.ts: a përs's or
// a mission's own name, else the ship class), and the pilot by the
// profile's name, as the original addressed "w11-scan-pod". No sound: the
// reference recording has none to match (not checked).
/** A ship's name as the target pane gives it (target_identity.ts: a
 * përs's or a mission's own name, else the ship class). */
function shipLabel(ship: Entity | undefined): string {
    return targetIdentity({
        persName: ship?.components.get(PersComponent)?.name,
        missionName: ship?.components.get(MissionShipComponent)?.name,
        shipClass: displayName(
            ship?.components.get(ShipDataComponent)?.name ?? ''),
    }).name;
}

const ShowContrabandScanMessage = new System({
    name: 'ShowContrabandScanMessage',
    events: [ContrabandScanEvent],
    args: [ContrabandScanEvent, StatusLineResource, TimeResource, Entities,
        PlayerShipSelector] as const,
    step(scan, statusLine, { time }, entities) {
        const name = shipLabel(entities.get(scan.scanner));
        let pilot: string | undefined;
        try {
            pilot = loadPilotProfile()?.name || undefined;
        } catch {
            pilot = undefined;
        }
        const message = contrabandScanMessage({
            ...scan, scanner: name, pilot,
        });
        if (message !== '') {
            statusLine.setMessage(message, time);
        }
    },
});

// A trader under NPC attack called for help (npc/distress.ts): "<ship>:
// <STR# 5003 line>", on the status line of EVERY player in the system, as
// the original showed it to a pilot only watching (reference "P1 wave 14").
// The event is untargeted (one per call), so this runs once on the
// singleton. The sim's PRNG draw picks the line, so every client shows the
// same one. No sound (none noticed in the reference watch; not checked).
const ShowDistressCallMessage = new System({
    name: 'ShowDistressCallMessage',
    events: [DistressCallEvent],
    args: [DistressCallEvent, StatusLineResource, TimeResource, Entities,
        DistressLinesResource, SingletonComponent] as const,
    step({ ship, roll }, statusLine, { time }, entities, { lines }) {
        const line = distressLine(lines, roll);
        const caller = entities.get(ship);
        if (line === undefined || caller === undefined) {
            return;
        }
        statusLine.setMessage(distressCallMessage(shipLabel(caller), line),
            time);
    },
});

/** The scenario's misc strings (STR# 2002), for the reinforcement line's
 * halves; a display asset the sim never reads. */
const ReinforcementLinesResource = new Resource<{ lines: string[] }>(
    'ReinforcementLines');

// A system's reinforcement fleet arrived (spawn/reinforcements.ts):
// "Sensors detect <MediumName> reinforcement fleet approaching." on the
// status line of EVERY player in the system, as the original said it to the
// player when the fleet came in (reference "R19 reinforcement fleets, wave
// 19"). GUESS: every player in a room hears it, not only the caller. The
// event is untargeted, so this runs once on the singleton. No sound (none
// noticed; not checked).
const ShowReinforcementArrivalMessage = new System({
    name: 'ShowReinforcementArrivalMessage',
    events: [ReinforcementArrivalEvent],
    args: [ReinforcementArrivalEvent, StatusLineResource, TimeResource,
        ReinforcementLinesResource, SingletonComponent] as const,
    step({ name }, statusLine, { time }, { lines }) {
        statusLine.setMessage(reinforcementArrivalMessage(lines, name), time);
    },
});

// Success feedback when boarding repairs one of your own disabled flock
// members (EscortRepairedEvent from the boarding gate). Like the blocked
// messages it is emitted in the sim targeted at the boarding ship and
// shown only on the local player's client (PlayerShipSelector) — but it
// is a success, so no cant-do beep.
const ShowEscortRepairedMessage = new System({
    name: 'ShowEscortRepairedMessage',
    events: [EscortRepairedEvent],
    args: [StatusLineResource, TimeResource, PlayerShipSelector] as const,
    step(statusLine, { time }) {
        statusLine.setMessage(escortRepairedMessage(), time);
    },
});

// The LOCAL player's own ship was just disabled (disabled_plugin's
// ShipDisabledEvent, emitted in the sim targeted at that ship, re-emitted
// here; PlayerShipSelector keeps it to that player's client): "Ship
// disabled." (reference "A disabled player (A10), wave 37", finding 3), or
// "Ship disabled - hyperspace field collapsed." when the disable cut a jump
// short (reference "Jump phases and fuel (U8), wave 38", finding 4).
// No sound (none checked in the reference).
export const ShowShipDisabledMessage = new System({
    name: 'ShowShipDisabledMessage',
    events: [ShipDisabledEvent],
    args: [ShipDisabledEvent, StatusLineResource, TimeResource,
        PlayerShipSelector] as const,
    step({ jumpCollapsed }, statusLine, { time }) {
        statusLine.setMessage(jumpCollapsed
            ? JUMP_COLLAPSED_MESSAGE : SHIP_DISABLED_MESSAGE, time);
    },
});

// The LOCAL player's own disabled ship repaired itself (disabled_plugin's
// ShipRepairedEvent, the repair-system outfit's or the inherent repair's):
// "Propulsion systems repaired." (reference "Wave-37 leftovers, wave 38",
// A10). No sound (none checked in the reference).
export const ShowShipRepairedMessage = new System({
    name: 'ShowShipRepairedMessage',
    events: [ShipRepairedEvent],
    args: [StatusLineResource, TimeResource, PlayerShipSelector] as const,
    step(statusLine, { time }) {
        statusLine.setMessage(SHIP_REPAIRED_MESSAGE, time);
    },
});

// A rescue board took the mission cargo (rescue_board.ts): no dialog
// opens, so this line is all the original shows. Same targeting as the
// other boarding messages, and a success, so no cant-do beep.
const ShowCargoRetrievedMessage = new System({
    name: 'ShowCargoRetrievedMessage',
    events: [MissionCargoRetrievedEvent],
    args: [MissionCargoRetrievedEvent, StatusLineResource, TimeResource,
        CargoNamesResource, PlayerShipSelector] as const,
    step({ cargoType }, statusLine, { time }, { names, lower }) {
        statusLine.setMessage(cargoRetrievedMessage(
            missionCargoName(cargoType, names, lower)), time);
    },
});

// The bay-capture shortcut's only feedback: no dialog opens, so this line
// is how the player learns the hulk is now one of their fighters. Same
// targeting as the other boarding messages (emitted at the boarder,
// re-emitted here, shown on the local player's client only), and a success,
// so no cant-do beep. The ship class name is resolved from game data.
const ShowBayCaptureMessage = new System({
    name: 'ShowBayCaptureMessage',
    events: [BayCaptureEvent],
    args: [BayCaptureEvent, StatusLineResource, TimeResource,
        SimulationGameDataResource, PlayerShipSelector] as const,
    step({ shipId }, statusLine, { time }, gameData) {
        statusLine.setMessage(
            bayCaptureMessage(gameData.data.Ship.getCached(shipId)?.name),
            time);
    },
});

/**
 * How old (in SIMULATION ms) another player's hail may be when this client
 * first sees it and still print it. A hail from another peer is applied
 * here by a rollback correction, a few ticks after the moment it was sent,
 * and then mirrored to this display on the next frame — well inside this.
 * What it excludes is the stale one: a SentHail left on a ship this client
 * only now meets (it jumped in, or joined), which is old news.
 */
export const PLAYER_HAIL_FRESH_MS = 5_000;

/** Per sender uuid, the SentHail seq this client has already handled. */
export const SeenPlayerHailsResource =
    new Resource<Map<string, number>>('SeenPlayerHails');

/**
 * ANOTHER PLAYER HAILED US (#332). Their ship carries the SentHail its last
 * press recorded (hail_plugin.ts — on the SENDER's ship, never ours); every
 * one addressed to this client's own ship is printed on the status line
 * once per seq, naming the sender's ship. Runs on the local player only
 * (PlayerShipSelector), so the sender's own screen shows nothing.
 *
 * Pure display: it reads mirrored sim state and never writes it. The
 * freshness test reads the MIRRORED SIM CLOCK (SentHail.at is sim time).
 */
export const ShowPlayerHailMessage = new System({
    name: 'ShowPlayerHailMessage',
    args: [Entities, UUID, StatusLineResource, TimeResource,
        SimulationTimeResource, SeenPlayerHailsResource,
        PlayerShipSelector] as const,
    step(entities, me, statusLine, { time }, simulationTime, seen) {
        // Sorted, so two hails landing in the same frame print in the same
        // order on every client (the second one wins the line).
        const senders = [...entities]
            .filter(([uuid, entity]) => uuid !== me
                && entity.components.get(SentHailComponent)?.to === me)
            .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
        for (const [uuid, entity] of senders) {
            const hail = entity.components.get(SentHailComponent)!;
            if (seen.get(uuid) === hail.seq) {
                continue;
            }
            seen.set(uuid, hail.seq);
            if (simulationTime.time - hail.at > PLAYER_HAIL_FRESH_MS) {
                continue;
            }
            const name = entity.components.get(ShipDataComponent)?.name;
            statusLine.setMessage(playerHailMessage(
                name ? displayName(name) : undefined, hail.message), time);
        }
    },
});

export const StatusMessagePlugin: Plugin = {
    name: 'StatusMessage',
    async build(world) {
        const simulationData = world.resources.get(SimulationGameDataResource);
        if (!simulationData) {
            throw new Error('Expected simulation game data resource to exist');
        }
        const stage = world.resources.get(Stage);
        if (!stage) {
            throw new Error('Expected Stage resource to exist');
        }

        // The scenario's date suffix (" NC" in stock Nova) and its cargo
        // names, read once.
        let suffix = '';
        let cargoNames: string[] = [];
        let cargoNamesLower: string[] = [];
        try {
            const ids = await simulationData.ids;
            if (ids.PlayerStart.length > 0) {
                const starts = await Promise.all(ids.PlayerStart.map(
                    id => simulationData.data.PlayerStart.get(id)));
                const start = starts.find(s => s.isDefault) ?? starts[0];
                suffix = start?.dateSuffix ?? '';
                cargoNames = [...(start?.cargoNames ?? [])];
                cargoNamesLower = [...(start?.cargoNamesLower ?? [])];
            }
        } catch (e) {
            console.warn('Failed to load player start for date suffix:', e);
        }
        world.resources.set(DateSuffixResource, { suffix });
        world.resources.set(CargoNamesResource,
            { names: cargoNames, lower: cargoNamesLower });
        world.resources.set(ArrivalShownResource,
            { shown: false, route: 'hyperspace' });
        // The distress lines load in the background: a display asset the
        // sim never reads (it carries only the draw).
        const distressLines = { lines: [] as string[] };
        world.resources.set(DistressLinesResource, distressLines);
        void world.resources.get(DisplayAssetDataResource)?.data.StringTable
            .get(DISTRESS_MESSAGES_STRING_TABLE)
            .then(table => { distressLines.lines = [...table.strings]; })
            .catch(e => console.warn('Failed to load distress lines:', e));
        // The reinforcement line's halves, likewise (until they load, or
        // in a scenario without them, the line uses the Bible's wording).
        const reinforcementLines = { lines: [] as string[] };
        world.resources.set(ReinforcementLinesResource, reinforcementLines);
        void world.resources.get(DisplayAssetDataResource)?.data.StringTable
            .get(REINFORCEMENT_STRING_TABLE)
            .then(table => { reinforcementLines.lines = [...table.strings]; })
            .catch(e => console.warn('Failed to load misc strings:', e));

        const statusLine = new StatusLine();
        const screen = world.resources.get(ScreenSize);
        statusLine.reposition(screen?.y ?? window.innerHeight);
        stage.addChild(statusLine.container);
        world.resources.set(StatusLineResource, statusLine);

        world.addSystem(StatusLineResize);
        world.addSystem(DrawStatusMessage);
        world.addSystem(ShowLandingBlockedMessage);
        world.addSystem(ShowLandingClearedMessage);
        world.addSystem(ShowLandingRequestMessage);
        world.addSystem(ShowBoardingBlockedMessage);
        world.addSystem(ShowBoardingRepelledMessage);
        world.addSystem(ShowPlunderSelfDestructMessage);
        world.addSystem(ShowPlayerPlunderedMessage);
        world.addSystem(ShowContrabandScanMessage);
        world.addSystem(ShowDistressCallMessage);
        world.addSystem(ShowReinforcementArrivalMessage);
        world.addSystem(ShowEscortRepairedMessage);
        world.addSystem(ShowShipDisabledMessage);
        world.addSystem(ShowShipRepairedMessage);
        world.addSystem(ShowBayCaptureMessage);
        world.addSystem(ShowCargoRetrievedMessage);
        world.resources.set(SeenPlayerHailsResource, new Map());
        world.addSystem(ShowPlayerHailMessage);
    },
    remove(world) {
        world.removeSystem(StatusLineResize);
        world.removeSystem(DrawStatusMessage);
        world.removeSystem(ShowLandingBlockedMessage);
        world.removeSystem(ShowLandingClearedMessage);
        world.removeSystem(ShowLandingRequestMessage);
        world.removeSystem(ShowBoardingBlockedMessage);
        world.removeSystem(ShowBoardingRepelledMessage);
        world.removeSystem(ShowPlunderSelfDestructMessage);
        world.removeSystem(ShowPlayerPlunderedMessage);
        world.removeSystem(ShowContrabandScanMessage);
        world.removeSystem(ShowDistressCallMessage);
        world.removeSystem(ShowReinforcementArrivalMessage);
        world.removeSystem(ShowEscortRepairedMessage);
        world.removeSystem(ShowShipDisabledMessage);
        world.removeSystem(ShowShipRepairedMessage);
        world.removeSystem(ShowBayCaptureMessage);
        world.removeSystem(ShowCargoRetrievedMessage);
        world.removeSystem(ShowPlayerHailMessage);
        world.resources.delete(SeenPlayerHailsResource);
        // Destroyed, children included: the line's Text owns a canvas
        // texture that leaked with every transit (review #40).
        world.resources.get(StatusLineResource)?.container
            .destroy({ children: true });
        world.resources.delete(StatusLineResource);
        world.resources.delete(DateSuffixResource);
        world.resources.delete(CargoNamesResource);
        world.resources.delete(ArrivalShownResource);
        world.resources.delete(DistressLinesResource);
    },
};
