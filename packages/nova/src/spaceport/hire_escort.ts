import { Entity } from 'nova_ecs/entity';
import { OutfitData } from 'novadatainterface/outfit_data';
import { ShipData } from 'novadatainterface/ship_data';
import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/controls_plugin.js';
import { makeDescTextContext, playerGender, resolveConditionalBlocks }
    from '../nova_plugin/desc_text.js';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import { ControlBitsComponent } from '../nova_plugin/ncb_plugin.js';
import { ShipComponent } from '../nova_plugin/ship_plugin.js';
import { Button } from './button.js';
import { HIRE } from './dialog_layout.js';
import { ItemGrid, ItemTile } from './item_grid.js';
import { MenuControls } from './menu_controls.js';
import { MissionUniverse } from './mission_universe.js';
import { FONT } from './outfitter.js';
import { hirePrice } from './escort_fees.js';
import { shipGateContext } from './ship_gate_context.js';
import {
    shipHireable, ShipyardContext, ShipyardStellar,
} from './shipyard_stock_rules.js';

/**
 * What the bar says when the day's hire pool comes up empty.
 *
 * This is stock Nova's own wording, verbatim: STR# 2002 ("misc strings")
 * index 223 (0-based) in Nova Data 5.ndat — the direct sibling of the
 * shipyard's "There are no ships available for purchase here." at index
 * 222. Note the hire string has no trailing "here".
 *
 * Kept as the fallback for a data set whose STR# 2002 is missing or too
 * short; `noShipsForHire()` below reads the real string from the table.
 */
export const NO_SHIPS_FOR_HIRE = 'There are no ships available for hire.';

/** The STR# table and index the hire message comes from. */
export const NO_SHIPS_FOR_HIRE_TABLE = 'nova:2002';
export const NO_SHIPS_FOR_HIRE_INDEX = 223;

/**
 * The "no pilots for hire today" message, read from STR# 2002 index 223.
 * Falls back to the constant above when the table is absent.
 */
export async function noShipsForHire(
    displayAssets: DisplayAssetDataInterface): Promise<string> {
    try {
        const table = await displayAssets.data.StringTable.get(
            NO_SHIPS_FOR_HIRE_TABLE);
        const text = table.strings[NO_SHIPS_FOR_HIRE_INDEX];
        return text?.trim() ? text : NO_SHIPS_FOR_HIRE;
    } catch {
        return NO_SHIPS_FOR_HIRE;
    }
}

/**
 * The one-time fee to hire an escort, re-exported from the module that now
 * owns every escort price (spaceport/escort_fees.ts) so the daily wage, the
 * upgrade cost and the resale value can all be derived from the same rule
 * without importing this PIXI-heavy dialog. The bar's own callers — and the
 * price_mod specs — import it from here exactly as before.
 */
export { hirePrice };

/**
 * Who is doing the hiring: the landed player's entity (control bits,
 * owned outfits, active ranks and the game date all come off it) and,
 * optionally, the bar's MissionSession working control bits, so a bit
 * set by a mission accepted this very visit already counts.
 *
 * Everything is optional: a headless harness with no entity gets the
 * "no player context" defaults (no bits, no contribute, day 0), which
 * is the same fallback the shipyard's stock context uses.
 */
export interface HirePlayer {
    entity?: Entity;
    bits?: ReadonlySet<number>;
}

/**
 * The bar's hire-escort dialog, on the shipyard frame (PICT 8501):
 * a grid of pilots for hire, the pilot description (dësc 14000+),
 * the ship pict, and the hiring price against the player's credits.
 *
 * Which ships appear follows the Bible's hire rules, and they are the
 * SHIPYARD's rules with HireRandom swapped in for BuyRandom: the stellar
 * must stock the ship's TechLevel (its own TechLevel or an exact
 * SpecialTech match), the ship's Availability expression must pass
 * against the player's control bits, the player's Contribute must cover
 * its Require bits, and the day's HireRandom roll must come up. All of
 * that is `shipHireable` in shipyard_stock_rules.ts, one module away from
 * the shipyard's `shipAvailableForSale`, so the two shops cannot drift.
 *
 * The day's roll is deterministic (FNV-1a over day|stellar|ship, salted
 * 'hire'), not Math.random: closing and reopening the bar must not reroll
 * the pool, which is both what the original does and what stops
 * "reopen until the Leviathan shows up".
 *
 * Hiring charges the credits working copy (committed when the bar
 * session commits) and records the ship id for browser.ts to spawn
 * on launch (see pending_escorts.ts). Once spawned, the escort is an
 * ordinary escort: it follows through hyperspace and gates
 * (nova_plugin/player_escort_plugin.ts) and is persisted in the save
 * (save_game.ts `escorts`).
 */
export class HireEscortDialog {
    container = new PIXI.Container();
    private controls: MenuControls;
    private closed = new Subject<void>();
    private ships: ShipData[] = [];
    private itemGrid?: ItemGrid<ShipData>;
    private gridContainer = new PIXI.Container();
    private pictContainer = new PIXI.Container();
    private credits: { credits: number } = { credits: 0 };
    private bits?: ReadonlySet<number>;
    private hired: string[] = [];
    private loadPromise?: Promise<void>;
    /** The docked stellar's tech rules, from its PlanetData (see load). */
    private stellar?: ShipyardStellar;
    /**
     * The ränk PriceMod in force in this bar, taken off the same
     * ShipyardContext the hire pool is rolled from (see hireContext) so the
     * quoted fee, the affordability check and the charge share one number.
     */
    private priceMod?: number;

    private text = {
        description: new PIXI.Text('', FONT.normal),
        hiringPrice: new PIXI.Text('Hiring Price:', FONT.normal),
        price: new PIXI.Text('', FONT.normal),
        youHave: new PIXI.Text('You Have:', FONT.normal),
        count: new PIXI.Text('', FONT.normal),
        status: new PIXI.Text('', FONT.normal),
    };
    private buttons: { hire: Button, done: Button };

    constructor(private displayAssets: DisplayAssetDataInterface,
        private simulationData: SimulationGameDataInterface,
        controlEvents: Observable<ControlEvent>,
        private planetId: string) {
        this.container.name = 'HireEscortDialog';
        this.container.visible = false;

        const background = displayAssets.spriteFromPict('nova:8501');
        background.anchor.set(0.5);
        background.interactive = true;
        this.container.addChild(background);

        // Measured off bar/hire_escort/select_escort.png: the pills'
        // red faces run x948..1045 and x1063..1160 at y673. (The
        // original also has an Info button left of them; we have no
        // pilot-info dialog of our own, so that slot stays empty.)
        this.buttons = {
            hire: new Button(displayAssets, 'Hire Escort',
                HIRE.button.hireWidth,
                { x: HIRE.button.hire, y: HIRE.button.y }),
            done: new Button(displayAssets, 'Done', HIRE.button.hireWidth,
                { x: HIRE.button.done, y: HIRE.button.y }),
        };
        this.buttons.hire.click.subscribe(this.hire.bind(this));
        this.buttons.done.click.subscribe(() => this.closed.next());
        for (const button of Object.values(this.buttons)) {
            this.container.addChild(button.container);
        }

        // The shipyard/outfitter panes: grid left, description middle,
        // pict upper right, prices lower right.
        this.gridContainer.position.set(-373, -153);
        this.pictContainer.position.set(174, -152.5);
        this.text.description.position.set(-27, -150);
        // "Hiring Price:" / "You Have:" sit 24px apart, twice the body
        // leading (caps at y598 and y622 on select_escort.png).
        this.text.hiringPrice.position.set(HIRE.label.x, HIRE.label.y);
        this.text.price.position.set(HIRE.valueX, HIRE.label.y);
        this.text.youHave.position.set(
            HIRE.label.x, HIRE.label.y + HIRE.labelPitch);
        this.text.count.position.set(
            HIRE.valueX, HIRE.label.y + HIRE.labelPitch);
        this.text.status.position.set(-170, 118);
        this.container.addChild(this.gridContainer, this.pictContainer);
        for (const t of Object.values(this.text)) {
            this.container.addChild(t);
        }

        this.controls = new MenuControls(controlEvents, {
            left: () => this.itemGrid?.left(),
            right: () => this.itemGrid?.right(),
            up: () => this.itemGrid?.up(),
            down: () => this.itemGrid?.down(),
            buy: this.hire.bind(this),
            hire: this.hire.bind(this),
            depart: () => this.closed.next(),
        });
    }

    /**
     * Every ship class in the data set, plus the docked stellar's tech
     * rules. Loaded once; which of them a PILOT is flying today is decided
     * per opening by {@link rollPool}, because the gates are per-player
     * (control bits, Contribute) and per-day (the HireRandom roll).
     */
    private load(): Promise<void> {
        this.loadPromise ??= (async () => {
            const [planet, ids] = await Promise.all([
                this.simulationData.data.Planet.get(this.planetId),
                this.simulationData.ids,
            ]);
            this.stellar = {
                techLevel: planet.techLevel,
                specialTech: planet.specialTech,
                // Not a stock gate: it is what the ränk PriceMod matches.
                govt: planet.govt,
            };
            this.ships = await Promise.all(ids.Ship.map(
                id => this.simulationData.data.Ship.get(id, 100)));
            this.ships.sort((a, b) => b.displayWeight - a.displayWeight);
        })();
        return this.loadPromise;
    }

    /**
     * The pilots standing at the bar today: the shared shïp stock gates
     * plus the day's HireRandom roll (see the class doc). Pure in its
     * context, so reopening the bar on the same day shows the same people.
     */
    private rollPool(ctx: ShipyardContext): ShipData[] {
        return this.ships.filter(ship => shipHireable(ship, ctx));
    }

    /**
     * The gate context for the player standing in this bar — built by the
     * same assembler the shipyard uses (ship_gate_context.ts). Only the
     * outfits the player actually owns are loaded, since those are the
     * only ones that can contribute.
     */
    private async hireContext(player: HirePlayer): Promise<ShipyardContext> {
        const outfits = new Map<string, OutfitData>();
        const owned = player.entity?.components.get(OutfitsStateComponent);
        await Promise.all([...(owned?.keys() ?? [])].map(async id => {
            try {
                outfits.set(id, await this.simulationData.data.Outfit.get(id));
            } catch {
                // An outfit the data set can't produce contributes nothing.
            }
        }));
        let currentShipData: ShipData | undefined;
        const shipId = player.entity?.components.get(ShipComponent)?.id;
        if (shipId) {
            try {
                currentShipData =
                    await this.simulationData.data.Ship.get(shipId);
            } catch {
                // Same: an unloadable hull contributes nothing.
            }
        }
        // The shared universe (the spaceport's own instance) supplies
        // rank Contribute; load() is idempotent and already resolved by
        // the time the bar is open, but awaiting it keeps the hire pool
        // correct even on the very first opening.
        const universe = MissionUniverse.shared(this.simulationData);
        await universe.load().catch(() => { });
        return shipGateContext(player.entity, {
            planet: this.stellar,
            stellarId: this.planetId,
            currentShipData,
            getOutfit: id => outfits.get(id),
            getRank: id => universe.getRank(id),
            bits: player.bits,
        });
    }

    private setShipSelected(tile: ItemTile<ShipData> | undefined) {
        this.pictContainer.removeChildren();
        this.text.description.text = '';
        this.text.price.text = '';
        this.text.status.text = '';
        if (!tile) {
            this.refreshButtons();
            return;
        }
        if (tile.largePict) {
            this.pictContainer.addChild(tile.largePict);
        }
        this.text.description.text = resolveConditionalBlocks(
            tile.item.pilotDesc || tile.item.desc,
            makeDescTextContext(this.bits ?? [], playerGender()));
        this.text.price.text =
            `${hirePrice(tile.item, this.priceMod).toLocaleString()} cr`;
        this.refreshButtons();
    }

    private refreshButtons() {
        this.text.count.text = `${this.credits.credits.toLocaleString()} cr`;
        const ship = this.itemGrid?.selection;
        this.buttons.hire.state =
            ship && this.credits.credits >= hirePrice(ship, this.priceMod)
                ? 'normal' : 'grey';
    }

    private hire() {
        const ship = this.itemGrid?.selection;
        if (!ship) {
            return;
        }
        const price = hirePrice(ship, this.priceMod);
        if (this.credits.credits < price) {
            this.text.status.text = 'You cannot afford this pilot\'s fee.';
            return;
        }
        this.credits.credits -= price;
        this.hired.push(ship.id);
        this.text.status.text = `${ship.name} hired: the pilot will `
            + `join you in formation when you lift off.`;
        this.refreshButtons();
    }

    /**
     * Shows the dialog. Hire fees settle into `credits` (a working
     * copy the caller commits); hired ship ids append to `hired`.
     *
     * Returns 'empty' WITHOUT opening the shipyard frame when the day's
     * roll turns up no pilots: an empty grid is not what the original
     * shows, it just says so and stays in the bar. The caller presents
     * NO_SHIPS_FOR_HIRE (see bar.ts) rather than this dialog doing it,
     * so the message uses the bar's own popup machinery.
     */
    async show(credits: { credits: number },
        hired: string[],
        player: HirePlayer = {}): Promise<'closed' | 'empty'> {
        this.credits = credits;
        this.hired = hired;
        this.bits = player.bits
            ?? player.entity?.components.get(ControlBitsComponent);
        let pool: ShipData[] = [];
        try {
            await this.load();
            const context = await this.hireContext(player);
            this.priceMod = context.priceMod;
            pool = this.rollPool(context);
        } catch (e) {
            console.warn('Hire escort dialog failed to load:', e);
        }

        if (pool.length === 0) {
            return 'empty';
        }

        this.gridContainer.removeChildren();
        this.itemGrid = new ItemGrid(this.displayAssets, pool);
        this.gridContainer.addChild(this.itemGrid.container);
        this.itemGrid.activeTile.subscribe(this.setShipSelected.bind(this));
        this.itemGrid.drawGrid();

        this.text.status.text = '';
        this.setShipSelected(undefined);

        this.container.visible = true;
        this.controls.bind();
        await firstValueFrom(this.closed);
        this.controls.unbind();
        this.container.visible = false;
        return 'closed';
    }
}
