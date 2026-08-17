import { OutfitData } from 'novadatainterface/outfit_data';
import { ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import * as PIXI from 'pixi.js';
import { Observable } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/controls_plugin.js';
import { ShipComponent } from '../nova_plugin/ship_plugin.js';
import {
    ActiveRanksComponent, ControlBitsComponent,
} from '../nova_plugin/ncb_plugin.js';
import { rankContribute } from '../nova_plugin/rank_logic.js';
import { MissionUniverse } from './mission_universe.js';
import { numericId } from '../nova_plugin/mission_logic.js';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import { GameDateComponent } from '../nova_plugin/player_state_plugin.js';
import { makeDescTextContext, playerGender, resolveConditionalBlocks }
    from '../nova_plugin/desc_text.js';
import { Button } from './button.js';
import { ItemGrid, ItemTile } from './item_grid.js';
import { Menu } from './menu.js';
import { FONT } from './outfitter.js';
import { ShipInfoDialog } from './ship_info.js';
import {
    SHIPYARD_BUTTONS,
    SHIPYARD_PRICE_COLUMNS,
    SHIPYARD_PRICE_LABELS,
    SHIPYARD_PRICE_ROWS,
    ShipyardButtonSpec,
    ShipyardPriceReadout,
    shipyardPriceReadout,
} from './shipyard_content.js';
import {
    buildPurchasedShip,
    canBuyShip,
    purchaseContextFrom,
    ShipPurchaseContext,
} from './shipyard_rules.js';
import { DeployedOutfitCounts } from './deployed_outfits.js';
import { dayNumber } from '../nova_plugin/calendar.js';
import { getDefaultGameDate } from 'novadatainterface/player_start_data';
import {
    canBuyShip as canBuyStockShip,
    ShipyardContext,
    ShipyardStellar,
    visibleShips,
} from './shipyard_stock_rules.js';

export class Shipyard extends Menu<Entity> {
    private pictContainer = new PIXI.Container();
    itemGrid?: ItemGrid<ShipData>;
    private shipInfo: ShipInfoDialog;
    /**
     * Every outfit in the game, loaded once in build(). The purchase
     * rules need each owned outfit's price and persistence flag, and the
     * valuation must not depend on which outfits happen to be cached.
     */
    private allOutfits = new Map<string, OutfitData>();
    /** The ShipData of the hull the player is currently flying. */
    private currentShipData?: ShipData;
    /**
     * The docked stellar's tech level / SpecialTech (see setPlanet).
     * Absent means "no shipyard context", under which every ship is stocked
     * (see ShipyardContext.planet — the same fallback the outfitter
     * uses so headless tests stay free of stellar boilerplate).
     */
    private planet?: ShipyardStellar;
    /** The docked stellar's global id, for the deterministic
     * BuyRandom roll. */
    private stellarId?: string;
    /**
     * The spaceport's owned-but-not-aboard provider, set once per landing
     * (Spaceport.setDeployedOutfitCounts). Resolved fresh on every
     * purchaseContext() call rather than snapshotted, because a fighter can
     * still be shot down or touch down mid-visit.
     */
    private deployedOutfitCounts?: DeployedOutfitCounts;
    private text = {
        description: new PIXI.Text("", FONT.normal),
        // The price pane under the ship picture. Labels and values in
        // two columns, in the original's wording and row order — see
        // shipyard_content.ts for the reference shot it is measured
        // against.
        shipPriceLabel: new PIXI.Text(SHIPYARD_PRICE_LABELS.shipPrice,
            FONT.normal),
        shipPrice: new PIXI.Text("", FONT.normal),
        tradeInLabel: new PIXI.Text(SHIPYARD_PRICE_LABELS.tradeIn, FONT.normal),
        tradeIn: new PIXI.Text("", FONT.normal),
        finalPriceLabel: new PIXI.Text(SHIPYARD_PRICE_LABELS.finalPrice,
            FONT.normal),
        finalPrice: new PIXI.Text("", FONT.normal),
        youHaveLabel: new PIXI.Text(SHIPYARD_PRICE_LABELS.youHave, FONT.normal),
        youHave: new PIXI.Text("", FONT.normal),
        // The denial caption, mirroring the outfitter's status line.
        status: new PIXI.Text("", { ...FONT.normal, wordWrapWidth: 145 }),
    }
    private buttons: { info: Button, buy: Button, done: Button };

    constructor(displayAssets: DisplayAssetDataInterface,
        simulationData: SimulationGameDataInterface,
        controlEvents: Observable<ControlEvent>) {
        super(displayAssets, simulationData, "nova:8502", controlEvents);
        this.container.name = 'Shipyard';
        // Captions, widths and positions measured against the original
        // (shipyard_content.ts). The middle pill says "Buy Ship" and is
        // wider than Info, as the reference shows.
        const makeButton = (spec: ShipyardButtonSpec) => new Button(
            displayAssets, spec.label, spec.width, { x: spec.x, y: spec.y });
        const buttons = {
            info: makeButton(SHIPYARD_BUTTONS.info),
            buy: makeButton(SHIPYARD_BUTTONS.buy),
            done: makeButton(SHIPYARD_BUTTONS.done),
        };
        this.buttons = buttons;
        this.addButtons(buttons);

        buttons.info.click.subscribe(() => void this.showInfo());
        buttons.buy.click.subscribe(this.buyShip.bind(this));
        buttons.done.click.subscribe(this.done.bind(this));

        this.shipInfo = new ShipInfoDialog(displayAssets, simulationData,
            controlEvents);
        this.container.addChild(this.shipInfo.container);

        this.text.description.position.x = -27;
        this.text.description.position.y = -150;
        this.text.status.position.x = -27;
        this.text.status.position.y = 100;

        // The price pane, measured against
        // shipyard/earth_spaceport.png (see shipyard_content.ts for the
        // columns and row rhythm).
        const rows = [
            [this.text.shipPriceLabel, this.text.shipPrice, 'shipPrice'],
            [this.text.tradeInLabel, this.text.tradeIn, 'tradeIn'],
            [this.text.finalPriceLabel, this.text.finalPrice, 'finalPrice'],
            [this.text.youHaveLabel, this.text.youHave, 'youHave'],
        ] as const;
        for (const [label, value, field] of rows) {
            const y = SHIPYARD_PRICE_ROWS[field];
            label.position.set(SHIPYARD_PRICE_COLUMNS.label, y);
            value.position.set(SHIPYARD_PRICE_COLUMNS.value, y);
        }

        for (const t of Object.values(this.text)) {
            this.container.addChild(t);
        }
        // x 175 (not 174): sweeping our capture of this very pane against
        // shipyard/earth_spaceport.png -- both showing the same Shuttle
        // PICT -- bottoms out at dx = -1 (5.9% differing pixels, against
        // 10.0% at dx = 0), i.e. ours sat one pixel left of the original's.
        this.pictContainer.position.x = 175;
        this.pictContainer.position.y = -152.5;
        this.container.addChild(this.pictContainer);
        this.build();
    }

    protected override async build() {
        await super.build();
        await this.loadOutfits();
        const itemGrid = await this.makeShipsGrid();
        this.itemGrid = itemGrid;
        this.container.addChild(itemGrid.container);

        this.itemGrid.drawGrid();
        this.itemGrid.container.position.x = -373;
        this.itemGrid.container.position.y = -153;
        this.itemGrid.activeTile.subscribe(this.setShipSelected.bind(this));

        this.controls.controls = {
            left: () => itemGrid.left(),
            right: () => itemGrid.right(),
            up: () => itemGrid.up(),
            down: () => itemGrid.down(),
            buy: this.buyShip.bind(this),
            depart: this.done.bind(this),
        };
    }

    /** Every ship loaded once, as the grid's pool (see refreshGrid). */
    private allShips: ShipData[] = [];

    private async makeShipsGrid() {
        const ids = (await this.simulationData.ids).Ship;
        const ships = await Promise.all(ids.map(id =>
            this.simulationData.data.Ship.get(id, 100)));
        this.allShips = ships;
        const itemGrid = new ItemGrid(this.displayAssets,
            visibleShips(ships, this.stockContext()));
        return itemGrid;
    }

    /**
     * The stellar being visited, supplying the tech level / SpecialTech
     * rules that decide which ships this shipyard stocks. Set by the
     * Spaceport once its planet data loads (the shipyard's analogue of
     * outfitter.setPlanet). Absent means "no shipyard context", under
     * which every ship is stocked.
     */
    setPlanet(planet: ShipyardStellar, stellarId: string) {
        this.planet = planet;
        this.stellarId = stellarId;
    }

    /**
     * Repopulates the grid from the current context (docked stellar,
     * control bits, contribute, day). Called from setInput (every time the
     * shipyard opens) so the Availability / Require / per-day BuyRandom
     * gates reflect the player standing here today. Not called from
     * refreshTradeState: repopulating re-emits the active tile, which calls
     * back into refreshTradeState, and the two would recurse (the same
     * reason the outfitter's refreshGrid is separate).
     */
    private refreshGrid() {
        if (!this.itemGrid) {
            return;
        }
        this.itemGrid.setItems(visibleShips(this.allShips,
            this.stockContext()));
    }

    /**
     * The docked-shipyard gate context (tech, control bits, contribute,
     * day, stellar id) for the current player and day.
     */
    private stockContext(): ShipyardContext {
        const day = dayNumber(this.input?.components.get(GameDateComponent)
            ?? getDefaultGameDate());
        return {
            planet: this.planet,
            bits: this.input?.components.get(ControlBitsComponent) ?? new Set(),
            contribute: this.playerContributeBits(),
            day,
            stellarId: this.stellarId ? numericId(this.stellarId) : null,
        };
    }

    /**
     * The player's 64-bit Contribute set: their current hull's contribute
     * or'd with the contribute sets of every owned outfit.
     */
    private playerContributeBits(): bigint {
        // Plus the active ranks' Contribute (EVN Bible: rank Contribute
        // "can be used to prevent the player from buying certain items ...
        // until achieving a certain rank"), which for the shipyard is what
        // gates rank-restricted hulls.
        const universe = MissionUniverse.shared(this.simulationData);
        let contribute = rankContribute(
            this.input?.components.get(ActiveRanksComponent),
            id => universe.getRank(id));
        contribute |= this.currentShipData
            ? BigInt(this.currentShipData.contribute ?? '0x0') : 0n;
        const outfits = this.input?.components.get(OutfitsStateComponent);
        if (outfits) {
            for (const [id, { count }] of outfits) {
                if (count > 0) {
                    contribute |= BigInt(
                        this.allOutfits.get(id)?.contribute ?? '0x0');
                }
            }
        }
        return contribute;
    }

    /** Loads every outfit once, for the trade-in valuation. */
    private async loadOutfits() {
        try {
            const ids = (await this.simulationData.ids).Outfit;
            const outfits = await Promise.all(ids.map(id =>
                this.simulationData.data.Outfit.get(id)));
            this.allOutfits = new Map(outfits.map(o => [o.id, o]));
        } catch (e) {
            console.warn('Failed to load outfits for ship pricing:', e);
        }
    }

    /**
     * The current ship + outfits + credits the purchase rules price
     * against, or undefined while the current hull's data is still
     * loading (in which case no purchase may proceed).
     */
    private purchaseContext(): ShipPurchaseContext | undefined {
        if (!this.currentShipData || !this.input) {
            return undefined;
        }
        return purchaseContextFrom(this.input, this.currentShipData,
            id => this.allOutfits.get(id), this.deployedOutfitCounts);
    }

    /** See the deployedOutfitCounts field. */
    setDeployedOutfitCounts(counts?: DeployedOutfitCounts) {
        this.deployedOutfitCounts = counts;
    }

    protected override setInput(input: Entity) {
        super.setInput(input);
        this.text.status.text = "";
        this.currentShipData = undefined;
        const shipId = input.components.get(ShipComponent)?.id;
        if (shipId) {
            this.simulationData.data.Ship.get(shipId).then(shipData => {
                // Ignore stale loads after the input changes.
                if (this.input === input) {
                    this.currentShipData = shipData;
                    this.refreshTradeState();
                }
            }).catch(e => console.warn('Failed to load current ship:', e));
        }
        // The grid's Availability / Require / BuyRandom gates are
        // per-player and per-day, so repopulate it for this player.
        this.refreshGrid();
        this.refreshTradeState();
    }

    /**
     * Re-quotes the price pane, greys the Buy button for a ship the
     * player cannot BUY (stock gate or affordability), and shows the denial
     * caption as the outfitter does for outfits.
     *
     * Every path that can change either the quote or its answer runs
     * this: a new selection (setShipSelected), a new input entity or its
     * ShipData arriving (setInput), and a completed purchase (buyShip) —
     * which is what makes a second trade in the same visit quote against
     * the hull just bought and the credits just spent.
     *
     * The stock gate (tech, availability, require, today's BuyRandom) and
     * the affordability gate are the SAME rules the buy path quotes (in
     * buyShip), so the greyed Buy button and the actual purchase can never
     * disagree.
     */
    private refreshTradeState() {
        const ship = this.itemGrid?.selection;
        const context = this.purchaseContext();
        this.setPriceText(shipyardPriceReadout(ship, context));
        if (!ship || !context) {
            this.buttons.buy.state = 'grey';
            return;
        }
        const stockCheck = canBuyStockShip(ship, this.stockContext());
        const check = canBuyShip(ship, context);
        this.buttons.buy.state =
            (stockCheck.allowed && check.allowed) ? 'normal' : 'grey';
        if (stockCheck.allowed) {
            this.text.status.text = check.allowed ? '' : check.message;
        } else {
            this.text.status.text = stockCheck.message;
        }
    }

    /**
     * Writes the price pane, or blanks it (labels and all, as the
     * original's empty info pane does) when there is nothing to quote.
     */
    private setPriceText(readout: ShipyardPriceReadout | undefined) {
        const fields = ['shipPrice', 'tradeIn', 'finalPrice', 'youHave'] as const;
        for (const field of fields) {
            this.text[field].text = readout?.[field] ?? "";
            this.text[field].visible = readout !== undefined;
            this.text[`${field}Label` as const].visible = readout !== undefined;
        }
    }

    private setShipSelected(shipTile: ItemTile<ShipData> | undefined) {
        this.pictContainer.removeChildren();
        if (!shipTile) {
            // Nothing selected: clear the description and blank the
            // price pane rather than leave the last ship's quote up.
            this.text.description.text = "";
            this.refreshTradeState();
            return;
        }

        if (shipTile.largePict) {
            this.pictContainer.addChild(shipTile.largePict);
        }

        // Set Description
        this.text.description.text = resolveConditionalBlocks(
            shipTile.item.desc,
            makeDescTextContext(
                this.input.components.get(ControlBitsComponent) ?? [],
                playerGender()));
        this.refreshTradeState();
    }

    /** Opens the ship info dialog for the selected ship. */
    private async showInfo() {
        const ship = this.itemGrid?.selection;
        if (!ship) {
            return;
        }
        this.controls.unbind();
        // Re-adding moves the dialog to the top of the shipyard's
        // display list, so it draws over the ship grid.
        this.container.addChild(this.shipInfo.container);
        await this.shipInfo.show(ship);
        this.controls.bind();
    }

    private buyShip() {
        const newShip = this.itemGrid?.selection;
        if (!newShip) {
            return;
        }
        const multiplayerData = this.input.components.get(MultiplayerData);
        if (!multiplayerData) {
            console.warn('Missing multiplayer data for prior ship.');
            return;
        }
        const context = this.purchaseContext();
        if (!context) {
            // Ship or outfit data still loading; refuse rather than
            // charge a price computed from an incomplete valuation.
            return;
        }
        // The stock gate (tech, availability, require, today's BuyRandom)
        // is re-quoted here, not just trusted from the greyed button — the
        // keyboard shortcut path reaches this line directly.
        const stockCheck = canBuyStockShip(newShip, this.stockContext());
        if (!stockCheck.allowed) {
            this.text.status.text = stockCheck.message;
            return;
        }
        const check = canBuyShip(newShip, context);
        if (!check.allowed) {
            // Affordability is already reflected in the greyed Buy
            // button; this covers the keyboard shortcut path too.
            this.text.status.text = check.message;
            return;
        }
        // Swapping this.input is how a ship purchase is communicated:
        // Menu.done() emits it, and the Spaceport re-runs the stat
        // providers on the entity it gets back (spaceport.ts).
        this.input = buildPurchasedShip(this.input, newShip, context);
        // The hull just bought is what a SECOND purchase in this same
        // visit trades in, so the valuation must follow it immediately
        // rather than keep pricing against the ship we no longer own.
        this.currentShipData = newShip;

        this.text.status.text = "";
        this.refreshTradeState();
        // For convenience
        (window as any).myShip = this.input;
    }
}
