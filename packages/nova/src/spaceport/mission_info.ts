import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { dayNumber } from '../nova_plugin/calendar.js';
import { ControlEvent } from '../nova_plugin/controls_plugin.js';
import { abortMission } from '../nova_plugin/mission_logic.js';
import { expandMissionText, missionDisplayName } from '../nova_plugin/mission_text.js';
import { makeDescTextContext, playerGender } from '../nova_plugin/desc_text.js';
import { PlayerIdentitySubs, playerIdentitySubs } from './player_identity.js';
import {
    ActiveRanksComponent, ControlBitsComponent,
} from '../nova_plugin/ncb_plugin.js';
import { ShipComponent } from '../nova_plugin/ship_plugin.js';
import { ActiveMission, GameDateComponent, MissionsComponent } from '../nova_plugin/player_state_plugin.js';
import { Button } from './button.js';
import { LandedTransaction } from './landed_transaction.js';
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
 * Docked context that makes the Abort button functional: aborting runs
 * on the landing's working copy — the transaction the spaceport opened
 * (landed_transaction.ts) — which is only sound while docked. In flight
 * the button stays greyed — an in-flight abort would need an
 * input-record path of its own.
 *
 * `transaction` is the landing's; without one (a caller with no landing
 * in progress) the abort opens a transaction of its own over the entity
 * and releases it at once.
 */
export interface MissionInfoAbortContext {
    gameData: SimulationGameDataInterface;
    planetId: string;
    transaction?: LandedTransaction;
}

// The Mission Info dialog on the 471x155 PICT 8517 frame: a left list of
// the player's active missions, a right pane with the selected mission's
// briefing text, a date strip of its own in the upper right, and
// Abort / Done along the bottom. The geometry lives in dialog_layout.ts,
// measured against missions/missions_info.png (1920x1080).
const HEADER_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 9.4, fill: 0xc0c0c0, align: 'left',
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

/** Stock Nova's own wording: STR# 2002 index 359 / 353. */
const HEADER_TEXT = 'Currently active missions:';
const NO_MISSIONS = 'You have no active missions.';

/**
 * The Mission Info dialog ('i'): lists the player's active missions and
 * shows the selected one's briefing text and the current date, on the
 * 8517 frame. Opens in flight and while docked, as a modal overlay on
 * the same focus stack as the starmap / player-info dialogs. Read-only:
 * the Abort button is functional while DOCKED (an abort context routes
 * it through a MissionSession over the held entity) and greyed in
 * flight, where an abort would bypass the deterministic mission
 * machinery.
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
    private abortContext?: MissionInfoAbortContext;
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

        // Functional while docked (see class doc); greyed in flight or
        // when the selected mission can't be aborted.
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
     * Shows the dialog for a ship entity; resolves when dismissed.
     * Passing an abort context (docked only) enables the Abort button.
     */
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

    async show(entity: Entity,
        abortContext?: MissionInfoAbortContext): Promise<void> {
        this.entity = entity;
        this.abortContext = abortContext;
        this.identity = await playerIdentitySubs(this.universe,
            entity.components.get(ShipComponent)?.id, undefined,
            entity.components.get(ActiveRanksComponent));
        try {
            await this.universe.load();
        } catch (e) {
            console.warn('Mission info failed to load universe:', e);
        }
        const missions = entity.components.get(MissionsComponent);
        // Hide invisible missions (mïsn Flags "invisible": never listed).
        this.missions = missions
            ? [...missions].filter(([id]) =>
                !this.universe.getMission(id)?.flags.invisible)
            : [];
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

    private descContext() {
        const bits = this.entity
            ?.components.get(ControlBitsComponent) ?? new Set<number>();
        return makeDescTextContext(bits, playerGender());
    }

    private missionName(id: string, active: ActiveMission): string {
        const offer = activeAsOffer(this.universe, active);
        if (!offer) {
            return id;
        }
        return expandMissionText(missionDisplayName(offer.data.name),
            {
                ...offerSubstitutions(this.universe, this.currentDay, offer,
                    active),
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
                    active),
                ...this.identity,
            }, this.descContext());
    }

    private refreshAbortState() {
        const entry = this.missions[this.selectedIndex];
        const canAbort = !!this.abortContext && !!entry
            && (this.universe.getMission(entry[0])?.canAbort ?? true);
        this.abort.state = canAbort ? 'normal' : 'grey';
    }

    /**
     * Aborts the selected mission (docked only): runs OnAbort, drops
     * mission cargo and removes the mission on the landing's working copy
     * under a savepoint released at once (so it is on the entity when
     * this returns), then re-reads the entity's mission list.
     */
    private async doAbort() {
        const entry = this.missions[this.selectedIndex];
        if (!entry || !this.entity || !this.abortContext || this.aborting) {
            return;
        }
        const [id] = entry;
        if (!(this.universe.getMission(id)?.canAbort ?? true)) {
            this.refreshAbortState();
            return;
        }
        this.aborting = true;
        try {
            const transaction = this.abortContext.transaction
                ?? await LandedTransaction.open(this.entity,
                    this.abortContext.gameData, this.universe,
                    this.abortContext.planetId);
            const visit = transaction.savepoint('abort');
            try {
                abortMission(transaction.session.machinery, id,
                    transaction.outfits);
            } finally {
                transaction.release(visit);
            }
        } finally {
            this.aborting = false;
        }
        const missions = this.entity.components.get(MissionsComponent);
        this.missions = missions
            ? [...missions].filter(([mid]) =>
                !this.universe.getMission(mid)?.flags.invisible)
            : [];
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
