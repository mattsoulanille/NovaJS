import { Emit } from "nova_ecs/arg_types";
import { Plugin } from "nova_ecs/plugin";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { World } from "nova_ecs/world";
import { BEEP_CANT_DO, UiSoundEvent } from "./ui_sound.js";
import * as PIXI from "pixi.js";
import { SimulationGameDataResource } from "../nova_plugin/core/game_data_resource.js";
import { GameDateComponent } from "../nova_plugin/player/player_state_plugin.js";
import { PlayerShipSelector } from "../nova_plugin/player/player_ship_plugin.js";
import { SystemIdResource } from "../nova_plugin/core/system_id_resource.js";
import { bayCaptureMessage, boardingBlockedMessage, captureRepelledMessage, escortRepairedMessage, jumpArrivalMessage, landingBlockedMessage, playerPlunderedMessage } from "./status_bar_content.js";
import { LandingBlockedEvent } from "../nova_plugin/travel/planet_plugin.js";
import { BayCaptureEvent, BOARD_SOUND, BoardingBlockedEvent, BoardingRepelledEvent, EscortRepairedEvent } from "../nova_plugin/encounters/boarding_plugin.js";
import { PlayerPlunderedEvent } from "../nova_plugin/npc/npc_ai_plugin.js";
import { ResizeEvent, ScreenSize } from "./screen_size_plugin.js";
import { Stage } from "./stage_resource.js";
import { DrawDockedStatus } from "./status_bar_docked.js";
import { ProjectileAnimationProvider } from "../nova_plugin/core/animation_plugin.js";

/**
 * The bottom-left on-screen status line the original game uses for the date on
 * system entry and transient gameplay messages (e.g. "Jumping into the Sanddown
 * system on November 21st, 1177 NC."). Display-only: it reads simulation state
 * (never writes it) and fades a message out after a few seconds.
 */
class StatusLine {
    readonly container = new PIXI.Container();
    private readonly text: PIXI.Text;
    /** Wall-clock time (TimeResource) the current message was set. */
    private shownAt = -Infinity;
    /** How long the message stays fully opaque, then how long it fades. */
    private static readonly HOLD_MS = 8000;
    private static readonly FADE_MS = 4000;
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

    /** Fades the message: fully shown for HOLD_MS, then linearly over FADE_MS. */
    update(time: number) {
        const age = time - this.shownAt;
        if (age <= StatusLine.HOLD_MS) {
            this.container.alpha = 1;
        } else {
            this.container.alpha = Math.max(0,
                1 - (age - StatusLine.HOLD_MS) / StatusLine.FADE_MS);
        }
    }

    reposition(screenHeight: number) {
        this.container.position.set(StatusLine.INSET_X,
            screenHeight - StatusLine.INSET_Y);
    }
}

export const StatusLineResource = new Resource<StatusLine>('StatusLine');

/**
 * Posts a transient line on the bottom-left status line from display code
 * that isn't an ECS system (rxjs control subscriptions, promise
 * continuations) but holds the display world — the StatusLine twin of
 * ui_sound's playUiSound. A no-op when the plugin isn't built (headless
 * specs), and it never touches the simulation. The systems below set the
 * line directly with their own `Emit`/TimeResource args; this exists only
 * for the callers that have neither.
 */
export function showStatusMessage(world: World, message: string) {
    world.resources.get(StatusLineResource)?.setMessage(message,
        world.resources.get(TimeResource)?.time ?? 0);
}
/** The scenario's date suffix (e.g. " NC"), fetched once at build. */
const DateSuffixResource = new Resource<{ suffix: string }>('StatusLineDateSuffix');
/** Marks that the arrival message has been shown for this system's world. */
const ArrivalShownResource = new Resource<{ shown: boolean }>('StatusLineArrivalShown');

const StatusLineResize = new System({
    name: 'StatusLineResize',
    events: [ResizeEvent],
    args: [StatusLineResource, ResizeEvent] as const,
    step(statusLine, { y }) {
        statusLine.reposition(y);
    },
});

// Composes the "Jumping into ..." arrival line once per system (the display
// world is rebuilt on each jump), then fades it out. Reads the player's synced
// game date; never mutates the simulation.
const DrawStatusMessage = new System({
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
                    jumpArrivalMessage(systemName, date, dateSuffix.suffix),
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

// The boarding-gate feedback, mirroring the landing one: emitted in the
// sim targeted at the boarding ship, re-emitted here, shown only on the
// local player's client (PlayerShipSelector).
const ShowBoardingBlockedMessage = new System({
    name: 'ShowBoardingBlockedMessage',
    events: [BoardingBlockedEvent],
    args: [BoardingBlockedEvent, StatusLineResource, TimeResource,
        PlayerShipSelector, Emit] as const,
    step({ reason }, statusLine, { time }, _player, emit) {
        statusLine.setMessage(boardingBlockedMessage(reason), time);
        emit(UiSoundEvent, { id: BEEP_CANT_DO });
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

// Pirates boarded the LOCAL PLAYER's disabled ship and took a cut of
// their cash (gövt Flags 0x1000). Emitted in the sim targeted at the
// plundered ship, re-emitted here, shown on that player's client only.
// The boarding is over in the tick it happens, so this line and the
// boarding beep are the whole of the experience — hence the sound: it is
// the same clamp-on beep the player hears when THEY board somebody
// (BOARD_SOUND, snd nova:390), which is exactly what has just happened to
// them. No cant-do beep: nothing was refused.
const ShowPlayerPlunderedMessage = new System({
    name: 'ShowPlayerPlunderedMessage',
    events: [PlayerPlunderedEvent],
    args: [PlayerPlunderedEvent, StatusLineResource, TimeResource,
        PlayerShipSelector, Emit] as const,
    step({ credits }, statusLine, { time }, _player, emit) {
        statusLine.setMessage(playerPlunderedMessage(credits), time);
        emit(UiSoundEvent, { id: BOARD_SOUND });
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

        // The scenario's date suffix (" NC" in stock Nova), read once.
        let suffix = '';
        try {
            const ids = await simulationData.ids;
            if (ids.PlayerStart.length > 0) {
                const starts = await Promise.all(ids.PlayerStart.map(
                    id => simulationData.data.PlayerStart.get(id)));
                const start = starts.find(s => s.isDefault) ?? starts[0];
                suffix = start?.dateSuffix ?? '';
            }
        } catch (e) {
            console.warn('Failed to load player start for date suffix:', e);
        }
        world.resources.set(DateSuffixResource, { suffix });
        world.resources.set(ArrivalShownResource, { shown: false });

        const statusLine = new StatusLine();
        const screen = world.resources.get(ScreenSize);
        statusLine.reposition(screen?.y ?? window.innerHeight);
        stage.addChild(statusLine.container);
        world.resources.set(StatusLineResource, statusLine);

        world.addSystem(StatusLineResize);
        world.addSystem(DrawStatusMessage);
        world.addSystem(ShowLandingBlockedMessage);
        world.addSystem(ShowBoardingBlockedMessage);
        world.addSystem(ShowBoardingRepelledMessage);
        world.addSystem(ShowPlayerPlunderedMessage);
        world.addSystem(ShowEscortRepairedMessage);
        world.addSystem(ShowBayCaptureMessage);
    },
    remove(world) {
        world.removeSystem(StatusLineResize);
        world.removeSystem(DrawStatusMessage);
        world.removeSystem(ShowLandingBlockedMessage);
        world.removeSystem(ShowBoardingBlockedMessage);
        world.removeSystem(ShowBoardingRepelledMessage);
        world.removeSystem(ShowPlayerPlunderedMessage);
        world.removeSystem(ShowEscortRepairedMessage);
        world.removeSystem(ShowBayCaptureMessage);
        // Destroyed, children included: the line's Text owns a canvas
        // texture that leaked with every transit (review #40).
        world.resources.get(StatusLineResource)?.container
            .destroy({ children: true });
        world.resources.delete(StatusLineResource);
        world.resources.delete(DateSuffixResource);
        world.resources.delete(ArrivalShownResource);
    },
};
