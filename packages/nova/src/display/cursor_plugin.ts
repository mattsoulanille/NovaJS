import { Entities } from 'nova_ecs/arg_types';
import { EntityMap } from 'nova_ecs/entity_map';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from 'nova_ecs/world';
import * as PIXI from 'pixi.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { DisplayAssetDataResource } from '../nova_plugin/game_data_resource.js';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin.js';
import { pickNearest } from '../tap_targeting.js';
import { PixiAppResource } from './pixi_app_resource.js';
import {
    clientToUi, clientToWorld, DisplayScaleResource,
} from './screen_size_plugin.js';
import { Space } from './space_resource.js';
import { Stage } from './stage_resource.js';
import { texturesFromFrames } from './textures_from_frames.js';

/**
 * The in-flight game cursor (space/notes.txt): while flying, the OS mouse
 * cursor is replaced with rlëD 8080. It shows the sprite's first frame while
 * idle over empty space, ANIMATES through the frames while hovering over
 * something selectable (a ship or a planet — exactly what tap targeting
 * would pick), and FADES into the background once the mouse has sat still
 * for a while. Over ANY visible modal dialog (starmap, spaceport, hypergate
 * map, player info, mission info, the hail comm dialog, the boarding/plunder
 * and capture-assignment dialogs) and while docked, the sprite hides and the
 * normal OS cursor comes back.
 *
 * Purely display-side and player-local: it never touches simulation state.
 */

const CURSOR_RLED = 'nova:8080';
/** How long each animation frame shows while hovering something selectable. */
const CURSOR_FRAME_MS = 60;
/** How long the mouse must sit still before the cursor starts to fade... */
const FADE_DELAY_MS = 2500;
/** ...and how long the fade to invisible takes from there. */
const FADE_MS = 1000;

/** Full-screen menu containers that count as "a dialog is open" while in
 * flight (each is a direct Stage child that keeps its container when hidden).
 * These fill the frame rather than carrying a modal shield, so they're matched
 * by name; every OTHER modal is detected generically via its shield (see
 * hasModalShield). */
const MENU_CONTAINER_NAMES = new Set(
    ['Spaceport', 'StarMap', 'GateMap', 'PlayerInfo']);

/** Minimum local-bounds extent (px) that marks a container's child as a
 * full-screen modal shield. Every in-flight dialog (hail, plunder, capture
 * assignment, mission info, ship info, player info) lays a giant interactive
 * Graphics (8000x8000) behind its content to swallow clicks; nothing else on
 * the stage is remotely this large, so a child at/above this size uniquely
 * identifies "a modal overlay is open". */
const MODAL_SHIELD_MIN_EXTENT = 6000;

/** Whether a visible stage child is a modal dialog: it carries a screen-
 * covering interactive shield. Detecting the shield rather than enumerating
 * dialog names keeps the rule general — any current or future shielded dialog
 * reverts the OS cursor without being listed here. */
function hasModalShield(container: PIXI.DisplayObject): boolean {
    if (!(container instanceof PIXI.Container)) {
        return false;
    }
    for (const child of container.children) {
        if (child instanceof PIXI.Graphics) {
            const bounds = child.getLocalBounds();
            if (bounds.width >= MODAL_SHIELD_MIN_EXTENT
                && bounds.height >= MODAL_SHIELD_MIN_EXTENT) {
                return true;
            }
        }
    }
    return false;
}

export class GameCursor {
    readonly container = new PIXI.Container();
    private readonly sprite = new PIXI.Sprite();
    /** All frames of the cursor rlëD, in order. */
    textures: PIXI.Texture[] = [];
    readonly built: Promise<void>;

    /** Latest pointer position in screen (= stage) pixels, if the pointer
     * is over the page at all. */
    mouse?: { x: number, y: number };
    /** Set by the DOM listener; the draw system stamps lastMove off it (the
     * display clock isn't available inside a DOM event handler). */
    movedSinceStep = false;
    /** Display-clock ms of the last mouse movement. */
    lastMove = 0;
    /** Current animation frame and when it last advanced. */
    frame = 0;
    lastAdvance = 0;

    constructor(displayAssets: DisplayAssetDataInterface) {
        this.container.name = 'GameCursor';
        this.container.visible = false;
        // The chevron art is centered in its frame; track the hotspot at
        // the center like the original.
        this.sprite.anchor.set(0.5);
        this.container.addChild(this.sprite);
        this.built = this.build(displayAssets);
    }

    private async build(displayAssets: DisplayAssetDataInterface) {
        // Same spritesheet path the starfield uses: loading the frames JSON
        // registers every frame texture with PIXI's cache.
        const { frames } =
            await displayAssets.data.SpriteSheetFrames.get(CURSOR_RLED);
        // The world may have been torn down while the frames loaded; a
        // destroyed sprite must not be handed a texture.
        if (this.container.destroyed) {
            return;
        }
        this.textures = texturesFromFrames(frames);
        this.setFrame(0);
    }

    setFrame(index: number) {
        const texture = this.textures[index];
        if (texture) {
            this.sprite.texture = texture;
        }
    }
}

export const GameCursorResource = new Resource<GameCursor>('GameCursor');

/** True while any full-screen dialog is open (or the player is docked), so
 * the OS cursor should act normally. */
function menuOpen(stage: PIXI.Container): boolean {
    if (typeof document !== 'undefined'
        && document.body.classList.contains('nova-docked')) {
        return true;
    }
    return stage.children.some(child => child.visible
        && ((child.name !== null && MENU_CONTAINER_NAMES.has(child.name))
            || hasModalShield(child)));
}

/** Entities the cursor considers hover-selectable: everything tap targeting
 * would pick except the player's own ship. */
function* selectableEntities(entities: EntityMap) {
    for (const pair of entities) {
        if (!pair[1].components.has(PlayerShipSelector)) {
            yield pair;
        }
    }
}

/** Hides or restores the OS cursor over the game canvas. Sets both the
 * canvas style (immediate) and PIXI's default cursor style (so the event
 * system's own cursor management doesn't undo it on the next pointer
 * event). */
function setOsCursorHidden(app: PIXI.Application | undefined, hidden: boolean) {
    if (!app) {
        return;
    }
    const styles = app.renderer.events.cursorStyles;
    styles.default = hidden ? 'none' : 'inherit';
    // ICanvas's style is optional: an OffscreenCanvas has none.
    const style = app.view.style;
    if (style) {
        style.cursor = hidden ? 'none' : '';
    }
}

const DrawCursorSystem = new System({
    name: 'DrawCursorSystem',
    args: [GameCursorResource, TimeResource, Space, Stage, Entities,
        DisplayScaleResource, Optional(PixiAppResource),
        SingletonComponent] as const,
    step(cursor, time, space, stage, entities, scale, app) {
        if (cursor.movedSinceStep) {
            cursor.movedSinceStep = false;
            cursor.lastMove = time.time;
        }

        // Over dialogs / while docked (or with no pointer on the page) the
        // game cursor hides and the OS cursor acts normally.
        if (!cursor.mouse || menuOpen(stage)) {
            cursor.container.visible = false;
            setOsCursorHidden(app, false);
            return;
        }
        setOsCursorHidden(app, true);
        cursor.container.visible = true;
        // The pointer arrives in CSS pixels; the cursor sprite lives in
        // the UI layer and the entities live in the world layer, so the
        // two conversions differ by the UI scale.
        cursor.container.position.set(
            clientToUi(cursor.mouse.x, scale),
            clientToUi(cursor.mouse.y, scale));

        // Hovering something selectable animates the cursor through its
        // frames; idle over nothing pins the first frame. Screen -> world is
        // a subtraction because the camera only translates (see
        // tap_targeting.ts).
        const worldX = clientToWorld(cursor.mouse.x, scale) - space.position.x;
        const worldY = clientToWorld(cursor.mouse.y, scale) - space.position.y;
        const { bestShip, bestPlanet } = pickNearest(
            selectableEntities(entities), undefined, worldX, worldY);
        if (bestShip || bestPlanet) {
            if (time.time - cursor.lastAdvance >= CURSOR_FRAME_MS
                && cursor.textures.length > 0) {
                cursor.lastAdvance = time.time;
                cursor.frame = (cursor.frame + 1) % cursor.textures.length;
            }
        } else {
            cursor.frame = 0;
        }
        cursor.setFrame(cursor.frame);

        // An untouched mouse fades into the background; any movement snaps
        // it back.
        const idle = time.time - cursor.lastMove;
        cursor.container.alpha = idle <= FADE_DELAY_MS ? 1
            : Math.max(0, 1 - (idle - FADE_DELAY_MS) / FADE_MS);
    },
});

const CursorListenersResource =
    new Resource<{ remove(): void }>('CursorListeners');

export const CursorPlugin: Plugin = {
    name: 'CursorPlugin',
    build(world) {
        const displayAssets = world.resources.get(DisplayAssetDataResource);
        if (!displayAssets) {
            throw new Error('Expected world to have display assets');
        }
        const stage = world.resources.get(Stage);
        if (!stage) {
            throw new Error('Expected world to have Stage resource');
        }

        const cursor = new GameCursor(displayAssets);
        // Added last / on top: the cursor draws over the flight view and the
        // statusbar. (It hides itself while dialogs are open, so their
        // stacking never matters.)
        stage.addChild(cursor.container);
        world.resources.set(GameCursorResource, cursor);

        const onPointerMove = (event: PointerEvent) => {
            cursor.mouse = { x: event.clientX, y: event.clientY };
            cursor.movedSinceStep = true;
        };
        const onPointerGone = () => {
            cursor.mouse = undefined;
        };
        if (typeof window !== 'undefined') {
            window.addEventListener('pointermove', onPointerMove);
            document.documentElement.addEventListener(
                'mouseleave', onPointerGone);
            window.addEventListener('blur', onPointerGone);
        }
        world.resources.set(CursorListenersResource, {
            remove() {
                if (typeof window !== 'undefined') {
                    window.removeEventListener('pointermove', onPointerMove);
                    document.documentElement.removeEventListener(
                        'mouseleave', onPointerGone);
                    window.removeEventListener('blur', onPointerGone);
                }
            }
        });

        world.addSystem(DrawCursorSystem);
    },
    remove(world) {
        world.removeSystem(DrawCursorSystem);
        world.resources.get(CursorListenersResource)?.remove();
        world.resources.delete(CursorListenersResource);
        // Destroyed, children included: the cursor sprite is per-world
        // and leaked with every transit (review #40). Its rlëD frame
        // textures are the asset cache's and are left alone.
        world.resources.get(GameCursorResource)?.container
            .destroy({ children: true });
        // The display world tears down at every system transit; put the OS
        // cursor back so menus/loading screens aren't cursorless.
        setOsCursorHidden(world.resources.get(PixiAppResource), false);
        world.resources.delete(GameCursorResource);
    }
};
