import { GovtData } from "novadatainterface/govt_data";
import { OutfitData } from "novadatainterface/outfit_data";
import { ShipData } from "novadatainterface/ship_data";
import { Entity } from "nova_ecs/entity";
import { DefaultMap } from "nova_ecs/utils";
import { DockedLiveStatus } from "../display/docked_ship.js";
import * as PIXI from 'pixi.js';
import { Observable, Subject } from "rxjs";
import { DisplayAssetDataInterface } from "../client/gamedata/display_asset_data.js";
import { SimulationGameDataInterface } from "../client/gamedata/simulation_game_data.js";
import { ControlEvent } from "../nova_plugin/controls_plugin.js";
import { makeControlBitHooks, NCBParseError, runNCBSet } from "../nova_plugin/ncb.js";
import { ControlBits, ControlBitsComponent } from "../nova_plugin/ncb_plugin.js";
import { playerDiscovery } from "../nova_plugin/discovery_store.js";
import { makeDescTextContext, playerGender, resolveConditionalBlocks }
    from '../nova_plugin/desc_text.js';
import { OutfitsStateComponent } from "../nova_plugin/outfit_plugin.js";
import { cleanRecords, LegalRecords } from "../nova_plugin/reputation.js";
import { LegalRecordsComponent } from "../nova_plugin/reputation_plugin.js";
import { ShipComponent } from "../nova_plugin/ship_plugin.js";
import {
    numericId, resolveNumberedResource, setStringPrefix,
    systemDiscoveryOperators,
} from "../nova_plugin/mission_logic.js";
import { dayNumber } from "../nova_plugin/calendar.js";
import {
    CreditsComponent, GameDateComponent,
} from "../nova_plugin/player_state_plugin.js";
import { Button, ButtonClick } from "./button.js";
import { commitVenueCredits, creditBalance } from "./credit_commit.js";
import { DEBUG_FLAGS } from "../debug_flags.js";
import { formatPrice } from "./format_price.js";
import { ItemGrid, ItemTile } from "./item_grid.js";
import { Menu } from "./menu.js";
import { MissionSession } from "./mission_session.js";
import { applyMapOutfit } from "./map_outfit.js";
import { MissionUniverse } from "./mission_universe.js";
import { rankContribute } from "../nova_plugin/rank_logic.js";
import { DeployedOutfitCounts } from "./deployed_outfits.js";
import { AMMO_SELL_INDICES, AMMO_SELL_STRINGS, AmmoSellStrings, BuyDenialReason, canBuyOutfit, canSellOutfit, freeCargo, freeMass, hasPurchaseSideEffects, installedMass, maxBuyCount, maxSellCount, sellRefund, outfitPrice, OutfitterContext, OutfitterStellar, SELL_REFUSAL_TABLE, stellarOf, visibleOutfits } from "./outfitter_rules.js";
import { PlanetData } from "novadatainterface/planet_data";
import { QuantityDialog } from "./quantity_dialog.js";


const descWidth = 190;
/**
 * The body-text line pitch of every spaceport description pane. The
 * original runs Geneva 10 on a 12px pitch: successive lines' ink tops are
 * at screen y 392 / 404 / 416 in shipyard/earth_spaceport.png's ship
 * description, and 503 / 515 / 527 in mission_bbs/un_shipping_mission.png.
 * PIXI's own default for this font is 13, which by the tenth line has
 * drifted a whole line down; pinning it here fixes every pane that shares
 * this style. (Setting lineHeight below PIXI's natural value leaves the
 * FIRST baseline where it was -- Text.updateText clamps its centring
 * shift at zero -- so this only tightens the pitch.)
 */
export const BODY_LINE_HEIGHT = 12;
export const FONT = {
    normal: {
        fontFamily: "Geneva", fontSize: 10, fill: 0xffffff,
        align: 'left', wordWrap: true, wordWrapWidth: descWidth,
        lineHeight: BODY_LINE_HEIGHT,
    } as const,
    grey: {
        fontFamily: "Geneva", fontSize: 10, fill: 0x262626,
        align: 'left', wordWrap: true, wordWrapWidth: descWidth,
        lineHeight: BODY_LINE_HEIGHT,
    } as const,
    count: {
        fontFamily: "Geneva", fontSize: 10, fill: 0xffffff,
        align: 'right', wordWrap: false, wordWrapWidth: descWidth,
        lineHeight: BODY_LINE_HEIGHT,
    } as const,
};

/**
 * The outfitter's right info pane, in menu-container coordinates (screen
 * x = 960 + these). Measured on the outfitter reference screenshots:
 * label ink at screen x 1196, values at 1266, and rows whose ink tops sit
 * at y 599 / 611 (price, credits), 635 / 647 (mass, available) and 680
 * (the denial caption) -- our PIXI.Text ink starts at the box's left edge
 * and 2px below its top, which is what turns those into the numbers here.
 *
 * The shipyard's pane is deliberately NOT the same: the original draws it
 * 4px left and 1px up (see SHIPYARD_PRICE_COLUMNS).
 */
const INFO_COLUMN = { label: 236, value: 306 } as const;
const INFO_ROWS = {
    itemPrice: 57,
    youHave: 69,
    itemMass: 93,
    available: 105,
    /**
     * The denial caption's own row, a wide gap below "Available:" --
     * ink at screen y 680 in every one of the five
     * outfitter/earth_outfitter_cant_*.png captures.
     */
    status: 138,
} as const;

/**
 * A small round scroll-arrow button for the item grid (the original's
 * outfitter has an up/down pair at the grid's bottom-left). Drawn with
 * graphics — a dark disc and a triangle that reddens when enabled and
 * dims when the page is at that end.
 */
class ScrollArrow {
    container = new PIXI.Container();
    readonly click = new Subject<void>();
    private disc = new PIXI.Graphics();
    private glyph = new PIXI.Graphics();
    private wrappedEnabled = true;

    constructor(private direction: 'up' | 'down') {
        this.container.addChild(this.disc, this.glyph);
        this.container.interactive = true;
        this.container.cursor = 'pointer';
        // An explicit hit area so the whole disc is reliably clickable
        // (graphics-only children can hit-test inconsistently).
        this.container.hitArea = new PIXI.Circle(0, 0, 10);
        this.container.on('pointerup', () => {
            if (this.wrappedEnabled) {
                this.click.next();
            }
        });
        this.draw();
    }

    private draw() {
        // It is the DISC that carries the state in the original, not the
        // chevron: in outfitter/earth_outfitter.png the disabled up arrow
        // is a near-black sphere with a dark chevron, while the enabled
        // down arrow is a dark-red one (sampled (57,0,0)..(90,8,8)) with a
        // WHITE chevron. We had it the other way round -- always-black
        // disc, red-or-grey triangle. The original's spheres are shaded
        // artwork with a specular highlight, sitting in a socket that the
        // 8502 frame itself draws (the shipyard shows the same two sockets
        // with no arrows over them); these flat fills reproduce the
        // colours and the silhouette, not the gloss.
        this.disc.clear()
            .beginFill(this.wrappedEnabled ? 0x4a0000 : 0x0a0a0a)
            .drawCircle(0, 0, 9)
            .endFill();
        this.glyph.clear().beginFill(
            this.wrappedEnabled ? 0xffffff : 0x1f1f1f);
        if (this.direction === 'up') {
            this.glyph.drawPolygon([0, -4, 4, 3, -4, 3]);
        } else {
            this.glyph.drawPolygon([0, 4, 4, -3, -4, -3]);
        }
        this.glyph.endFill();
    }

    set enabled(value: boolean) {
        this.wrappedEnabled = value;
        this.draw();
    }
}

export class Outfitter extends Menu<Entity> {
    private itemGrid?: ItemGrid<OutfitData>;
    /**
     * Every outfit in the game data, in display order. The grid shows the
     * subset visibleOutfits() admits for the docked stellar and the
     * player's state; this is the pool that subset is drawn from.
     */
    private allOutfits: OutfitData[] = [];
    /**
     * The stellar being visited, supplying the tech level / SpecialTech /
     * "buys anything" rules that decide what this outfitter stocks. Set by
     * the Spaceport once its planet data loads. Absent means "no stellar
     * context", under which the rules stock everything (see
     * OutfitterContext.planet).
     */
    private planetData?: PlanetData;
    private quantityDialog: QuantityDialog;
    private pictContainer = new PIXI.Container();
    /** Working copies, committed to the ship entity on done. */
    private outfits: DefaultMap<string, number>;
    /**
     * How many units of each outfit id were BOUGHT during the current
     * outfitter visit (per outfit id). Selling drains these first at a
     * full refund (you get back exactly what you just paid); once the
     * same-visit purchases are used up, further sells fall back to the
     * 50% pre-owned resale value. Reset to empty on every show() — each
     * visit starts with a clean slate (see setInput).
     */
    private visitPurchases = new DefaultMap<string, number>(() => 0);
    private controlBits: ControlBits = new Set();
    private records: LegalRecords = new Map();
    /**
     * The player's working credit balance. Buys deduct the outfit price;
     * sells refund the full price for a unit bought this same visit, else
     * 50% of it (see applySell / outfitResaleValue). In the mission
     * session path this is the SAME object as the session's working
     * credits, so session.commit() persists it (and a mission set string
     * that pays out is reflected here); in the fallback path done()
     * writes it to the entity's CreditsComponent itself. EITHER WAY the
     * write is rebased into a delta over {@link creditsBaseline} before it
     * lands, so a concurrent writer is not erased (credit_commit.ts).
     */
    private credits: { credits: number } = { credits: 0 };
    /**
     * The balance {@link credits} was seeded from in setInput. done()
     * commits the DIFFERENCE from it rather than the absolute, so an escort
     * deal settling mid-visit (or the spaceport's refuel button) is not
     * erased — see credit_commit.ts, which documents the whole seam.
     */
    private creditsBaseline = 0;
    /** Every govt, sorted by id, loaded in build() for ModType 21. */
    private govts: (readonly [string, GovtData])[] = [];
    private shipData?: ShipData;
    /**
     * Built per-visit so outfit purchase/sell set strings can run the
     * mission operators Sxxx/Axxx/Fxxx (start/fail/abort a mission), not
     * just control-bit ops. Undefined until show() has built it (or if
     * the build failed — then set strings fall back to bit-only hooks).
     */
    private missionSession?: MissionSession;
    /**
     * The union of the active ranks' Contribute sets, for the Require test
     * (see outfitter_rules' playerContribute). Read off the mission
     * session's working rank set so a rank granted by an OnPurchase set
     * string takes effect on the very next grid refresh, before commit.
     * Zero without a session, which is the pre-rank behaviour.
     */
    private rankContribute(): bigint {
        const ranks = this.missionSession?.state.ranks;
        const universe = MissionUniverse.shared(this.simulationData);
        return rankContribute(ranks, id => universe.getRank(id));
    }

    /**
     * Owned-but-not-aboard units for this landing (bay fighters still in
     * flight), supplied by the display side via
     * Spaceport.setDeployedOutfitCounts. Called fresh on every context
     * build, so a fighter destroyed mid-visit stops counting. Undefined
     * means "everything owned is aboard" — the case for every headless
     * test and for a landing with no fighters out.
     */
    private deployedOutfitCounts?: DeployedOutfitCounts;
    /**
     * The five STR# 2002 fragments the launcher sell refusal is composed
     * from, read from the loaded data in build(). The stock wording is the
     * fallback for a data set whose table is missing or too short (see
     * outfitter_rules' AMMO_SELL_STRINGS).
     */
    private ammoSellStrings: AmmoSellStrings = AMMO_SELL_STRINGS;

    private text = {
        description: new PIXI.Text("", FONT.normal),
        itemPrice: new PIXI.Text("Item Price:", FONT.normal),
        price: new PIXI.Text("5,000 cr", FONT.normal),
        youHave: new PIXI.Text("You Have:", FONT.normal),
        count: new PIXI.Text("0 cr", FONT.normal),
        itemMass: new PIXI.Text("Item Mass:", FONT.normal),
        mass: new PIXI.Text("3", FONT.normal),
        availableMass: new PIXI.Text("Available:", FONT.normal),
        freeMass: new PIXI.Text("", FONT.normal),
        // The denial / purchase feedback line at the bottom of the
        // right info pane ("Can't have any more!" in the reference
        // outfitter screenshots).
        status: new PIXI.Text("", {
            ...FONT.normal, wordWrapWidth: 145,
        }),
    }
    private buttons: { buy: Button, sell: Button, done: Button };
    // The item-grid scroll arrows, at the grid's bottom-left (only shown
    // when the outfit list is taller than the 4x5 grid). Measured
    // against outfitter/earth_outfitter.png.
    private scrollUpArrow = new ScrollArrow('up');
    private scrollDownArrow = new ScrollArrow('down');

    constructor(displayAssets: DisplayAssetDataInterface,
        simulationData: SimulationGameDataInterface,
        controlEvents: Observable<ControlEvent>) {
        super(displayAssets, simulationData, "nova:8502", controlEvents);
        this.container.name = 'Outfitter';

        // Sphere centres, measured on outfitter/earth_outfitter.png: the
        // two dark discs span screen x 728-745 and 758-775 on rows
        // 673-685, i.e. centres (736.5, 679) and (766.5, 679) -- 30px
        // apart, where ours were 24 apart and up to 9px right.
        this.scrollUpArrow.container.position.set(-223.5, 139);
        this.scrollDownArrow.container.position.set(-193.5, 139);
        this.scrollUpArrow.click.subscribe(() => {
            this.itemGrid?.scrollUp();
            this.updateArrows();
        });
        this.scrollDownArrow.click.subscribe(() => {
            this.itemGrid?.scrollDown();
            this.updateArrows();
        });
        this.container.addChild(this.scrollUpArrow.container,
            this.scrollDownArrow.container);

        this.outfits = new DefaultMap(() => 0);
        // Measured against outfitter/earth_outfitter.png. A Button's red
        // face starts 5px right of its container x and runs (width + 15)px
        // -- calibrated on the shipyard row, whose pills land on the
        // reference to the pixel. The reference outfitter row has its Done
        // face at screen x 1083-1170 (88 wide) and the two greyed pills'
        // dark interiors at 876-958 and 982-1064, which invert to these
        // x's and a width of 73 (we had 70, and every pill 4px right).
        //
        // y 129, not 134: the reference pills occupy rows 674-686 where
        // ours ran 679-691. That is one row BELOW the shipyard's
        // (673-685), the same one-pixel drop the outfitter's grid and info
        // pane have.
        this.buttons = {
            buy: new Button(displayAssets, "Buy", 73, { x: -95, y: 129 }),
            sell: new Button(displayAssets, "Sell", 73, { x: 11, y: 129 }),
            done: new Button(displayAssets, "Done", 73, { x: 118, y: 129 })
        };

        // Option+click opens the bulk quantity dialog, as the
        // original's outfitter does.
        this.buttons.buy.click.subscribe(click => this.buyOutfit(click));
        this.buttons.sell.click.subscribe(click => this.sellOutfit(click));
        // Debug: shift+click presses a greyed Buy/Sell anyway (DEBUG_FLAGS).
        const overridePress = (event: { shiftKey: boolean }) =>
            DEBUG_FLAGS.tradeOverride && event.shiftKey;
        this.buttons.buy.pressGreyIf = overridePress;
        this.buttons.sell.pressGreyIf = overridePress;
        this.buttons.done.click.subscribe(this.done.bind(this));
        this.addButtons(this.buttons);

        this.quantityDialog = new QuantityDialog(controlEvents);

        // The selected item's picture. x 175 (not 174): sweeping our
        // capture against shipyard/earth_spaceport.png's Shuttle artwork
        // (the same PICT on both sides) bottoms out at dx = -1, i.e. ours
        // sat one pixel left of the original's.
        this.pictContainer.position.x = 175;
        this.pictContainer.position.y = -152.5;
        this.pictContainer.scale.x = 1;
        this.pictContainer.scale.y = 1;
        this.container.addChild(this.pictContainer);

        this.text.description.position.x = -27;
        this.text.description.position.y = -150;

        this.text.itemPrice.position.x = INFO_COLUMN.label;
        this.text.itemPrice.position.y = INFO_ROWS.itemPrice;

        this.text.price.position.x = INFO_COLUMN.value;
        this.text.price.position.y = INFO_ROWS.itemPrice;

        this.text.youHave.position.x = INFO_COLUMN.label;
        this.text.youHave.position.y = INFO_ROWS.youHave;

        this.text.count.position.x = INFO_COLUMN.value;
        this.text.count.position.y = INFO_ROWS.youHave;

        this.text.itemMass.position.x = INFO_COLUMN.label;
        this.text.itemMass.position.y = INFO_ROWS.itemMass;

        this.text.mass.position.x = INFO_COLUMN.value;
        this.text.mass.position.y = INFO_ROWS.itemMass;

        this.text.availableMass.position.x = INFO_COLUMN.label;
        this.text.availableMass.position.y = INFO_ROWS.available;

        this.text.freeMass.position.x = INFO_COLUMN.value;
        this.text.freeMass.position.y = INFO_ROWS.available;

        // Bottom of the right info pane, a wide gap under the Available
        // row, where the reference screenshots put "Can't have any more!".
        this.text.status.position.x = INFO_COLUMN.label;
        this.text.status.position.y = INFO_ROWS.status;

        for (const t of Object.values(this.text)) {
            this.container.addChild(t);
        }
    }

    protected override async build() {
        await super.build();
        // ModType 21 (clean legal record) needs govt data: ModVal -1
        // cleans every govt, and cleaning consults InitialRec.
        const govtIds = [...(await this.simulationData.ids).Govt].sort();
        this.govts = await Promise.all(govtIds.map(async id =>
            [id, await this.simulationData.data.Govt.get(id)] as const));
        this.ammoSellStrings = await this.loadAmmoSellStrings();
        const itemGrid = await this.makeOutfitsGrid();
        this.itemGrid = itemGrid;
        this.container.addChild(this.itemGrid.container);

        this.itemGrid.drawGrid();
        this.itemGrid.container.position.x = -373;
        // One pixel below the shipyard's grid, which is not a typo: the
        // original's outfitter lattice starts at screen y 388 (its top
        // rule runs 388..658, five 54px rows) while the shipyard's starts
        // at 387 (387..549, three rows). The whole outfitter info pane is
        // likewise a pixel lower than the shipyard's (see INFO_ROWS).
        this.itemGrid.container.position.y = -152;
        this.itemGrid.activeTile.subscribe(this.setOutfitSelected.bind(this));
        this.updateArrows();

        // On top of everything, so its modal shield covers the screen.
        this.container.addChild(this.quantityDialog.container);

        // Keyboard grid navigation can scroll the page too, so keep the
        // arrows' enabled state in sync.
        this.controls.controls = {
            left: () => { itemGrid.left(); this.updateArrows(); },
            right: () => { itemGrid.right(); this.updateArrows(); },
            up: () => { itemGrid.up(); this.updateArrows(); },
            down: () => { itemGrid.down(); this.updateArrows(); },
            buy: this.buyOutfit.bind(this),
            sell: this.sellOutfit.bind(this),
            depart: this.done.bind(this),
        };
        // OS key-repeat should repeat buys/sells (each re-checked by the
        // handler, so denials still apply). Scoped to this menu's
        // controls so global actions (jump, land, fire) keep firing once
        // per press. Nav keys already repeat via the default set.
        this.controls.repeatableActions.add('buy');
        this.controls.repeatableActions.add('sell');
    }

    /**
     * Reads the launcher sell refusal's five fragments out of STR# 2002,
     * per-index so a table that only carries some of them keeps the stock
     * wording for the rest. Falls back wholesale when the table is absent.
     */
    private async loadAmmoSellStrings(): Promise<AmmoSellStrings> {
        try {
            const table = await this.displayAssets.data.StringTable.get(
                SELL_REFUSAL_TABLE);
            const read = (key: keyof AmmoSellStrings) => {
                const text = table.strings[AMMO_SELL_INDICES[key]];
                return text?.trim() ? text : AMMO_SELL_STRINGS[key];
            };
            return {
                needToSell: read('needToSell'),
                unit: read('unit'),
                units: read('units'),
                ofAmmunition: read('ofAmmunition'),
                beforeYouCanSell: read('beforeYouCanSell'),
            };
        } catch {
            return AMMO_SELL_STRINGS;
        }
    }

    /**
     * Shows the scroll arrows only when the outfit list overflows the
     * grid, and greys each when the page is already at that end.
     */
    private updateArrows() {
        if (!this.itemGrid) {
            return;
        }
        const scrollable =
            this.itemGrid.canScrollUp || this.itemGrid.canScrollDown;
        this.scrollUpArrow.container.visible = scrollable;
        this.scrollDownArrow.container.visible = scrollable;
        this.scrollUpArrow.enabled = this.itemGrid.canScrollUp;
        this.scrollDownArrow.enabled = this.itemGrid.canScrollDown;
    }

    private async makeOutfitsGrid() {
        const ids = (await this.simulationData.ids).Outfit;
        const outfits = await Promise.all(ids.map(id =>
            this.simulationData.data.Outfit.get(id, 100)));
        outfits.sort((a, b) => b.displayWeight - a.displayWeight);

        // Purchase checks look weapons up synchronously, so warm the
        // cache with every weapon the outfits grant or feed ammo to.
        const weaponIds = new Set<string>();
        for (const outfit of outfits) {
            for (const weaponId of Object.keys(outfit.weapons)) {
                weaponIds.add(weaponId);
            }
            if (outfit.ammoFor) {
                weaponIds.add(outfit.ammoFor);
            }
        }
        await Promise.all([...weaponIds].map(id =>
            this.simulationData.data.Weapon.get(id, 100)));

        this.allOutfits = outfits;
        const itemGrid = new ItemGrid(this.displayAssets, outfits);
        itemGrid.setCounts(this.outfits);
        return itemGrid;
    }

    /** See the planetData field. Call before showing the outfitter. */
    setPlanet(planet: PlanetData) {
        this.planetData = planet;
        this.refreshGrid();
    }

    /** The docked stellar's stock rules, or undefined before its data loads. */
    private stellar(): OutfitterStellar | undefined {
        return this.planetData && stellarOf(this.planetData);
    }

    /**
     * Re-applies the outfitter's visibility rules and the owned-item
     * counts to the grid. Called whenever something the rules read
     * changes: a new visit, the ship data arriving, and every buy/sell
     * (which can add or remove an item that was only visible because the
     * player owned one, or flip an Availability bit via OnPurchase).
     *
     * Deliberately NOT called from refreshTradeState: repopulating the
     * grid re-emits the active tile, which calls back into
     * refreshTradeState, and the two would recurse.
     */
    private refreshGrid() {
        if (!this.itemGrid) {
            return;
        }
        const context = this.makeContext();
        if (context) {
            this.itemGrid.setItems(visibleOutfits(this.allOutfits, context));
        }
        this.itemGrid.setCounts(this.outfits);
    }

    /** See the deployedOutfitCounts field. */
    setDeployedOutfitCounts(counts?: DeployedOutfitCounts) {
        this.deployedOutfitCounts = counts;
    }

    /**
     * NO ränk PriceMod is resolved here, deliberately. A rank discount bends
     * the SHIPYARD's hull price and the bar's hire fee taken off it, but the
     * outfitter quotes every oütf Cost as written (price_mod.ts). Extra
     * Outfits' "Buy Station" (extra-outfits:552) grants four PriceMod-1 ranks
     * that make the hulls at its Spica Shipyard free; the building materials
     * those hulls are built from are sold in THIS shop and have to stay
     * expensive, which is the only reason the feature has an economy at all.
     */
    private makeContext(): OutfitterContext | undefined {
        if (!this.shipData) {
            return undefined;
        }
        return {
            shipData: this.shipData,
            outfits: this.outfits,
            // WARMTH PRECONDITION: getCached answers only for ids already
            // fetched. makeOutfitsGrid fetches EVERY outfit id (and every
            // weapon those outfits name) before the grid — and so any
            // context consumer — can run, so these lookups answer for
            // everything that exists. Anyone rewiring them must keep that
            // exhaustive warm-up.
            //
            // getCached is NOT an existence test, though, and must never
            // be used as one: a miss both returns undefined AND starts a
            // background load, and GameDataAggregator answers an id
            // nothing defines with a placeholder instead of rejecting, so
            // the same probe flips from "absent" to "present" a frame
            // later. That is why `Oxxx` resolution gets `outfitExists`
            // below rather than being left to infer existence from
            // getOutfit (see outfitter_rules' outfitReferenceExists, and
            // outfitter_officer_reselect_test.ts for the bug it caused).
            getOutfit: id => this.simulationData.data.Outfit.getCached(id),
            getWeapon: id => this.simulationData.data.Weapon.getCached(id),
            // The stock-first id-space lookup for `Oxxx`, off the loaded
            // oütf id list — the same answer runSetString's Gxxx/Dxxx
            // resolution uses, and independent of what has been fetched.
            outfitExists: this.outfitExists(),
            bits: this.controlBits,
            rankContribute: this.rankContribute(),
            credits: this.credits.credits,
            // Resolved against the outfits the player owns, because a
            // deployed fighter names only its bay weapon and has to be
            // attributed back to one of the player's ammo outfits.
            deployedCounts: this.deployedOutfitCounts?.(this.outfits.keys()),
            planet: this.stellar(),
            ammoSellStrings: this.ammoSellStrings,
            // `Exxx` in an Availability: the local pilot's map knowledge,
            // read straight from the store (the shop is a player-local
            // screen; see OutfitterContext.discovery).
            discovery: playerDiscovery,
            systemExists: this.systemExists(),
            // The oütf BuyRandom day roll (day_roll.ts), the outfitter's
            // half of the same per-day shop stock the shipyard and the
            // bar's hire pool run on. Same two inputs the shipyard reads
            // (ship_gate_context.ts): the landed player's date and the
            // docked stellar.
            day: this.gameDay(),
            stellarId: this.planetData ? numericId(this.planetData.id) : null,
        };
    }

    /**
     * The sÿst existence lookup the `Exxx` / `Xxxx` operators resolve
     * their bare numbers through, or undefined while the shared universe
     * has not loaded — which is exactly the situation the bit-only
     * fallback in runSetString exists for. Undefined means "assume the
     * writing plug-in's own id", the documented no-id-space behaviour;
     * answering "no system exists" instead would silently drop every
     * `Xxxx` and leave the pilot without the map the mission granted.
     */
    private systemExists(): ((globalId: string) => boolean) | undefined {
        const universe = MissionUniverse.shared(this.simulationData);
        return universe.systemsLoaded
            ? (globalId: string) => universe.hasSystem(globalId)
            : undefined;
    }

    /**
     * The oütf existence lookup an `Oxxx` term resolves its bare number
     * through, or undefined while the shared universe has not loaded.
     *
     * The `Oxxx` counterpart of systemExists, undefined for the same
     * reason: "assume the writing plug-in's own id" is the documented
     * no-id-space behaviour, whereas answering "no outfit exists" would
     * send every plug-in `Oxxx` that names a STOCK outfit to a phantom id
     * under the plug-in's prefix.
     *
     * Note what this is NOT allowed to be: `getOutfit(id) !== undefined`.
     * See outfitter_rules' outfitReferenceExists.
     */
    private outfitExists(): ((globalId: string) => boolean) | undefined {
        const universe = MissionUniverse.shared(this.simulationData);
        return universe.outfitsLoaded
            ? (globalId: string) => universe.hasOutfit(globalId)
            : undefined;
    }

    /**
     * The absolute game day (calendar.ts dayNumber), or undefined before
     * the visit's date is known — which day_roll reads as "no roll", so a
     * missing date can never make the shop look empty.
     */
    private gameDay(): number | undefined {
        const date = this.input?.components.get(GameDateComponent);
        return date ? dayNumber(date) : undefined;
    }

    /**
     * Runs an outfit's OnPurchase / OnSell control bit set string
     * against the working outfits and control bits. Gxxx grants here
     * intentionally bypass the purchase checks.
     */
    private runSetString(expression: string, resourcePrefix = 'nova') {
        if (!expression) {
            return;
        }
        // When a mission session is available, run the string through the
        // full mission machinery so Sxxx/Axxx/Fxxx (start/fail/abort a
        // mission) take effect, not just control-bit ops. The session
        // shares this.outfits' contents and this.controlBits, so sync the
        // outfit counts into it first (buy/sell mutate this.outfits).
        if (this.missionSession) {
            this.missionSession.outfits.clear();
            for (const [id, count] of this.outfits) {
                if (count > 0) {
                    this.missionSession.outfits.set(id, count);
                }
            }
            // Buying/selling a freeCargo outfit changes the hold; refresh
            // the session's cargo capacity so an OnPurchase/OnSell Sxxx that
            // starts a cargo mission checks against the current hold (L6).
            const context = this.makeContext();
            if (context) {
                this.missionSession.setCargoCapacity(freeCargo(context));
            }
            try {
                this.missionSession.runMissionSet(expression, resourcePrefix);
            } catch (error) {
                if (error instanceof NCBParseError) {
                    console.warn('Bad outfit mission set string:', error);
                } else {
                    throw error;
                }
            }
            // Reflect any Gxxx/Dxxx outfit grants back into the grid copy.
            this.outfits = new DefaultMap(() => 0,
                [...this.missionSession.outfits]);
            return;
        }
        try {
            // The purchase itself is a player decision, not simulation
            // logic, so plain randomness is fine for R(a b) here: only
            // the resulting state reaches the simulation.
            runNCBSet(expression, makeControlBitHooks(this.controlBits, {
                outfits: this.outfits,
                // Numeric ids in an outfit's own set string resolve
                // exactly as the mission path resolves them
                // (resolveNumberedResource: the stock outfit if stock
                // defines that number, else the writer plug-in's own).
                // Hard-coding "nova" here once made a plug-in's `G472`
                // grant the STOCK outfit 472; writer-only made a plug-in
                // cron's `G135` miss the stock IR Missile (review r14 L2).
                resolveId: id => resolveNumberedResource(id, resourcePrefix,
                    globalId => MissionUniverse.shared(this.simulationData)
                        .hasOutfit(globalId)),
                // Xxxx ("make system xxx be explored"), against the same
                // player-local record the star map draws from. Wired on
                // this fallback path too, so an outfit whose mission
                // session failed to build still reveals its map.
            }, undefined, systemDiscoveryOperators(
                playerDiscovery, resourcePrefix, this.systemExists())),
                Math.random);
        } catch (error) {
            if (error instanceof NCBParseError) {
                console.warn('Bad control bit set string:', error);
                return;
            }
            throw error;
        }
    }

    /** Applies one unit's purchase: charge, count, ModType 21, OnPurchase. */
    private applyBuy(outfit: OutfitData, units = 1) {
        // Charge the item's price. Callers gate on canBuyOutfit (which
        // includes affordability), so this never drives credits negative.
        // `units` > 1 is the side-effect-free bulk path (see bulkBuy):
        // the OnPurchase / legal-record hooks below run ONCE per call, so
        // callers must pass units=1 for outfits that have them
        // (hasPurchaseSideEffects).
        // The same price the grid quotes and canBuyOutfit checked against
        // (ship-mass-proportional for oütf 0x0200, hence the hull).
        this.credits.credits -= outfitPrice(outfit, this.shipData) * units;
        this.outfits.set(outfit.id, this.outfits.get(outfit.id) + units);
        // Record the same-visit purchase so selling it back before
        // leaving refunds the full price (see applySell).
        this.visitPurchases.set(outfit.id,
            this.visitPurchases.get(outfit.id) + units);
        // ModType 21: buying the outfit cleans (raises to at least 0)
        // the player's legal record with the ModVal govt, or with every
        // govt when ModVal is -1. Applies once, at purchase.
        if (outfit.cleanLegalRecord !== null) {
            if (outfit.cleanLegalRecord === -1) {
                cleanRecords(this.records, 'all', undefined, this.govts);
            } else {
                const govtId = `nova:${outfit.cleanLegalRecord}`;
                cleanRecords(this.records, 'govt',
                    this.govts.find(([id]) => id === govtId)?.[1],
                    this.govts);
            }
        }
        // ModType 16: a map is information, not equipment. Buying it
        // reveals everything within ModVal jumps of the system being
        // shopped in and then comes straight back off the ship, so the
        // player is charged once and can buy it again later somewhere
        // else. See map_outfit.ts for the whole rule and its evidence.
        if (outfit.map !== null) {
            this.applyMapPurchase(outfit.map);
            this.outfits.set(outfit.id,
                Math.max(0, this.outfits.get(outfit.id) - units));
            this.visitPurchases.set(outfit.id,
                Math.max(0, this.visitPurchases.get(outfit.id) - units));
        }
        this.runSetString(outfit.onPurchase, setStringPrefix(outfit));
    }

    /**
     * Reveals the systems a just-bought map covers, measured from the
     * system this outfitter is in. No-op without a stellar context (a
     * headless test outfitter), which has no system to measure from.
     */
    private applyMapPurchase(modVal: number) {
        const universe = MissionUniverse.shared(this.simulationData);
        const planetId = this.planetData?.id;
        const systemId = planetId === undefined
            ? undefined : universe.systemIdOfPlanet(planetId, this.controlBits);
        if (systemId === undefined) {
            return;
        }
        applyMapOutfit(modVal, systemId, universe);
    }

    /**
     * Applies one unit's sale, count, and OnSell. A unit bought earlier
     * this same visit is refunded in full (100% of the price paid);
     * otherwise the player recovers the 50% pre-owned resale value.
     * Same-visit purchases drain first, so a bulk sell that spans both
     * (e.g. 3 bought this visit + 2 pre-owned) splits automatically as
     * the per-unit loop calls this repeatedly.
     */
    private applySell(outfit: OutfitData) {
        const refund = sellRefund(outfit, this.visitPurchases.get(outfit.id),
            this.shipData);
        this.credits.credits += refund.credited;
        this.visitPurchases.set(outfit.id, refund.boughtThisVisit);
        this.outfits.set(outfit.id, Math.max(0, this.outfits.get(outfit.id) - 1));
        if (this.outfits.get(outfit.id) === 0) {
            this.outfits.delete(outfit.id);
        }
        this.runSetString(outfit.onSell, setStringPrefix(outfit));
    }

    /**
     * The original outfitter's denial captions, shown persistently at the
     * bottom of the right info pane while a denied selection is
     * highlighted, with the Buy button greyed.
     *
     * All four wordings are read straight off the reference screenshots
     * (outfitter/earth_outfitter_cant_*.png):
     *
     *   cant_have_any                     "Can't have any of this item!"
     *   cant_have_any_more                "Can't have any more!"
     *   cant_hold_any                     "Can't hold any of this item!"
     *   cant_hold_any_more                "Can't hold any of this item!"
     *   carbon_fiber_cant_hold_any_more   "Can't hold any more!"
     *
     * Note the pair in the middle: the file NAMED cant_hold_any_more in
     * fact shows the "of this item" wording (an unowned outfit that will
     * not fit), and it is the carbon-fibre capture -- an outfit the pilot
     * already owns three of -- that shows the "any more" one. So the
     * "more" variants are the plain "Can't hold any more!" /
     * "Can't have any more!", NOT the longer sentence we used to print.
     */
    private denialCaption(reason: BuyDenialReason, owned: number,
        fallback: string): string {
        switch (reason) {
            case 'availability':
            case 'require':
                return owned > 0
                    ? "Can't have any more!"
                    : "Can't have any of this item!";
            case 'maxCount':
                return "Can't have any more!";
            // A failed BuyRandom day roll hides the item outright
            // (day_roll.ts), so this caption is the backstop for a stale
            // selection; the references show no wording of its own, and
            // "can't have any of this item" is what the shop is saying.
            case 'notAvailableToday':
                return owned > 0
                    ? "Can't have any more!"
                    : "Can't have any of this item!";
            case 'mass':
            case 'cargo':
                return owned > 0
                    ? "Can't hold any more!"
                    : "Can't hold any of this item!";
            case 'credits':
                // The Bible/STR# have no dedicated outfitter money
                // caption; this matches the existing captions' style.
                return "Can't afford this item!";
            default:
                // Hardpoint / launcher denials keep the descriptive
                // rule message (the references don't show them).
                return fallback;
        }
    }

    /**
     * Recomputes the Buy/Sell button states and the persistent denial
     * caption for the current selection, as the original does.
     */
    /** Refreshes the "You Have:" line from the working credit balance. */
    private updateCreditsText() {
        this.text.count.text = formatPrice(this.credits.credits);
    }

    private refreshTradeState() {
        this.updateCreditsText();
        const outfit = this.itemGrid?.selection;
        const context = this.makeContext();
        if (!outfit || !context) {
            this.buttons.buy.state = 'grey';
            this.buttons.sell.state = 'grey';
            return;
        }
        const buyCheck = canBuyOutfit(outfit, context);
        const sellCheck = canSellOutfit(outfit, context);
        this.buttons.buy.state = buyCheck.allowed ? 'normal' : 'grey';
        this.buttons.sell.state = sellCheck.allowed ? 'normal' : 'grey';
        this.text.status.text = buyCheck.allowed
            ? this.sellDenialCaption(sellCheck)
            : this.denialCaption(buyCheck.reason,
                context.outfits.get(outfit.id) ?? 0, buyCheck.message);
    }

    /**
     * The caption for a selection that may be BOUGHT but not sold. The
     * original does caption sell-side refusals — stock STR# 2002 index 206
     * ("Can't sell that item, because your ship would have negative free
     * mass afterwards.") and the launcher sentence at 207-211 are both
     * sell captions — so a greyed Sell button is allowed to explain itself.
     *
     * Three of the six reasons do. 'ammoAboard' and 'negativeFreeMass' are
     * the two the original itself has strings for, and 'fightersDeployed'
     * is the same shortfall reached by rounds that cannot be sold to clear
     * it (see canSellOutfit). The rest would be noise on the line the buy
     * captions own: 'notOwned' is true of every item on the shelf the
     * player hasn't bought yet, and 'cantSell' / 'notStocked' are permanent
     * properties the player cannot act on. The captioned three are all
     * both surprising and fixable, and saying nothing leaves the player
     * prodding a dead button.
     */
    private sellDenialCaption(
        sellCheck: ReturnType<typeof canSellOutfit>): string {
        if (sellCheck.allowed) {
            return '';
        }
        switch (sellCheck.reason) {
            case 'ammoAboard':
            case 'negativeFreeMass':
            case 'fightersDeployed':
                return sellCheck.message;
            default:
                return '';
        }
    }

    private buyOutfit(click?: ButtonClick) {
        if (click?.option) {
            // Option+click: the bulk quantity dialog.
            void this.bulkBuy();
            return;
        }
        const outfit = this.itemGrid?.selection;
        const context = this.makeContext();
        if (!outfit || !context) {
            return;
        }

        const buyCheck = canBuyOutfit(outfit, context);
        if (!buyCheck.allowed) {
            if (this.debugOverride(click, buyCheck.message)) {
                // Fall through: the purchase goes ahead regardless.
            } else {
                // The persistent caption and greyed button already explain.
                this.refreshTradeState();
                return;
            }
        }

        this.applyBuy(outfit);
        this.refreshGrid();
        this.setFreeMassText();
        this.refreshTradeState();
    }

    /**
     * The option-click bulk buy: a quantity dialog prefilled with (and
     * clamped to) the most the checks allow, then that many unit
     * purchases, each re-checked (OnPurchase effects can change what a
     * later unit is allowed to do).
     */
    private async bulkBuy() {
        const outfit = this.itemGrid?.selection;
        const context = this.makeContext();
        if (!outfit || !context) {
            return;
        }
        const max = maxBuyCount(outfit, context);
        if (max <= 0) {
            const check = canBuyOutfit(outfit, context);
            if (!check.allowed) {
                this.text.status.text = check.message;
            }
            return;
        }
        const quantity = await this.quantityDialog.show(
            { verb: 'Buy', initial: max, max });
        if (!quantity) {
            return;
        }
        let bought = 0;
        if (!hasPurchaseSideEffects(outfit)) {
            // No per-unit side effects (ammo, plain equipment): the gates
            // are monotone in count, so the quantity the dialog clamped to
            // (via maxBuyCount) is buyable as a block. One re-check against
            // the live context, then one bulk apply — not 2000 rounds of
            // makeContext + canBuyOutfit + applyBuy, which lagged the game
            // for half a second on a big ammo buy.
            const live = this.makeContext();
            const n = live ? Math.min(quantity, maxBuyCount(outfit, live)) : 0;
            if (n > 0) {
                this.applyBuy(outfit, n);
                bought = n;
            }
        } else {
            while (bought < quantity) {
                const step = this.makeContext();
                if (!step || !canBuyOutfit(outfit, step).allowed) {
                    break;
                }
                this.applyBuy(outfit);
                bought++;
            }
        }
        this.refreshGrid();
        this.setFreeMassText();
        this.refreshTradeState();
        if (bought > 0 && !this.text.status.text) {
            this.text.status.text = `Bought ${bought} x ${outfit.name}.`;
        }
    }

    private sellOutfit(click?: ButtonClick) {
        if (click?.option) {
            // Option+click: the bulk quantity dialog.
            void this.bulkSell();
            return;
        }
        const outfit = this.itemGrid?.selection;
        const context = this.makeContext();
        if (!outfit || !context) {
            return;
        }

        const check = canSellOutfit(outfit, context);
        if (!check.allowed) {
            // Selling something not aboard is meaningless even for debug.
            if (!(check.reason !== 'notOwned'
                && this.debugOverride(click, check.message))) {
                this.text.status.text = check.message;
                return;
            }
        }

        this.applySell(outfit);
        this.refreshGrid();
        this.setFreeMassText();
        this.refreshTradeState();
    }

    /**
     * The shift+click DEBUG override (DEBUG_FLAGS.tradeOverride): a refused
     * buy/sell goes through anyway and the status line says so, naming the
     * rule it overrode. Display-local: it only changes what this player asks
     * for; the resulting outfit state reaches the sim the normal way.
     */
    private debugOverride(click: ButtonClick | undefined,
        refusal: string): boolean {
        if (!DEBUG_FLAGS.tradeOverride || !click?.shift) {
            return false;
        }
        this.text.status.text = `DEBUG override (shift+click): ${refusal}`;
        return true;
    }

    /** The option-click bulk sell: prefilled with everything owned. */
    private async bulkSell() {
        const outfit = this.itemGrid?.selection;
        const context = this.makeContext();
        if (!outfit || !context) {
            return;
        }
        const max = maxSellCount(outfit, context);
        if (max <= 0) {
            const check = canSellOutfit(outfit, context);
            if (!check.allowed) {
                this.text.status.text = check.message;
            }
            return;
        }
        const quantity = await this.quantityDialog.show(
            { verb: 'Sell', initial: max, max });
        if (!quantity) {
            return;
        }
        let sold = 0;
        while (sold < quantity) {
            const step = this.makeContext();
            if (!step || !canSellOutfit(outfit, step).allowed) {
                break;
            }
            this.applySell(outfit);
            sold++;
        }
        this.refreshGrid();
        this.setFreeMassText();
        this.refreshTradeState();
        if (sold > 0 && !this.text.status.text) {
            this.text.status.text = `Sold ${sold} x ${outfit.name}.`;
        }
    }

    private setOutfitSelected(outfitTile: ItemTile<OutfitData> | undefined) {
        // Set Picture
        this.pictContainer.removeChildren();
        this.text.description.text = "";
        this.text.price.text = "";
        this.text.status.text = "";
        this.text.mass.visible = false;
        this.text.itemMass.visible = false;
        this.text.availableMass.visible = false;
        this.text.freeMass.visible = false;

        if (!outfitTile) {
            return;
        }

        if (outfitTile.largePict) {
            this.pictContainer.addChild(outfitTile.largePict);
        }

        // Set Description
        this.text.description.text = resolveConditionalBlocks(
            outfitTile.item.desc,
            makeDescTextContext(this.controlBits, playerGender()));

        // Set price text -- the same figure the Buy button charges
        // (outfitter_rules' outfitPrice; no ränk PriceMod, see price_mod.ts;
        // scaled by the docked hull's mass for oütf 0x0200).
        this.text.price.text = formatPrice(
            outfitPrice(outfitTile.item, this.shipData));

        // The tonnage as installed on THIS hull (oütf 0x0400 scales it):
        // the carbon-fibre capture reads "Item Mass: 1 ton" on a mass-25
        // hull for an item whose written Mass is also 1, which the
        // rounding ruling in installedOutfitMass reproduces.
        const mass = installedMass(outfitTile.item, this.shipData);
        if (mass > 0) {
            // Set mass text
            this.text.mass.text = formatMass(mass);
            this.setFreeMassText();
            this.text.mass.visible = true;
            this.text.itemMass.visible = true;
            this.text.availableMass.visible = true;
            this.text.freeMass.visible = true;
        }
        this.refreshTradeState();
    }

    private setFreeMassText() {
        const context = this.makeContext();
        if (context) {
            this.text.freeMass.text = formatMass(freeMass(context));
        }
    }

    override async show(input: Entity): Promise<Entity> {
        // Build a mission session so outfit set strings can run the
        // mission operators. Built before setInput seeds the working
        // copies; a failure just leaves set strings on the bit-only path.
        this.missionSession = undefined;
        try {
            const universe = MissionUniverse.shared(this.simulationData);
            // The planet id is only used for offer context (Sxxx
            // destination resolution); the entity carries the accepted-at
            // stellar, so a placeholder is fine for outfitter-run scripts.
            this.missionSession = await MissionSession.create(
                input, this.simulationData, universe, '<outfitter>');
        } catch (e) {
            console.warn('Outfitter mission session unavailable:', e);
        }
        return super.show(input);
    }

    protected override setInput(input: Entity) {
        super.setInput(input);
        // A fresh visit: clear same-visit purchase tracking so no prior
        // visit's purchases still qualify for the full refund.
        this.visitPurchases.clear();
        // Share the mission session's working copies so purchases and
        // mission set strings mutate the same bits/outfits/records.
        if (this.missionSession) {
            const session = this.missionSession;
            this.outfits = new DefaultMap(() => 0, [...session.outfits]);
            this.controlBits = session.state.bits;
            this.records = session.state.records ?? new Map();
            // Share the session's working credits so buys/sells and any
            // mission-set payout mutate the same balance session.commit()
            // persists (mirrors the outfits/bits sharing above).
            this.credits = session.state.credits;
            // The balance the working copy was seeded from, whichever path
            // seeded it: done() commits the difference from THIS, not the
            // absolute (credit_commit.ts). Read off the working copy rather
            // than the entity, because the session snapshotted it in show()
            // — a frame (and an escort-deal settlement) may have passed
            // between the two.
            this.creditsBaseline = this.credits.credits;
            this.updateCreditsText();
            this.shipData = undefined;
            const shipId = input.components.get(ShipComponent)?.id;
            if (shipId) {
                this.simulationData.data.Ship.get(shipId).then(shipData => {
                    if (this.input === input) {
                        this.shipData = shipData;
                        this.refreshGrid();
                        this.setFreeMassText();
                        this.refreshTradeState();
                    }
                });
            }
            this.text.status.text = "";
            this.refreshGrid();
            return;
        }
        const outfitsState = input.components.get(OutfitsStateComponent)
            ?? new Map();
        this.outfits = new DefaultMap(() => 0, [...outfitsState].map(
            ([k, v]) => [k, v.count]));
        this.controlBits = new Set(
            input.components.get(ControlBitsComponent) ?? []);
        this.records = new Map(
            input.components.get(LegalRecordsComponent) ?? []);
        this.creditsBaseline = creditBalance(input);
        this.credits = { credits: this.creditsBaseline };
        this.updateCreditsText();
        this.text.status.text = "";

        this.shipData = undefined;
        const shipId = input.components.get(ShipComponent)?.id;
        if (shipId) {
            this.simulationData.data.Ship.get(shipId).then(shipData => {
                // Ignore stale loads after the input changes.
                if (this.input === input) {
                    this.shipData = shipData;
                    this.refreshGrid();
                    this.setFreeMassText();
                    this.refreshTradeState();
                }
            });
        }
        this.refreshGrid();
    }

    /**
     * The live working state for the docked status bar: the not-yet-committed
     * credit balance, so the bar's Credits readout follows each buy/sell
     * before Done commits it. (Cargo capacity can shift with a freeCargo
     * outfit, but that is left to the entity baseline.)
     */
    dockedStatus(): DockedLiveStatus {
        return { credits: this.credits.credits };
    }

    /**
     * Commits the visit. Both paths route the credit write through
     * {@link commitVenueCredits}, so what lands on the entity is what this
     * visit SPENT or EARNED applied over whatever the balance is now —
     * never the stale absolute the working copy started from. An escort
     * deal that settled while the outfitter was open wrote the live
     * component directly; credit_commit.ts documents the whole seam.
     */
    protected override done() {
        if (this.missionSession) {
            // Push the final outfit counts into the session, then commit
            // it — that writes outfits, bits, records, and any mission /
            // cargo / credits / date changes an Sxxx/Axxx/Fxxx caused.
            const session = this.missionSession;
            session.outfits.clear();
            for (const [id, count] of this.outfits) {
                if (count > 0) {
                    session.outfits.set(id, count);
                }
            }
            this.creditsBaseline = commitVenueCredits(
                this.input, this.creditsBaseline, () => session.commit());
            super.done();
            return;
        }
        this.input.components.set(OutfitsStateComponent, new Map(
            [...this.outfits]
                .filter(([, count]) => count > 0)
                .map(([id, count]) => [id, { count }])));
        this.input.components.set(ControlBitsComponent, this.controlBits);
        this.input.components.set(LegalRecordsComponent, this.records);
        this.creditsBaseline = commitVenueCredits(
            this.input, this.creditsBaseline,
            () => this.input.components.set(CreditsComponent,
                { credits: this.credits.credits }));
        super.done();
    }
}

/**
 * A tonnage as the outfitter's info pane prints it. Singular for exactly
 * one ton: outfitter/earth_outfitter_carbon_fiber_cant_hold_any_more.png
 * reads "Item Mass:  1 ton" against "Available:  0 tons" in the same
 * pane, so the plural is not unconditional.
 */
export function formatMass(m: number) {
    return `${m.toLocaleString()} ${m === 1 ? 'ton' : 'tons'}`;
};
