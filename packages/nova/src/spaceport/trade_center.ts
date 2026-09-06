import { JunkData } from 'novadatainterface/junk_data';
import { OopsData } from 'novadatainterface/oops_data';
import { PlanetData } from 'novadatainterface/planet_data';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Observable } from 'rxjs';
import { DockedLiveStatus } from '../display/docked_ship.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/controls_plugin.js';
import { dayNumber } from '../nova_plugin/calendar.js';
import { GameDateComponent } from '../nova_plugin/player_state_plugin.js';
import { activePriceEvents, applyPriceEvents } from '../nova_plugin/price_events.js';
import {
    junkTradeGood,
    otherCargoNames,
    standardTradeGoods,
    TradeGood,
    TradeWorkingState,
} from '../nova_plugin/trade_logic.js';
import { Button, ButtonClick } from './button.js';
import {
    FleetCargoState, FleetEscortEntry, FleetHold, fleetBuy, fleetBuyQuantity,
    fleetCargo, fleetFreeSpace, fleetHeld, fleetSell, fleetSellQuantity,
    freeSpaceLines, maxFleetBuyQuantity, maxFleetSellQuantity,
    quantityColumnHeader, sumFleetCargo,
} from './fleet_cargo.js';
import {
    LINE_HEIGHT, ROW_HEIGHT, SELECTION_COLOR, TRADE, TRADE_ROW_TEXT_DY,
    listRowY,
} from './dialog_layout.js';
import { LandedTransaction, Savepoint } from './landed_transaction.js';
import { Menu } from './menu.js';
import { MissionUniverse } from './mission_universe.js';
import { QuantityDialog } from './quantity_dialog.js';
import { wrapIndex } from './list_selection.js';

// The 426x252 Trade dialog (PICT 8510). All geometry lives in
// dialog_layout.ts, measured against trade_center/*.png (1920x1080).
const LIST_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 9.4, fill: 0xffffff,
    align: 'left', wordWrap: false, lineHeight: LINE_HEIGHT,
};
const RIGHT_FONT: Partial<PIXI.ITextStyle> =
    { ...LIST_FONT, align: 'right' };

/**
 * The exchange's column headers and cargo-summary wording, stock Nova's
 * own (STR# 2002 indices 196-199 and 362-368). "In Hold:" is the
 * no-escort form; a player with cargo-carrying escorts sees "In Fleet:"
 * and a split ship/fleet free-space readout — both live in fleet_cargo.ts
 * (quantityColumnHeader / freeSpaceLines) beside the model that decides
 * which applies.
 */
const HEADER_COMMODITY = 'Commodity:';
const HEADER_PRICE = 'Price:';

/**
 * Which row a good occupies. The original keeps a FIXED slot for each of
 * the six standard commodities whether or not this stellar trades it —
 * Earth doesn't trade Equipment and leaves row 5 empty, putting its
 * Duranium Alloy jünk row on row 6, exactly where Port Kane (which
 * trades all six) puts its own jünk row. Jünk rows follow in list order.
 */
export function tradeSlot(good: TradeGood,
    goods: readonly TradeGood[]): number {
    const standard = /^cargo:(\d+)$/.exec(good.key);
    if (standard) {
        return Number(standard[1]);
    }
    const junks = goods.filter(g => !g.key.startsWith('cargo:'));
    return TRADE.standardSlots + Math.max(0, junks.indexOf(good));
}

/**
 * The exchange's price-event line. The öops resource's own name is only
 * the subject ("An enormous food surplus"); the original completes the
 * sentence from STR# 2002 — index 191 "has", 192 "raised" / 193
 * "lowered", 180 "the price of" — giving the reference's "An enormous
 * food surplus has lowered the price of food."
 * (trade_center_port_kane_with_mission_cargo_and_lower_cost_food_event.png).
 */
export function priceEventSentence(good: TradeGood): string {
    if (!good.event) {
        return '';
    }
    const verb = good.event.direction === 'lower' ? 'lowered' : 'raised';
    return `${good.event.name} has ${verb} the price of `
        + `${good.name.toLowerCase()}.`;
}

/** Tons of mission cargo in the hold ('mission:*' keys). */
export function missionCargoTons(cargo: ReadonlyMap<string, number>): number {
    let tons = 0;
    for (const [key, amount] of cargo) {
        if (key.startsWith('mission:')) {
            tons += amount;
        }
    }
    return tons;
}

/**
 * The commodity exchange (spöb flag 0x2): standard commodities at this
 * stellar's price tiers plus any jünk commodities traded here, bought
 * and sold against the landing's working copy of the player's cargo and
 * credits (landed_transaction.ts). Buy purchases as much as fits and is
 * affordable; Sell sells the whole held quantity — the original's
 * one-click behavior. The visit's edits become the landing's on Done.
 * Mission cargo ('mission:*') is never tradeable; it only counts against
 * free space.
 *
 * The hold traded against is the whole FLEET: the player's ship plus any
 * cargo-carrying escort that landed with them (fleet_cargo.ts). With no
 * such escort the fleet is just the ship and every readout falls back to
 * the solo wording, so this is the same dialog it always was.
 */
export class TradeCenter extends Menu<Entity> {
    private planet?: PlanetData;
    private junks: JunkData[] = [];
    /** All öops price-event resources, matched against this stellar. */
    private oopses: OopsData[] = [];
    /** Standard cargo names (STR# 4000), loaded from any chär. */
    private cargoNames: string[] = [];
    private goods: TradeGood[] = [];
    /**
     * The landing's transaction, attached by the Spaceport; a standalone
     * show() opens one of its own and releases it at Done.
     */
    transaction?: LandedTransaction;
    private visit?: Savepoint;
    private ownsTransaction = false;
    /**
     * The player's own hold, credits and capacity — the transaction's
     * working state itself (MissionWorkingState is a TradeWorkingState),
     * so an Sxxx mission accepted next door and a purchase here edit one
     * Map. A placeholder until a visit opens.
     */
    private state: TradeWorkingState = {
        cargo: new Map(),
        credits: { credits: 0 },
        cargoCapacity: 0,
    };
    /**
     * The cargo-carrying escorts' working holds for this visit, checked
     * out of the landed roster when the exchange opens and leased to the
     * transaction for the visit (see fleet_cargo.ts on why it is a
     * snapshot and not a live getter, and landed_transaction.ts on the
     * lease).
     */
    private get holds(): readonly FleetHold[] {
        return this.transaction?.holds ?? [];
    }
    /**
     * The client's landed-escort roster and the docked ship's uuid, set
     * per-landing by the Spaceport. Unset (single-ship testing, or a
     * landing the client could not attribute) means "no fleet".
     */
    private landedEscorts?: () => readonly FleetEscortEntry[];
    private playerUuid?: string;
    private selectedIndex = 0;
    private listContainer = new PIXI.Container();
    private highlight = new PIXI.Graphics();
    private rowTexts: PIXI.Text[] = [];
    /** Full-width transparent click targets, one per commodity row. */
    private rowHits: PIXI.Container[] = [];
    private buttons: {
        buy: Button, sell: Button, done: Button,
    };
    private quantityDialog: QuantityDialog;

    private text = {
        headerCommodity: new PIXI.Text(HEADER_COMMODITY, LIST_FONT),
        headerHold: new PIXI.Text('', LIST_FONT),
        headerPrice: new PIXI.Text(HEADER_PRICE, LIST_FONT),
        otherCargo: new PIXI.Text('', LIST_FONT),
        freeSpace: new PIXI.Text('', LIST_FONT),
        /** The fleet free-space line, one row under the ship's. */
        freeSpaceFleet: new PIXI.Text('', LIST_FONT),
        // The active price-event description line ("An enormous food
        // surplus has lowered the price of food."), shown persistently.
        event: new PIXI.Text('', LIST_FONT),
        status: new PIXI.Text('', LIST_FONT),
    };
    /** The active price-event description(s), the default status text. */
    private eventText = '';

    constructor(displayAssets: DisplayAssetDataInterface,
        simulationData: SimulationGameDataInterface,
        controlEvents: Observable<ControlEvent>,
        private planetId: string) {
        super(displayAssets, simulationData, 'nova:8510', controlEvents);
        this.container.name = 'TradeCenter';

        this.buttons = {
            buy: new Button(displayAssets, 'Buy', TRADE.button.width,
                { x: TRADE.button.buy, y: TRADE.button.y }),
            sell: new Button(displayAssets, 'Sell', TRADE.button.width,
                { x: TRADE.button.sell, y: TRADE.button.y }),
            done: new Button(displayAssets, 'Done', TRADE.button.width,
                { x: TRADE.button.done, y: TRADE.button.y }),
        };
        // Option+click opens the bulk quantity dialog, as the
        // original's exchange does.
        this.buttons.buy.click.subscribe(click => this.buy(click));
        this.buttons.sell.click.subscribe(click => this.sell(click));
        this.buttons.done.click.subscribe(this.done.bind(this));
        this.addButtons(this.buttons);

        this.quantityDialog = new QuantityDialog(controlEvents);

        // "Commodity:" / "In Hold:" / "Price:" are all LEFT-aligned in
        // the original; only the quantities and prices under them are
        // right-aligned (earth_trade_center.png: the headers start at
        // x792 / x1015 / x1067).
        this.text.headerCommodity.position.set(TRADE.nameX, TRADE.headerY);
        this.text.headerHold.position.set(
            TRADE.quantityHeaderX, TRADE.headerY);
        this.text.headerPrice.position.set(TRADE.tierX, TRADE.headerY);
        this.text.otherCargo.position.set(TRADE.nameX, TRADE.summaryTop);
        this.text.freeSpace.position.set(TRADE.nameX, TRADE.summaryTop);
        this.text.freeSpaceFleet.position.set(
            TRADE.nameX, TRADE.summaryTop + LINE_HEIGHT);
        // The event line sits in the strip below the pane (the reference
        // screenshot's "food surplus" position); transaction feedback
        // shows just under it.
        this.text.event.position.set(
            TRADE.statusText.x, TRADE.statusText.y);
        this.text.status.position.set(
            TRADE.statusText.x, TRADE.statusText.y + LINE_HEIGHT);

        this.container.addChild(this.highlight, this.listContainer);
        for (const t of Object.values(this.text)) {
            this.container.addChild(t);
        }
        // On top of everything, so its modal shield covers the screen.
        this.container.addChild(this.quantityDialog.container);

        this.controls.controls = {
            up: () => this.moveSelection(-1),
            down: () => this.moveSelection(1),
            buy: this.buy.bind(this),
            sell: this.sell.bind(this),
            depart: this.done.bind(this),
        };
    }

    /**
     * Points the exchange at the client's landed-escort roster for this
     * landing, so cargo-carrying escorts join the fleet. Set per-landing
     * (like Spaceport.setDeployedOutfitCounts) because it closes over the
     * docked ship's uuid; `uuid` undefined means the client could not
     * attribute the landing, and the exchange trades the ship alone.
     */
    setLandedEscorts(roster?: () => readonly FleetEscortEntry[],
        playerUuid?: string) {
        this.landedEscorts = roster;
        this.playerUuid = playerUuid;
    }

    /** The player's hold plus this visit's escort holds. */
    private get fleet(): FleetCargoState {
        return { ship: this.state, holds: [...this.holds] };
    }

    private loadPromise?: Promise<void>;

    /**
     * Lazily loads the planet and jünk data. NOT Menu.build: that runs
     * synchronously from the Menu constructor, before this subclass's
     * planetId parameter property is assigned.
     */
    private load(): Promise<void> {
        this.loadPromise ??= (async () => {
            const [planet, ids] = await Promise.all([
                this.simulationData.data.Planet.get(this.planetId),
                this.simulationData.ids,
            ]);
            this.planet = planet;
            this.junks = await Promise.all(ids.Junk.map(
                id => this.simulationData.data.Junk.get(id)));
            this.oopses = await Promise.all(ids.Oops.map(
                id => this.simulationData.data.Oops.get(id)));
            // Standard commodity names (STR# 4000) ride on every chär.
            try {
                if (ids.PlayerStart[0]) {
                    this.cargoNames = [...(await this.simulationData.data
                        .PlayerStart.get(ids.PlayerStart[0])).cargoNames];
                }
            } catch (e) {
                console.warn('Trade center cargo names unavailable:', e);
            }
        })();
        return this.loadPromise;
    }

    override async show(input: Entity): Promise<Entity> {
        try {
            await this.load();
            if (!this.transaction) {
                this.transaction = await LandedTransaction.open(input,
                    this.simulationData,
                    MissionUniverse.shared(this.simulationData), this.planetId);
                this.ownsTransaction = true;
            } else {
                // The hull's cargo capacity as of now (an expansion bought
                // next door counts).
                await this.transaction.refresh();
            }
        } catch (e) {
            console.warn('Trade center failed to load:', e);
            return input;
        }
        if (!this.alive) {
            return input; // Torn down while opening; nothing edited yet.
        }
        const transaction = this.transaction;
        this.state = transaction.state;
        const visit = transaction.savepoint('trade center');
        this.visit = visit;
        try {
            // The escorts that landed with the player and can carry cargo
            // (shïp InherentAI 1/2), checked out for this visit. Empty when
            // there are none, which is what makes every readout below fall
            // back to the solo wording. Leasing them freezes their queued
            // upgrade/sale deals until Done writes the holds back, so a
            // sale cannot splice an escort off the roster while this dialog
            // is still filling its hold (landed_transaction.ts).
            await transaction.leaseFleetHolds(
                this.landedEscorts?.() ?? [], this.playerUuid);
            if (!this.alive) {
                transaction.rollback(visit);
                this.visit = undefined;
                return input;
            }
            return await this.showWithHolds(input);
        } catch (e) {
            // A throw anywhere before Done — a texture that would not load,
            // a widget that would not lay out — drops the visit: its edits
            // are undone and the lease goes with it, so those escorts'
            // deals settle on the next docked frame as they always would.
            transaction.rollback(visit);
            this.visit = undefined;
            throw e;
        }
    }

    /** The rest of show(), with the hold lease held. See show(). */
    private async showWithHolds(input: Entity): Promise<Entity> {
        // The landing's working bits (equal to the entity's at entry: every
        // other visit released before this one opened).
        const bits = this.transaction?.state.bits ?? new Set<number>();
        this.goods = this.planet
            ? standardTradeGoods(this.planet, this.cargoNames) : [];
        // Jünk rows follow the standard commodities, as in the
        // original's exchange listing.
        for (const junk of this.junks) {
            const row = junkTradeGood(junk, this.planetId, bits);
            if (row) {
                this.goods.push(row);
            }
        }
        // Apply any active öops price events to the standard commodities.
        // Prices are keyed to the player's own game date, so this stays a
        // deterministic per-player computation (no shared state, no RNG).
        const date = input.components.get(GameDateComponent);
        if (date) {
            const events = activePriceEvents(
                this.oopses, this.planetId, dayNumber(date), bits);
            this.goods = applyPriceEvents(this.goods, events);
            this.eventText = this.goods.map(priceEventSentence)
                .filter(Boolean).join(' ');
        } else {
            this.eventText = '';
        }
        this.selectedIndex = 0;
        this.text.event.text = this.eventText;
        this.text.status.text = '';
        this.refresh();
        return super.show(input);
    }

    private selectedGood(): TradeGood | undefined {
        return this.goods[this.selectedIndex];
    }

    private moveSelection(delta: number) {
        if (this.goods.length === 0) {
            return;
        }
        this.selectedIndex = wrapIndex(this.selectedIndex, delta,
            this.goods.length);
        this.refresh();
    }

    private buy(click?: ButtonClick) {
        const good = this.selectedGood();
        if (!good || !this.canBuySelected()) {
            return;
        }
        if (click?.option) {
            // Option+click: the bulk quantity dialog.
            void this.bulkBuy(good);
            return;
        }
        const bought = fleetBuy(this.fleet, good);
        this.text.status.text = bought > 0
            ? `Bought ${bought} ton${bought === 1 ? '' : 's'} of ${good.name}.`
            : '';
        this.refresh();
    }

    /**
     * The option-click bulk buy: a quantity dialog prefilled with (and
     * clamped to) the most that fits and is affordable.
     */
    private async bulkBuy(good: TradeGood) {
        // FLEET free space, not the ship's: the reference screenshot
        // (trade_center/buy_quantity.png) prefills 390 on a pilot whose
        // own hold has 15 tons free.
        const max = maxFleetBuyQuantity(this.fleet, good);
        if (max <= 0) {
            return;
        }
        const quantity = await this.quantityDialog.show(
            { verb: 'Buy', initial: max, max });
        if (!quantity) {
            return;
        }
        const bought = fleetBuyQuantity(this.fleet, good, quantity);
        this.text.status.text = bought > 0
            ? `Bought ${bought} ton${bought === 1 ? '' : 's'} of ${good.name}.`
            : '';
        this.refresh();
    }

    private sell(click?: ButtonClick) {
        const good = this.selectedGood();
        if (!good || !this.canSellSelected()) {
            return;
        }
        if (click?.option) {
            // Option+click: the bulk quantity dialog.
            void this.bulkSell(good);
            return;
        }
        const sold = fleetSell(this.fleet, good);
        this.text.status.text = sold > 0
            ? `Sold ${sold} ton${sold === 1 ? '' : 's'} of ${good.name}.`
            : '';
        this.refresh();
    }

    /**
     * The option-click bulk sell: prefilled with the held tonnage, as
     * in the trade_center_hold_option_amount reference screenshot.
     */
    private async bulkSell(good: TradeGood) {
        const max = maxFleetSellQuantity(this.fleet, good);
        if (max <= 0) {
            return;
        }
        const quantity = await this.quantityDialog.show(
            { verb: 'Sell', initial: max, max });
        if (!quantity) {
            return;
        }
        const sold = fleetSellQuantity(this.fleet, good, quantity);
        this.text.status.text = sold > 0
            ? `Sold ${sold} ton${sold === 1 ? '' : 's'} of ${good.name}.`
            : '';
        this.refresh();
    }

    private canBuySelected(): boolean {
        const good = this.selectedGood();
        return !!good && good.canBuy
            && this.state.credits.credits >= good.price
            && fleetFreeSpace(this.fleet) > 0;
    }

    private canSellSelected(): boolean {
        const good = this.selectedGood();
        return !!good && good.canSell && fleetHeld(this.fleet, good.key) > 0;
    }

    /** Redraws the list, summary lines, and button states. */
    private refresh() {
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

        const tierLabel = { low: 'Low', med: 'Med', high: 'High' } as const;
        // The quantity column is a FLEET total when escorts carry cargo
        // (the reference's "In Fleet:" header), otherwise the ship's own.
        const manifest = fleetCargo(this.fleet);
        this.text.headerHold.text = quantityColumnHeader(this.fleet);
        this.goods.forEach((good, index) => {
            const slot = tradeSlot(good, this.goods);
            const y = listRowY(TRADE.listTop, slot,
                slot >= TRADE.standardSlots);
            if (index === this.selectedIndex) {
                // The original's full-width selection bar.
                this.highlight.beginFill(SELECTION_COLOR)
                    .drawRect(TRADE.pane.x, y, TRADE.pane.width,
                        ROW_HEIGHT)
                    .endFill();
            }
            // A full-width transparent hit target so the whole row —
            // everywhere the selection bar renders, not just the column
            // text — selects the commodity. Matches the highlight bounds.
            const hit = new PIXI.Container();
            hit.interactive = true;
            hit.cursor = 'pointer';
            hit.hitArea = new PIXI.Rectangle(
                TRADE.pane.x, y, TRADE.pane.width, ROW_HEIGHT);
            hit.on('pointerdown', () => {
                this.selectedIndex = index;
                this.text.status.text = '';
                this.refresh();
            });
            this.listContainer.addChild(hit);
            this.rowHits.push(hit);
            const held = manifest.get(good.key) ?? 0;
            // A price event replaces the Low/Med/High word with the
            // comparative "Lower"/"Higher", as in the reference.
            const tierWord = good.event
                ? (good.event.direction === 'lower' ? 'Lower' : 'Higher')
                : tierLabel[good.tier];
            const columns: [string, number, number][] = [
                [good.name, TRADE.nameX, 0],
                [held > 0 ? `${held}` : '', TRADE.quantityRight, 1],
                [tierWord, TRADE.tierX, 0],
                [`${good.price.toLocaleString()}`, TRADE.priceRight, 1],
            ];
            for (const [label, x, anchor] of columns) {
                if (!label) {
                    continue;
                }
                const text = new PIXI.Text(label,
                    anchor ? RIGHT_FONT : LIST_FONT);
                text.anchor.x = anchor;
                text.position.set(x, y + TRADE_ROW_TEXT_DY);
                this.listContainer.addChild(text);
                this.rowTexts.push(text);
            }
        });

        // The cargo summary below the list rule. The original stacks
        // "Other cargo: N tons of mission cargo", a blank line, and the
        // free-space readout (trade_center_port_kane_...png: caps at
        // y544 and y568, 24px apart).
        // "Other cargo" reads the FLEET manifest too, so a jünk an escort
        // is hauling that doesn't trade here is still reported. Mission
        // cargo can only ever be the player's own (fleet_cargo.ts).
        const other = otherCargoNames(manifest, this.goods);
        const missionTons = missionCargoTons(manifest);
        this.text.otherCargo.text = missionTons > 0
            ? `Other cargo: ${missionTons} `
            + `ton${missionTons === 1 ? '' : 's'} of mission cargo`
            : other.length > 0 ? `Other cargo: ${other.join(', ')}` : '';
        // One line solo; the reference's split ship/fleet pair once
        // cargo-carrying escorts are along, on consecutive rows.
        const summaryTop = TRADE.summaryTop
            + (this.text.otherCargo.text ? 2 * LINE_HEIGHT : 0);
        const [shipLine, fleetLine] = freeSpaceLines(this.fleet);
        this.text.freeSpace.y = summaryTop;
        this.text.freeSpace.text = shipLine ?? '';
        this.text.freeSpaceFleet.y = summaryTop + LINE_HEIGHT;
        this.text.freeSpaceFleet.text = fleetLine ?? '';

        this.buttons.buy.state = this.canBuySelected() ? 'normal' : 'grey';
        this.buttons.sell.state = this.canSellSelected() ? 'normal' : 'grey';
    }

    /**
     * The live working state for the docked status bar: the not-yet-committed
     * cargo hold, capacity, and credit balance, so the bar's Free and Credits
     * readouts follow each buy/sell before Done commits them.
     *
     * THE WHOLE FLEET, summed here rather than by the status bar: the
     * bar's readout is fleet-wide (Matthew's ruling — see
     * fleet_cargo.ts's sumFleetCargo and the references it cites), and the
     * escort holds this dialog is editing are UNCOMMITTED, so the bar
     * cannot read them off the roster entities as it does for every other
     * venue. Reporting the working fleet is what keeps "Free:" in step
     * with each buy and sell.
     *
     * Note this is deliberately NOT the dialog's own "in your ship" line,
     * which stays the hull's alone.
     */
    dockedStatus(): DockedLiveStatus {
        if (!this.transaction) {
            return {}; // No visit (it failed to open): the bar reads the entity.
        }
        const fleet = sumFleetCargo([
            { cargo: this.state.cargo, capacity: this.state.cargoCapacity },
            ...this.holds,
        ]);
        return {
            credits: this.state.credits.credits,
            cargo: fleet.cargo,
            cargoCapacity: fleet.capacity,
        };
    }

    /**
     * Done: the visit's edits become the landing's. The release writes
     * each escort hold back onto its roster entity — so the escorts lift
     * off carrying what was bought, and a save taken later records it
     * inside their own serialized entities — closes the lease, and (as the
     * outermost visit) writes the cargo and the credits onto the entity,
     * the credits as a DELTA against whatever else moved the balance
     * meanwhile (landed_transaction.ts, credit_commit.ts). The holds are
     * committed and the lease closed in the same synchronous step, so no
     * deal can settle between the two.
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
