import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Observable } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/controls_plugin.js';
import { dateFromDayNumber } from '../nova_plugin/calendar.js';
import {
    acceptOffer,
    MissionMapMark,
    missionMapMarks,
    MissionOffer,
} from '../nova_plugin/mission_logic.js';
import { expandMissionText, missionDisplayName } from '../nova_plugin/mission_text.js';
import { makeDescTextContext, playerGender } from '../nova_plugin/desc_text.js';
import { ActiveMission } from '../nova_plugin/player_state_plugin.js';
import { PlayerIdentitySubs, playerIdentitySubs } from './player_identity.js';
import { Button } from './button.js';
import { commitVenueCredits } from './credit_commit.js';
import { Menu } from './menu.js';
import {
    activeAsOffer, offerRollsForSystem, offerSubstitutions, rollOffers,
} from './mission_offers.js';
import { MissionSession } from './mission_session.js';
import { OpenStarmapOptions } from './starmap.js';
import { MissionUniverse } from './mission_universe.js';
import { formatMapDate } from './route.js';
import {
    BBS, LINE_HEIGHT, ROW_HEIGHT, ROW_TEXT_DY, SELECTION_COLOR, listRowY,
} from './dialog_layout.js';
import { wrapToSelectable } from './list_selection.js';

/**
 * The original's body font: Geneva 9, whose advance widths our outline
 * Geneva matches most closely a shade above 9px (see offer_popup.ts),
 * on the bitmap font's own 12px line pitch.
 */
const LIST_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 9.4, fill: 0xffffff,
    align: 'left', wordWrap: false, lineHeight: LINE_HEIGHT,
};
const LIST_FONT_DIM: Partial<PIXI.ITextStyle> =
    { ...LIST_FONT, fill: 0x888888 };
const LIST_FONT_HEADER: Partial<PIXI.ITextStyle> =
    { ...LIST_FONT, fill: 0xffff88 };
/** The strip captions are the original's light grey (#c0c0c0 sampled on
 * earth_mission_bbs.png), not white. */
const STRIP_FONT: Partial<PIXI.ITextStyle> =
    { ...LIST_FONT, fill: 0xc0c0c0 };
/** The date is dimmer still (#404040 on the same capture). */
const DATE_FONT: Partial<PIXI.ITextStyle> =
    { ...LIST_FONT, fill: 0x808080, align: 'right' };
/** The selected listing's name, in the upper right pane's large type. */
const TITLE_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: BBS.titleFontSize, fill: 0xffffff,
    align: 'left', wordWrap: false,
};
const DESC_FONT: Partial<PIXI.ITextStyle> = {
    ...LIST_FONT, wordWrap: true, wordWrapWidth: BBS.descWrapWidth,
};

/**
 * The board's own strings, stock Nova's wording verbatim: STR# 2002
 * ("misc strings") index 358 is the header caption and index 352 the
 * empty-board message. Read from the table at show() time; these are the
 * fallbacks for a data set whose STR# 2002 is missing or too short.
 */
export const BBS_HEADER = 'The following missions are available here:';
export const BBS_NO_MISSIONS = 'There are no missions available here.';
export const BBS_STRING_TABLE = 'nova:2002';
export const BBS_HEADER_INDEX = 358;
export const BBS_NO_MISSIONS_INDEX = 352;

type Row =
    | { kind: 'offer', offer: MissionOffer }
    | { kind: 'active', active: ActiveMission }
    | { kind: 'header', label: string };


/**
 * The mission BBS (and its bar-flavored sibling): the original's
 * list/detail dialog on the 510x201 PICT 8505 frame. The left pane
 * lists the day's offers (availability evaluated against the player's
 * REAL control bits) with active missions below them; the right pane
 * shows the expanded offer text. Accept uses the mïsn's custom button
 * label when present, and runs through the real NCB machinery. There
 * is no Refuse here — a listing the player doesn't want is simply not
 * accepted, and no Abort — aborting lives in the Mission Info dialog.
 *
 * The AvailRandom roll happens when the board opens (see
 * mission_offers.ts — player-local UI randomness).
 */
export class MissionBoard extends Menu<Entity> {
    private session?: MissionSession;
    /**
     * The balance the session's working credits were seeded from at show().
     * done() commits the DIFFERENCE from it (credit_commit.ts).
     */
    private creditsBaseline = 0;
    private offers: MissionOffer[] = [];
    /** <PN>/<PSN>-style identity values for this docked visit. */
    private identity: PlayerIdentitySubs = {};
    private rows: Row[] = [];
    private selectedIndex = 0;
    private rowTexts: PIXI.Text[] = [];
    /** Full-width transparent click targets, one per selectable row. */
    private rowHits: PIXI.Container[] = [];
    private listContainer = new PIXI.Container();
    private highlight = new PIXI.Graphics();
    private buttons: {
        accept: Button, done: Button,
    };

    private text = {
        /** The strip caption ("The following missions are available
         * here:"), not the dialog's own name. */
        header: new PIXI.Text('', STRIP_FONT),
        date: new PIXI.Text('', DATE_FONT),
        /** The selected listing's name, in the upper right pane. */
        title: new PIXI.Text('', TITLE_FONT),
        description: new PIXI.Text('', DESC_FONT),
        status: new PIXI.Text('', LIST_FONT),
    };
    /** The header caption / empty-board message, read from STR# 2002. */
    private strings = {
        header: BBS_HEADER,
        noMissions: BBS_NO_MISSIONS,
    };

    constructor(displayAssets: DisplayAssetDataInterface,
        simulationData: SimulationGameDataInterface,
        controlEvents: Observable<ControlEvent>,
        private universe: MissionUniverse,
        private planetId: string,
        /** LOCATION_MISSION_COMPUTER or LOCATION_BAR. */
        private location: number,
        background: string,
        title: string,
        /**
         * Opens the starmap over the board (the 'm' key), marking the
         * selected listing's destinations in green
         * (mission_bbs/notes.txt). Optional: without it, 'm' does nothing.
         */
        private openStarmap?: (options?: OpenStarmapOptions)
            => Promise<unknown>) {
        super(displayAssets, simulationData, background, controlEvents);
        this.container.name = `MissionBoard-${title}`;

        // No Refuse on the BBS: an uninteresting listing is simply not
        // accepted. (Bar mission POPUPS keep their accept/refuse
        // choice — that's a different surface; see bar.ts.) No Abort
        // either — the original's row is just Accept / Leave, adjacent
        // and right-of-center (mission_bbs/earth_mission_bbs.png:
        // Accept pill at x975, Leave at x1078); aborting lives in the
        // Mission Info dialog ('i').
        this.buttons = {
            accept: new Button(displayAssets, 'Accept', BBS.button.width,
                { x: BBS.button.accept, y: BBS.button.y }),
            done: new Button(displayAssets, 'Leave', BBS.button.width,
                { x: BBS.button.leave, y: BBS.button.y }),
        };
        this.buttons.accept.click.subscribe(this.accept.bind(this));
        this.buttons.done.click.subscribe(this.done.bind(this));
        this.addButtons(this.buttons);

        this.text.header.position.set(BBS.headerText.x, BBS.headerText.y);
        this.text.date.anchor.x = 1;
        this.text.date.position.set(BBS.dateRight, BBS.headerText.y);
        this.text.title.position.set(BBS.titleText.x, BBS.titleText.y);
        this.listContainer.position.set(BBS.list.x, BBS.list.y);
        this.text.description.position.set(
            BBS.descText.x, BBS.descText.y);
        this.text.status.position.set(
            BBS.statusText.x, BBS.statusText.y);
        this.container.addChild(this.highlight, this.text.header,
            this.text.date, this.text.title, this.listContainer,
            this.text.description, this.text.status);

        // Clip the list, the name pane and the description to their panes.
        const listMask = new PIXI.Graphics()
            .beginFill(0xffffff)
            .drawRect(BBS.list.x, BBS.list.y, BBS.list.width,
                BBS.list.height)
            .endFill();
        this.container.addChild(listMask);
        this.listContainer.mask = listMask;
        const titleMask = new PIXI.Graphics()
            .beginFill(0xffffff)
            .drawRect(BBS.titlePane.x, BBS.titlePane.y,
                BBS.titlePane.width, BBS.titlePane.height)
            .endFill();
        this.container.addChild(titleMask);
        this.text.title.mask = titleMask;
        const descMask = new PIXI.Graphics()
            .beginFill(0xffffff)
            .drawRect(BBS.desc.x, BBS.desc.y, BBS.desc.width,
                BBS.desc.height)
            .endFill();
        this.container.addChild(descMask);
        this.text.description.mask = descMask;

        this.controls.controls = {
            up: () => this.moveSelection(-1),
            down: () => this.moveSelection(1),
            accept: this.accept.bind(this),
            // The map over the BBS shows the selected listing's
            // destinations in green (the starmap binds its own controls
            // on top of the focus stack while open).
            map: () => void this.openMap(),
            depart: this.done.bind(this),
        };
    }

    /**
     * The green viewed-mission marks for the selected listing: its travel
     * and return destinations' systems (mission_bbs/notes.txt). Missions to
     * systems the player hasn't explored still get marks.
     */
    private viewedMarks(): MissionMapMark[] {
        const row = this.rows[this.selectedIndex];
        if (!row || row.kind === 'header') {
            return [];
        }
        const missionId = row.kind === 'offer'
            ? row.offer.data.id : row.active.id;
        const planets = row.kind === 'offer'
            ? [row.offer.travelPlanet, row.offer.returnPlanet]
            : [row.active.travelPlanet, row.active.returnPlanet];
        const marks: MissionMapMark[] = [];
        const seen = new Set<string>();
        for (const planet of planets) {
            const systemId = planet
                ? this.universe.systemIdOfPlanet(planet,
                    this.session?.state.bits) : undefined;
            if (!systemId || seen.has(systemId)) {
                continue;
            }
            seen.add(systemId);
            marks.push({ systemId, kind: 'destination', missionId });
        }
        return marks;
    }

    private async openMap() {
        if (!this.openStarmap) {
            return;
        }
        // The docked entity is out of the display world, so the active
        // missions' orange marks ride along with the green viewed ones.
        const active = this.session
            ? missionMapMarks(this.session.state.missions.values(),
                id => this.universe.getMission(id),
                planetId => this.universe.systemIdOfPlanet(planetId,
                    this.session?.state.bits))
            : [];
        await this.openStarmap({
            viewedMarks: this.viewedMarks(),
            missionMarks: active,
            date: this.session
                ? dateFromDayNumber(this.session.currentDay) : undefined,
        });
    }

    override async show(input: Entity): Promise<Entity> {
        try {
            this.session = await MissionSession.create(input,
                this.simulationData, this.universe, this.planetId);
            this.identity = await playerIdentitySubs(this.universe,
                this.session.shipId, undefined, this.session.state.ranks);
        } catch (e) {
            // Data failed to load; don't wedge the spaceport.
            console.warn('Mission board failed to load:', e);
            return input;
        }
        // The balance the session's working copy was seeded from: done()
        // commits the difference from THIS, not the absolute, so a
        // concurrent writer survives the commit (credit_commit.ts).
        this.creditsBaseline = this.session.state.credits.credits;
        await this.loadStrings();
        // The system visit's rolls (mission_offers.ts OfferRolls): closing
        // and reopening the board does not reroll a 10% mission.
        this.offers = rollOffers(this.session, this.universe,
            this.location, offerRollsForSystem(this.universe.systemIdOfPlanet(
                this.planetId, this.session.state.bits)));
        this.buildRows();
        this.selectedIndex = this.rows.findIndex(
            row => row.kind !== 'header');
        this.text.status.text = '';
        this.refreshHeader();
        this.refreshList();
        this.refreshDescription();
        return super.show(input);
    }

    /**
     * Reads the board's two fixed strings out of STR# 2002, keeping the
     * constants above as the fallback (the hire dialog's pattern).
     */
    private async loadStrings() {
        try {
            const table = await this.displayAssets.data.StringTable
                .get(BBS_STRING_TABLE);
            const header = table.strings[BBS_HEADER_INDEX];
            const empty = table.strings[BBS_NO_MISSIONS_INDEX];
            if (header?.trim()) {
                this.strings.header = header;
            }
            if (empty?.trim()) {
                this.strings.noMissions = empty;
            }
        } catch {
            // Keep the built-in wording.
        }
    }

    /** Rebuilds the row list from the frozen offers + active missions. */
    private buildRows() {
        const session = this.session!;
        // An offer may have become active (accepted) meanwhile.
        this.offers = this.offers.filter(
            offer => !session.state.missions.has(offer.data.id));
        this.rows = this.offers.map(
            offer => ({ kind: 'offer', offer } as Row));
        // Active missions are NOT listed here (Matthew, 2026-08-14): the
        // original's BBS shows only what's on offer; already-accepted
        // missions live in the mission-info dialog ('i'). The 'active'
        // row kind stays supported for that dialog's shared row plumbing.
        if (this.rows.length === 0) {
            this.rows.push({ kind: 'header',
                label: this.strings.noMissions });
        }
    }

    /**
     * The header strip: a fixed caption on the left and the date on the
     * right. The original shows NO credit balance here — the strip on
     * earth_mission_bbs.png carries only "Nov. 18th, 1177 NC" — and the
     * date is in the map's galactic-calendar shape, not calendar.ts's.
     */
    private refreshHeader() {
        const session = this.session!;
        this.text.header.text = this.strings.header;
        this.text.date.text =
            formatMapDate(dateFromDayNumber(session.currentDay));
    }

    /**
     * A row's caption — the mission's name with the same <DST>-style
     * wildcards the descriptions carry. Shared by the list and the
     * upper right pane, which shows the selected row's caption verbatim.
     */
    private rowLabel(row: Row): string {
        if (row.kind === 'header') {
            return row.label;
        }
        if (row.kind === 'offer') {
            return expandMissionText(
                missionDisplayName(row.offer.data.name),
                this.substitutionsFor(row.offer), this.descContext());
        }
        const offer = activeAsOffer(this.universe, row.active);
        return offer
            ? expandMissionText(missionDisplayName(offer.data.name),
                this.substitutionsFor(offer, row.active),
                this.descContext())
            : row.active.id;
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

        // A simple window keeps the selection visible.
        const start = Math.max(0, Math.min(
            this.selectedIndex - (BBS.list.rows - 2),
            this.rows.length - BBS.list.rows));
        const visible = this.rows.slice(start, start + BBS.list.rows);
        visible.forEach((row, i) => {
            const index = start + i;
            const label = this.rowLabel(row);
            let style: Partial<PIXI.ITextStyle> = LIST_FONT;
            if (row.kind === 'offer' && !row.offer.acceptable) {
                style = LIST_FONT_DIM;
            } else if (row.kind === 'header') {
                style = LIST_FONT_HEADER;
            }
            if (index === this.selectedIndex && row.kind !== 'header') {
                // The original's full-width selection bar.
                this.highlight.beginFill(SELECTION_COLOR)
                    .drawRect(BBS.list.x, listRowY(BBS.list.y, i),
                        BBS.list.width, ROW_HEIGHT)
                    .endFill();
            }
            if (row.kind !== 'header') {
                // A full-width transparent hit target so the whole row —
                // everywhere the selection bar renders, not just the text —
                // is clickable. Matches the highlight's bounds in
                // listContainer-local coordinates.
                const hit = new PIXI.Container();
                hit.interactive = true;
                hit.cursor = 'pointer';
                hit.hitArea = new PIXI.Rectangle(
                    0, i * ROW_HEIGHT, BBS.list.width, ROW_HEIGHT);
                hit.on('pointerdown', () => {
                    this.selectedIndex = index;
                    this.refreshList();
                    this.refreshDescription();
                });
                this.listContainer.addChild(hit);
                this.rowHits.push(hit);
            }
            const text = new PIXI.Text(label, style);
            text.position.set(BBS.listTextX,
                i * ROW_HEIGHT + ROW_TEXT_DY);
            this.listContainer.addChild(text);
            this.rowTexts.push(text);
        });
    }

    private selectedRow(): Row | undefined {
        return this.rows[this.selectedIndex];
    }

    private moveSelection(delta: number) {
        if (this.rows.length === 0) {
            return;
        }
        // Wraps at either end, skipping the section headers.
        const index = wrapToSelectable(this.selectedIndex, delta,
            this.rows.length, i => this.rows[i]?.kind !== 'header');
        if (this.rows[index]?.kind !== 'header') {
            this.selectedIndex = index;
        }
        this.refreshList();
        this.refreshDescription();
    }

    private substitutionsFor(offer: MissionOffer,
        active?: ActiveMission) {
        return {
            ...offerSubstitutions(this.universe, this.session!.currentDay,
                offer, active),
            ...this.identity,
        };
    }

    /** The real NCB context this board's dësc text renders against. */
    private descContext() {
        return makeDescTextContext(this.session!.state.bits, playerGender());
    }

    /**
     * The right side: the selected listing's NAME in the upper pane's
     * large type (the original repeats the list caption there — see
     * mission_bbs/un_shipping_mission.png) and its expanded text below.
     * There is no pay/deadline line: the original's offer text carries
     * both in prose.
     */
    private refreshDescription() {
        const row = this.selectedRow();
        this.buttons.accept.setLabel('Accept');
        if (!row || row.kind === 'header') {
            this.text.title.text = '';
            this.text.description.text = '';
            this.buttons.accept.state = 'grey';
            return;
        }
        this.text.title.text = this.rowLabel(row);
        if (row.kind === 'offer') {
            const { offer } = row;
            const subs = this.substitutionsFor(offer);
            const text = expandMissionText(offer.data.offerText, subs,
                this.descContext());
            const extra = offer.acceptable ? '' : `\n\n[${offer.reason}]`;
            this.text.description.text = text + extra;
            // The mïsn's custom accept label, where present.
            if (offer.data.acceptButton) {
                this.buttons.accept.setLabel(offer.data.acceptButton);
            }
            this.buttons.accept.state =
                offer.acceptable ? 'normal' : 'grey';
        } else {
            const offer = activeAsOffer(this.universe, row.active);
            if (!offer) {
                this.text.description.text = row.active.id;
                return;
            }
            const mission = offer.data;
            const brief = mission.quickBrief || mission.briefText
                || mission.offerText;
            this.text.description.text = expandMissionText(brief,
                this.substitutionsFor(offer, row.active), this.descContext())
                + (mission.canAbort ? '' : '\n\n[This mission cannot be aborted.]');
            this.buttons.accept.state = 'grey';
        }
    }

    private accept() {
        const row = this.selectedRow();
        if (!row || row.kind !== 'offer' || !this.session) {
            return;
        }
        if (!row.offer.acceptable) {
            this.text.status.text = row.offer.reason ?? 'Cannot accept.';
            return;
        }
        // The offer's acceptable flag was frozen at board-open; the accept
        // re-checks cargo fit + the mission cap against current state and
        // may still refuse (e.g. another accepted mission filled the hold).
        const result = acceptOffer(this.session.machinery, row.offer,
            this.session.outfits);
        if (!result.accepted) {
            this.text.status.text = result.reason;
            return;
        }
        // Substitutions built AFTER the accept, against the now-active
        // mission: the briefing is where <SN> lives (the special ship
        // name is only picked at accept), so a pre-accept table would
        // show the unresolved fallback.
        const subs = this.substitutionsFor(row.offer,
            this.session.state.missions.get(row.offer.data.id));
        const ctx = this.descContext();
        const brief = expandMissionText(row.offer.data.briefText, subs, ctx);
        // Mission names carry the same <DST>-style wildcards as the
        // descriptions; expand them in the status line too.
        this.text.status.text = `Accepted: ${expandMissionText(
            missionDisplayName(row.offer.data.name), subs, ctx)}.`;
        this.buildRows();
        this.selectedIndex = Math.min(this.selectedIndex,
            this.rows.length - 1);
        this.refreshHeader();
        this.refreshList();
        this.refreshDescription();
        if (brief) {
            this.text.description.text = brief;
        }
    }

    protected override done() {
        const session = this.session;
        if (session) {
            this.creditsBaseline = commitVenueCredits(
                this.input, this.creditsBaseline, () => session.commit());
        }
        super.done();
    }
}
