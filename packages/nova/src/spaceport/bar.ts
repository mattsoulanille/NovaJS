import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Observable } from 'rxjs';
import { DockedLiveStatus } from '../display/docked_ship.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/controls_plugin.js';
import { makeDescTextContext, playerGender, resolveConditionalBlocks }
    from '../nova_plugin/desc_text.js';
import { LOCATION_BAR } from '../nova_plugin/mission_logic.js';
import { Button } from './button.js';
import { commitVenueCredits } from './credit_commit.js';
import { BAR, LINE_HEIGHT } from './dialog_layout.js';
import { FleetEscortEntry } from './fleet_cargo.js';
import { GambleDialog } from './gamble.js';
import { HireEscortDialog, noShipsForHire } from './hire_escort.js';
import { Menu } from './menu.js';
import { MenuControls } from './menu_controls.js';
import { OfferPopup, presentOffers } from './offer_popup.js';
import { rollOffers } from './mission_offers.js';
import { MissionSession } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';
import { NewsDialog } from './news_dialog.js';
import { commitPendingEscorts } from './pending_escorts.js';

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
 * effects) happens in one MissionSession working copy, committed when
 * the player leaves the bar — the outfitter pattern.
 *
 * The Holovid's QuickTime short ("Race N.mov") is unplayable in the
 * browser (documented gap), so its button shows the news feed the
 * original played alongside it.
 */
export class Bar extends Menu<Entity> {
    private session?: MissionSession;
    /**
     * The balance the session's working credits were seeded from at show().
     * done() commits the DIFFERENCE from it (credit_commit.ts).
     */
    private creditsBaseline = 0;
    private hired: string[] = [];
    /**
     * The client's landed-escort roster and the docked ship's uuid, set
     * per-landing by the Spaceport (as for the trade center), so the
     * hire dialog can count the fleet against MAX_ESCORTS.
     */
    private landedEscorts?: () => readonly FleetEscortEntry[];
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
        playerUuid?: string) {
        this.landedEscorts = roster;
        this.playerUuid = playerUuid;
    }

    override async show(input: Entity): Promise<Entity> {
        try {
            this.session = await MissionSession.create(input,
                this.simulationData, this.universe, this.planetId);
        } catch (e) {
            console.warn('Bar failed to load:', e);
            return input;
        }
        // The balance the session's working copy was seeded from: done()
        // commits the difference from THIS rather than the absolute, so a
        // concurrent writer (an escort deal settling mid-visit, the refuel
        // button) survives the commit. See credit_commit.ts.
        this.creditsBaseline = this.session.state.credits.credits;
        this.hired = [];
        try {
            const planet = await this.simulationData.data.Planet
                .get(this.planetId);
            this.description.text = resolveConditionalBlocks(
                planet.barDesc || FALLBACK_DESC,
                makeDescTextContext(this.session.state.bits,
                    playerGender()));
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
        this.controls.bind();
        return result;
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
        this.controls.bind();
    }

    /** Bar mission offers (availLoc 1), one popup at a time. */
    private async presentBarOffers() {
        const session = this.session!;
        const offers = rollOffers(session, this.universe, LOCATION_BAR)
            .filter(offer => offer.acceptable);
        await presentOffers(this.offerPopup, session, this.universe, offers);
    }

    private async showGamble() {
        if (!this.session) {
            return;
        }
        this.controls.unbind();
        await this.gamble.show(this.session.state.credits);
        this.controls.bind();
    }

    private async showHireEscort() {
        if (!this.session) {
            return;
        }
        this.controls.unbind();
        const result =
            await this.hireEscort.show(this.session.state.credits,
                this.hired,
                // The bar's working control bits (a mission accepted this
                // visit already counts) plus the landed entity, which is
                // where the hire pool reads the player's outfits, ranks
                // and the game date from — and the landed roster, for
                // the escort cap (hire_escort.ts's escortCount).
                {
                    entity: this.input, bits: this.session.state.bits,
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
        this.controls.bind();
    }

    /**
     * The live working credit balance for the docked status bar: gambling and
     * hire fees settle into the bar session's working credits, so the Credits
     * readout follows them before Leave commits the session.
     */
    dockedStatus(): DockedLiveStatus {
        return { credits: this.session?.state.credits.credits };
    }

    protected override done() {
        const session = this.session;
        if (session) {
            this.creditsBaseline = commitVenueCredits(
                this.input, this.creditsBaseline, () => session.commit());
        }
        // Appends this visit's hires to the entity and empties the list
        // in one step, so the escort cap (which counts both) can never
        // see a hire twice; see pending_escorts.ts.
        commitPendingEscorts(this.input, this.hired);
        super.done();
    }
}
