import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import {
    dayNumber, ActiveMission, GameDateComponent, MissionsComponent,
} from '../nova_plugin/player/index.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import {
    expandMissionText, missionDisplayName,
} from '../nova_plugin/missions/index.js';
import {
    makeDescTextContext, playerGender, ActiveRanksComponent, ControlBitsComponent,
} from '../nova_plugin/ncb/index.js';
import { PlayerIdentitySubs, playerIdentitySubs } from './player_identity.js';
import { ShipComponent } from '../nova_plugin/ship/index.js';
import { Button } from './button.js';
import { MenuControls } from './menu_controls.js';
import { activeAsOffer, offerSubstitutions } from './mission_offers.js';
import { MissionUniverse } from './mission_universe.js';
import { formatMapDate } from './route.js';
import {
    LINE_HEIGHT, MISSION_INFO, ROW_HEIGHT, ROW_TEXT_DY, SELECTION_COLOR,
    listRowY,
} from './dialog_layout.js';
import { wrapIndex } from './list_selection.js';

/**
 * The Abort button's action: aborts mission `missionId` for the player
 * through the simulation (the `abortMission` input record —
 * mission_info_plugin.ts builds and dispatches it), resolving true once
 * the record is on its way and false when there was nothing to abort.
 */
export type MissionInfoAbort = (missionId: string) => Promise<boolean>;

// The Mission Info dialog on the 471x155 PICT 8517 frame: a left list of
// the player's active missions, a right pane with the selected mission's
// briefing text, a date strip of its own in the upper right, and
// Abort / Done along the bottom. The geometry lives in dialog_layout.ts,
// measured against missions/missions_info.png (1920x1080).
// The header is a thin mid grey in the original: its ink peaks at 148
// (0x949494) on missions_info.png, where our 0xc0c0c0 read as bold white.
const HEADER_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 9.4, fill: 0x949494, align: 'left',
    wordWrap: false, lineHeight: LINE_HEIGHT,
};
const DATE_FONT: Partial<PIXI.ITextStyle> = {
    ...HEADER_FONT, fill: 0x808080, align: 'center',
};
const LIST_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 9.4, fill: 0xffffff, align: 'left',
    wordWrap: false, lineHeight: LINE_HEIGHT,
};
const DESC_FONT: Partial<PIXI.ITextStyle> = {
    ...LIST_FONT, wordWrap: true,
    wordWrapWidth: MISSION_INFO.descWrapWidth,
};

/**
 * Stock Nova's own wording: STR# 2002 index 359 / 353. The STR# has no
 * space before the colon, but the original draws one (its bitmap face
 * sets ':' a space clear of the word, as in the map's "Current System :";
 * missions_info.png), which our Geneva does not, so the space is written.
 */
const HEADER_TEXT = 'Currently active missions :';
/** Stock STR# 2002 index 353: the dialog's empty-list text, and the
 * status line's answer to an in-flight 'i' with nothing to list. */
export const NO_MISSIONS = 'You have no active missions.';
export const NO_MISSIONS_STRING_TABLE = 'nova:2002';
export const NO_MISSIONS_STRING_INDEX = 353;

/**
 * The player's missions as the dialog lists them: mïsn Flags "invisible"
 * ones are never listed. `universe` must be loaded.
 */
export function listedMissions(entity: Entity, universe: MissionUniverse):
    [string, ActiveMission][] {
    const missions = entity.components.get(MissionsComponent);
    return missions
        ? [...missions].filter(([id]) =>
            !universe.getMission(id)?.flags.invisible)
        : [];
}

/**
 * The Mission Info dialog ('i'): lists the player's active missions and
 * shows the selected one's briefing text and the current date, on the
 * 8517 frame. Opens in flight only — the original ignores 'i' in the
 * spaceport (the wave-11 UI key matrix) — as a modal overlay on the same
 * focus stack as the starmap / player-info dialogs. Its Abort button
 * aborts the selected mission through an input record the simulation
 * applies on every peer ({@link MissionInfoAbort}), and is greyed for a
 * mïsn with CanAbort 0. Like the original's, it acts at once: no "are
 * you sure?" (the stock STR# resources hold a confirmation for
 * jettisoning cargo and none for aborting a mission).
 */
export class MissionInfoDialog {
    container = new PIXI.Container();
    private controls: MenuControls;
    private closed = new Subject<void>();
    private header = new PIXI.Text('', HEADER_FONT);
    private date = new PIXI.Text('', DATE_FONT);
    private listContainer = new PIXI.Container();
    private highlight = new PIXI.Graphics();
    private description = new PIXI.Text('', DESC_FONT);
    private abort: Button;
    private rowTexts: PIXI.Text[] = [];
    /** Full-width transparent click targets, one per selectable row. */
    private rowHits: PIXI.Container[] = [];
    private missions: [string, ActiveMission][] = [];
    private selectedIndex = 0;
    private currentDay = 0;
    private entity?: Entity;
    private abortAction?: MissionInfoAbort;
    /** <PN>/<PSN>-style identity values, loaded per show(). */
    private identity: PlayerIdentitySubs = {};
    private aborting = false;

    constructor(private displayAssets: DisplayAssetDataInterface,
        private universe: MissionUniverse,
        controlEvents: Observable<ControlEvent>) {
        this.container.name = 'MissionInfo';
        this.container.visible = false;

        // A modal shield behind the frame, so clicks can't reach the
        // screen underneath while the dialog is up.
        const shield = new PIXI.Graphics()
            .beginFill(0x000000, 0.001)
            .drawRect(-4000, -4000, 8000, 8000)
            .endFill();
        shield.interactive = true;
        this.container.addChild(shield);

        const background = this.displayAssets.spriteFromPict('nova:8517');
        background.anchor.set(0.5);
        background.interactive = true;
        this.container.addChild(background);

        this.header.text = HEADER_TEXT;
        this.header.position.set(
            MISSION_INFO.headerText.x, MISSION_INFO.headerText.y);
        // The date is centred in its own strip, not right-aligned:
        // "Nov. 21st, 1177 NC" shares the strip's midpoint (x1128).
        this.date.anchor.set(0.5, 0);
        this.date.position.set(
            MISSION_INFO.dateCenter, MISSION_INFO.dateText.y);
        this.listContainer.position.set(
            MISSION_INFO.list.x, MISSION_INFO.list.y);
        this.description.position.set(
            MISSION_INFO.descText.x, MISSION_INFO.descText.y);
        this.container.addChild(this.highlight, this.header, this.date,
            this.listContainer, this.description);

        // Clip the list and description to their panes.
        const listMask = new PIXI.Graphics().beginFill(0xffffff)
            .drawRect(MISSION_INFO.list.x, MISSION_INFO.list.y,
                MISSION_INFO.list.width, MISSION_INFO.list.height)
            .endFill();
        this.container.addChild(listMask);
        this.listContainer.mask = listMask;
        const descMask = new PIXI.Graphics().beginFill(0xffffff)
            .drawRect(MISSION_INFO.desc.x, MISSION_INFO.desc.y,
                MISSION_INFO.desc.width, MISSION_INFO.desc.height)
            .endFill();
        this.container.addChild(descMask);
        this.description.mask = descMask;

        // Greyed with nothing to abort or when the selected mission can't
        // be aborted (see refreshAbortState).
        this.abort = new Button(displayAssets, 'Abort',
            MISSION_INFO.button.width,
            { x: MISSION_INFO.button.abort, y: MISSION_INFO.button.y });
        this.abort.state = 'grey';
        this.abort.click.subscribe(() => void this.doAbort());
        const done = new Button(displayAssets, 'Done',
            MISSION_INFO.button.width,
            { x: MISSION_INFO.button.done, y: MISSION_INFO.button.y });
        done.click.subscribe(() => this.closed.next());
        this.container.addChild(this.abort.container, done.container);

        this.controls = new MenuControls(controlEvents, {
            up: () => this.moveSelection(-1),
            down: () => this.moveSelection(1),
            // 'i' toggles the dialog closed again; 'd'/Escape backs out.
            missions: () => this.closed.next(),
            depart: () => this.closed.next(),
        });
    }

    /**
     * Closes the dialog from outside (its display world is being torn
     * down mid-jump), releasing the MenuControls binding. No-op when
     * not shown.
     */
    dismiss() {
        if (this.container.visible) {
            this.closed.next();
        }
    }

    /**
     * Shows the dialog for a ship entity; resolves when dismissed.
     * Abort works through `abort`; without one the button stays greyed.
     */
    async show(entity: Entity, abort?: MissionInfoAbort): Promise<void> {
        this.entity = entity;
        this.abortAction = abort;
        this.identity = await playerIdentitySubs(this.universe,
            entity.components.get(ShipComponent)?.id, undefined,
            entity.components.get(ActiveRanksComponent));
        try {
            await this.universe.load();
        } catch (e) {
            console.warn('Mission info failed to load universe:', e);
        }
        this.missions = listedMissions(entity, this.universe);
        const date = entity.components.get(GameDateComponent);
        this.currentDay = date ? dayNumber(date) : 0;
        this.date.text = date ? formatMapDate(date) : '';
        this.selectedIndex = 0;

        this.refreshList();
        this.refreshDescription();

        this.container.visible = true;
        this.controls.bind();
        await firstValueFrom(this.closed);
        this.controls.unbind();
        this.container.visible = false;
    }

    /** The player's control bits: dësc conditionals and <DSY>/<RSY>. */
    private playerBits(): ReadonlySet<number> {
        return this.entity
            ?.components.get(ControlBitsComponent) ?? new Set<number>();
    }

    private descContext() {
        return makeDescTextContext(this.playerBits(), playerGender());
    }

    private missionName(id: string, active: ActiveMission): string {
        const offer = activeAsOffer(this.universe, active);
        if (!offer) {
            return id;
        }
        return expandMissionText(missionDisplayName(offer.data.name),
            {
                ...offerSubstitutions(this.universe, this.currentDay, offer,
                    this.playerBits(), active),
                ...this.identity,
            }, this.descContext());
    }

    private refreshList() {
        for (const text of this.rowTexts) {
            this.listContainer.removeChild(text);
            text.destroy();
        }
        this.rowTexts = [];
        for (const hit of this.rowHits) {
            this.listContainer.removeChild(hit);
            hit.destroy();
        }
        this.rowHits = [];
        this.highlight.clear();

        if (this.missions.length === 0) {
            // The original leaves the list pane empty and says so in the
            // description pane (STR# 2002 index 353), which
            // refreshDescription() does.
            return;
        }

        // A simple window keeps the selection visible.
        const start = Math.max(0, Math.min(
            this.selectedIndex - (MISSION_INFO.list.rows - 1),
            this.missions.length - MISSION_INFO.list.rows));
        const visible = this.missions.slice(
            start, start + MISSION_INFO.list.rows);
        visible.forEach(([id, active], i) => {
            const index = start + i;
            if (index === this.selectedIndex) {
                this.highlight.beginFill(SELECTION_COLOR)
                    .drawRect(MISSION_INFO.list.x,
                        listRowY(MISSION_INFO.list.y, i),
                        MISSION_INFO.list.width, ROW_HEIGHT)
                    .endFill();
            }
            // A full-width transparent hit target so the whole row —
            // everywhere the selection bar renders, not just the text —
            // is clickable (the trade center / mission BBS pattern).
            const hit = new PIXI.Container();
            hit.interactive = true;
            hit.cursor = 'pointer';
            hit.hitArea = new PIXI.Rectangle(
                0, i * ROW_HEIGHT, MISSION_INFO.list.width, ROW_HEIGHT);
            hit.on('pointerdown', () => {
                this.selectedIndex = index;
                this.refreshList();
                this.refreshDescription();
            });
            this.listContainer.addChild(hit);
            this.rowHits.push(hit);
            const text = new PIXI.Text(this.missionName(id, active),
                LIST_FONT);
            text.position.set(MISSION_INFO.listTextX,
                i * ROW_HEIGHT + ROW_TEXT_DY);
            this.listContainer.addChild(text);
            this.rowTexts.push(text);
        });
    }

    private refreshDescription() {
        this.refreshAbortState();
        const entry = this.missions[this.selectedIndex];
        if (!entry) {
            this.description.text = this.missions.length === 0
                ? NO_MISSIONS : '';
            return;
        }
        const [, active] = entry;
        const offer = activeAsOffer(this.universe, active);
        if (!offer) {
            this.description.text = active.id;
            return;
        }
        const mission = offer.data;
        const brief = mission.quickBrief || mission.briefText
            || mission.offerText;
        this.description.text = expandMissionText(brief,
            {
                ...offerSubstitutions(this.universe, this.currentDay, offer,
                    this.playerBits(), active),
                ...this.identity,
            }, this.descContext());
    }

    private refreshAbortState() {
        const entry = this.missions[this.selectedIndex];
        const canAbort = !!this.abortAction && !!entry
            && (this.universe.getMission(entry[0])?.canAbort ?? true);
        this.abort.state = canAbort ? 'normal' : 'grey';
    }

    /**
     * Aborts the selected mission: hands it to the abort action (an input
     * record) and drops it from the list at once — the display's mirror
     * of the player catches up when the simulation applies the record.
     */
    private async doAbort() {
        const entry = this.missions[this.selectedIndex];
        if (!entry || !this.abortAction || this.aborting) {
            return;
        }
        const [id] = entry;
        if (!(this.universe.getMission(id)?.canAbort ?? true)) {
            this.refreshAbortState();
            return;
        }
        this.aborting = true;
        let sent = false;
        try {
            sent = await this.abortAction(id);
        } catch (e) {
            console.warn(`Failed to abort mission ${id}:`, e);
        } finally {
            this.aborting = false;
        }
        if (sent) {
            this.missions = this.missions.filter(([mid]) => mid !== id);
            this.afterAbort();
        }
    }

    /** Re-selects within the shortened list and redraws. */
    private afterAbort() {
        this.selectedIndex = Math.min(this.selectedIndex,
            Math.max(0, this.missions.length - 1));
        this.refreshList();
        this.refreshDescription();
    }

    private moveSelection(delta: number) {
        if (this.missions.length === 0) {
            return;
        }
        this.selectedIndex = wrapIndex(this.selectedIndex, delta,
            this.missions.length);
        this.refreshList();
        this.refreshDescription();
    }
}
