import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Observable } from 'rxjs';
import { DockedLiveStatus } from '../display/docked_ship.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/core/controls_plugin.js';
import { makeDescTextContext, playerGender, resolveConditionalBlocks }
    from '../nova_plugin/ncb/desc_text.js';
import { LOCATION_BAR } from '../nova_plugin/missions/mission_logic.js';
import { Button } from './button.js';
import { BAR, LINE_HEIGHT } from './dialog_layout.js';
import { FleetEscortEntry } from './fleet_cargo.js';
import { GambleDialog } from './gamble.js';
import { HireEscortDialog, noShipsForHire } from './hire_escort.js';
import { LandedTransaction, Savepoint } from './landed_transaction.js';
import { Menu } from './menu.js';
import { MenuControls } from './menu_controls.js';
import { OfferPopup, presentOffers } from './offer_popup.js';
import { offerRollsForSystem, rollOffers } from './mission_offers.js';
import { MissionSession } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';
import { NewsDialog } from './news_dialog.js';

// The 263x185 Bar dialog (PICT 8503). Geometry lives in
// dialog_layout.ts, measured against bar/bar_earth.png and
// bar/bar_port_kane.png (1920x1080).
const DESC_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 9.4, fill: 0xffffff,
    align: 'left', wordWrap: true, wordWrapWidth: BAR.wrapWidth,
    lineHeight: LINE_HEIGHT,
};

const FALLBACK_DESC = 'The bar is quiet tonight. A tired bartender '
    + 'polishes glasses and keeps one eye on the door.';

/**
 * The spaceport bar (spöb flag 0x40): on entry any bar mission offers
 * (availLoc 1) approach the player one at a time as popup dialogs,
 * and then the bar itself — its dësc 10000-range description and the
 * Hire Escort / Gamble / Holovid / Leave buttons. The news does NOT
 * open automatically; the Holovid button (or the 'n' key) shows it.
 *
 * All money movement (gambling, hire fees, mission Sxxx/payment
 * effects) happens in the landing's ONE working copy — the transaction
 * (landed_transaction.ts) — under this visit's savepoint, released when
 * the player leaves the bar. The gamble and hire dialogs are handed the
 * transaction's own credits object and hire list, so a fee and a bet come
 * off the same balance the outfitter next door spends from.
 *
 * The Holovid's QuickTime short ("Race N.mov") is unplayable in the
 * browser (documented gap), so its button shows the news feed the
 * original played alongside it.
 */
export class Bar extends Menu<Entity> {
    /**
     * The landing's transaction, attached by the Spaceport; a standalone
     * show() opens one of its own and releases it at Leave.
     */
    transaction?: LandedTransaction;
    private visit?: Savepoint;
    private ownsTransaction = false;
    private get session(): MissionSession | undefined {
        return this.transaction?.session;
    }
    /**
     * The client's landed-escort roster, the display world the docked
     * ship came out of, and the docked ship's uuid, set per-landing by
     * the Spaceport (as for the trade center), so the hire dialog can
     * count the fleet against MAX_ESCORTS — escorts still flying down
     * are in the world, the ones that have touched down are on the
     * roster (escort_cap.ts's cappedEscortCount).
     */
    private landedEscorts?: () => readonly FleetEscortEntry[];
    private world?: Iterable<[string, Entity]>;
    private playerUuid?: string;
    private description = new PIXI.Text('', DESC_FONT);
    private news: NewsDialog;
    private gamble: GambleDialog;
    private hireEscort: HireEscortDialog;
    private offerPopup: OfferPopup;
    /** Holds keyboard focus while the pointer-only offer popups show. */
    private popupBlocker: MenuControls;
    private buttons: {
        hireEscort: Button, gamble: Button, holovid: Button, leave: Button,
    };
    /** Holds the "Bar + pict" frame (8504) + the bar dësc's picture,
     * shown behind the text/buttons only when the stellar's bar has a
     * graphic (a plug-in feature; the stock scenario has none). */
    private barPictLayer = new PIXI.Container();

    constructor(displayAssets: DisplayAssetDataInterface,
        simulationData: SimulationGameDataInterface,
        controlEvents: Observable<ControlEvent>,
        private universe: MissionUniverse,
        private planetId: string) {
        super(displayAssets, simulationData, 'nova:8503', controlEvents);
        this.container.name = 'Bar';

        // Behind the buttons/description (added below), above the 8503
        // background: the opaque 8504 frame covers it when populated.
        this.container.addChild(this.barPictLayer);

        // The original's grid is asymmetric: the left column's pills are
        // wider than the right's (see BAR.button in dialog_layout.ts).
        const { columns, widths, rows } = BAR.button;
        this.buttons = {
            hireEscort: new Button(displayAssets, 'Hire Escort',
                widths[0], { x: columns[0], y: rows[0] }),
            gamble: new Button(displayAssets, 'Gamble',
                widths[1], { x: columns[1], y: rows[0] }),
            holovid: new Button(displayAssets, 'Holovid',
                widths[0], { x: columns[0], y: rows[1] }),
            leave: new Button(displayAssets, 'Leave',
                widths[1], { x: columns[1], y: rows[1] }),
        };
        this.buttons.hireEscort.click.subscribe(
            () => void this.showHireEscort());
        this.buttons.gamble.click.subscribe(() => void this.showGamble());
        // The Holovid's movie is unplayable in the browser; the button
        // opens the news feed instead (see class doc).
        this.buttons.holovid.click.subscribe(() => void this.showNews());
        this.buttons.leave.click.subscribe(this.done.bind(this));
        this.addButtons(this.buttons);

        this.description.position.set(BAR.text.x, BAR.text.y);
        this.container.addChild(this.description);

        this.news = new NewsDialog(displayAssets, simulationData,
            controlEvents, universe, planetId);
        this.gamble = new GambleDialog(displayAssets, controlEvents);
        this.hireEscort = new HireEscortDialog(displayAssets,
            simulationData, controlEvents, planetId);
        this.offerPopup = new OfferPopup(displayAssets, controlEvents);
        this.popupBlocker = new MenuControls(controlEvents);
        this.container.addChild(this.hireEscort.container,
            this.gamble.container, this.news.container,
            this.offerPopup.container);

        this.controls.controls = {
            hire: () => void this.showHireEscort(),
            news: () => void this.showNews(),
            gamble: () => void this.showGamble(),
            depart: this.done.bind(this),
        };
    }

    /** See the landedEscorts field. */
    setLandedEscorts(roster?: () => readonly FleetEscortEntry[],
        playerUuid?: string, world?: Iterable<[string, Entity]>) {
        this.landedEscorts = roster;
        this.playerUuid = playerUuid;
        this.world = world;
    }

    override async show(input: Entity): Promise<Entity> {
        try {
            if (!this.transaction) {
                this.transaction = await LandedTransaction.open(input,
                    this.simulationData, this.universe, this.planetId);
                this.ownsTransaction = true;
            } else {
                await this.transaction.refresh();
            }
        } catch (e) {
            console.warn('Bar failed to load:', e);
            return input;
        }
        if (!this.alive) {
            return input; // Torn down while opening; nothing edited yet.
        }
        const session = this.transaction.session;
        this.visit = this.transaction.savepoint('bar');
        try {
            const planet = await this.simulationData.data.Planet
                .get(this.planetId);
            this.description.text = resolveConditionalBlocks(
                planet.barDesc || FALLBACK_DESC,
                makeDescTextContext(session.state.bits, playerGender()));
            this.setBarPict(planet.barPict);
        } catch {
            this.description.text = FALLBACK_DESC;
            this.setBarPict(null);
        }

        const result = super.show(input);
        // Bar mission offers approach the player on entry, then the
        // bar itself. (The news no longer auto-opens; the Holovid
        // button or the 'n' key shows it.) The blocker keeps the bar's
        // own keys — and the global map key — quiet while the
        // pointer-driven offer popups are up.
        this.controls.unbind();
        this.popupBlocker.bind();
        try {
            await this.presentBarOffers();
        } catch (e) {
            console.warn('Bar entry sequence failed:', e);
        }
        this.popupBlocker.unbind();
        this.rebindControls();
        return result;
    }

    /**
     * Takes the bar's keys back after the offer popups or a sub-dialog
     * (news/gamble/hire) — but only while the bar is still on screen.
     * Leave (Menu.done) hides the bar and unbinds its keys the moment it
     * fires; a sequence still running then used to rebind them
     * unconditionally on its way out, leaving a departed bar as
     * MenuControls.focused for the rest of the session — the spaceport's
     * rebindControls() guard (#28), mirrored here as the issue asked.
     */
    private rebindControls() {
        if (this.container.visible) {
            this.controls.bind();
        }
    }

    /**
     * Swaps the bar to the "Bar + pict" frame (PICT 8504) with the bar
     * dësc's picture in its upper area when the stellar defines one,
     * otherwise leaves the plain 8503 bar. The stock scenario has no bar
     * graphics, so this only lights up for plug-in content.
     */
    private setBarPict(pictId: string | null) {
        this.barPictLayer.removeChildren();
        if (!pictId) {
            this.barPictLayer.visible = false;
            return;
        }
        this.barPictLayer.visible = true;
        // The 8504 frame (266x306) is taller than the plain bar and
        // opaque, so it covers the 8503 background when centered.
        const frame = this.displayAssets.spriteFromPict('nova:8504');
        frame.anchor.set(0.5);
        this.barPictLayer.addChild(frame);
        // The picture sits in the frame's upper area, above the
        // description text.
        const image = this.displayAssets.spriteFromPict(pictId);
        image.anchor.set(0.5);
        image.position.set(0, -100);
        const fit = () => {
            if (!image.texture.valid) {
                return;
            }
            const scale = Math.min(1, 250 / image.texture.width,
                104 / image.texture.height);
            image.scale.set(scale);
        };
        fit();
        image.texture.baseTexture.once('loaded', fit);
        this.barPictLayer.addChild(image);
    }

    private async showNews() {
        if (!this.input) {
            return;
        }
        this.controls.unbind();
        await this.news.show(this.input);
        this.rebindControls();
    }

    /** Bar mission offers (availLoc 1), one popup at a time. */
    private async presentBarOffers() {
        const session = this.session!;
        // The system visit's rolls (mission_offers.ts OfferRolls): walking
        // out and back in does not reroll a 40% mission.
        const offers = rollOffers(session, this.universe, LOCATION_BAR,
            offerRollsForSystem(this.universe.systemIdOfPlanet(
                this.planetId, session.state.bits)))
            .filter(offer => offer.acceptable);
        await presentOffers(this.offerPopup, session, this.universe, offers);
    }

    private async showGamble() {
        const transaction = this.transaction;
        if (!transaction) {
            return;
        }
        this.controls.unbind();
        // Bets settle straight into the landing's ledger.
        await this.gamble.show(transaction.credits);
        this.rebindControls();
    }

    private async showHireEscort() {
        const transaction = this.transaction;
        if (!transaction) {
            return;
        }
        this.controls.unbind();
        const result =
            await this.hireEscort.show(transaction.credits,
                transaction.hired,
                // The landing's working control bits (a mission accepted
                // this visit already counts) plus the landed entity, which
                // is where the hire pool reads the player's outfits, ranks
                // and the game date from — and the world and landed
                // roster, for the escort cap (HirePlayer's doc).
                {
                    entity: this.input, bits: transaction.state.bits,
                    world: this.world,
                    landedEscorts: this.landedEscorts,
                    playerUuid: this.playerUuid,
                });
        if (result === 'empty') {
            // No pilots today: the original says so in a plain popup rather
            // than opening an empty shipyard grid (STR# 2002 index 223 —
            // see NO_SHIPS_FOR_HIRE).
            await this.offerPopup.show(
                await noShipsForHire(this.displayAssets), { accept: 'OK' },
                { style: 'briefing' });
        }
        this.rebindControls();
    }

    /**
     * The live working credit balance for the docked status bar: gambling and
     * hire fees settle into the landing's working credits, so the Credits
     * readout follows them before Leave releases the visit.
     */
    dockedStatus(): DockedLiveStatus {
        return { credits: this.transaction?.credits.credits };
    }

    /**
     * Leave: the visit's edits become the landing's. The release writes
     * the entity (the outermost visit's does) — the session's state, the
     * credits as a delta, and this landing's hires moved onto
     * PendingEscortsComponent in the one step that empties the list, so
     * the escort cap (which counts both) can never see a hire twice
     * (pending_escorts.ts).
     */
    protected override done() {
        if (this.transaction && this.visit) {
            this.transaction.release(this.visit);
        }
        this.visit = undefined;
        if (this.ownsTransaction) {
            this.transaction = undefined;
            this.ownsTransaction = false;
        }
        super.done();
    }
}
