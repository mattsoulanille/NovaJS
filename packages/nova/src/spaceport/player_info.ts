import { ShipData, ShipPhysics } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { formatDate } from '../nova_plugin/calendar.js';
import { CargoComponent } from '../nova_plugin/cargo_plugin.js';
import { ControlEvent } from '../nova_plugin/controls_plugin.js';
import { ArmorComponent, FuelComponent, ShieldComponent } from '../nova_plugin/health_plugin.js';
import { cargoName, missionCargoKey } from '../nova_plugin/mission_logic.js';
import { OutfitsState, OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import { CreditsComponent, GameDateComponent, MissionsComponent } from '../nova_plugin/player_state_plugin.js';
import { combatRatingName, legalStatusName, recordWith } from '../nova_plugin/reputation.js';
import { GovtData } from 'novadatainterface/govt_data';
import { CombatRatingComponent, LegalRecordsComponent } from '../nova_plugin/reputation_plugin.js';
import { deriveShipPhysics, ShipComponent, ShipPhysicsComponent } from '../nova_plugin/ship_plugin.js';
import { Button } from './button.js';
import { frameOrigin, INK_TO_BOX } from './hail_layout.js';
import { MenuControls } from './menu_controls.js';
import {
    computeCargoCapacity, loadPayrollShips, playerPayroll,
} from './mission_session.js';
import { DailyBudget, dailyBudget } from './daily_budget.js';
import { ActiveRanksComponent } from '../nova_plugin/ncb_plugin.js';
import { activeRankData } from '../nova_plugin/rank_logic.js';
import { RankData } from 'novadatainterface/rank_data';
import { displayName } from '../nova_plugin/display_name.js';

// The player-info dialog composes the three PICTs 8518 (top strip,
// 413x40, tab row) / 8519 (black content pane, tiled to the content
// height) / 8520 (bottom strip, 413x40, Done row).
//
// Everything below was measured on the p_properties/*.png references
// (1920x1080) by correlating the PICTs themselves against them and by
// template-matching the button end-cap sprites (7500/7502 normal,
// 7506/7508 grey):
//
//   - 8518 lands at screen (754,427) and 8520 at (754,614) on ALL FIVE
//     pages, so the dialog is a fixed 413x227 — the content pane is 147
//     tall, not the 150 assumed before (227 = round((1080-227)/2) = 427
//     from the top, i.e. plainly centred).
//   - The four tabs' sprites start at frame x = 7 / 107 / 207 / 307,
//     y = 8, each 99 wide (a 73px middle between two 13px caps) — so
//     TAB_WIDTH is 73, not 66, and the row sits 8px into the strip
//     rather than 10.5.
//   - Done's sprite is at frame (293,195), 73 wide; Jettison Cargo's at
//     (60,195), 124 wide (cargo_with_stuff.png).
//   - Text rows: labels at frame x=9 (left column) and x=209 (right),
//     values 75px further right, first row's ink at frame y=45, 16px
//     pitch (general.png's nine left rows run y=45..173).
const WIDTH = 413;
const TOP_HEIGHT = 40;
const CONTENT_HEIGHT = 147;
const BOTTOM_HEIGHT = 40;
const HEIGHT = TOP_HEIGHT + CONTENT_HEIGHT + BOTTOM_HEIGHT;
// Whole-pixel origin, as the original blits a centred frame — see
// hail_layout.frameOrigin. 413 and 227 are both odd, so -WIDTH/2 would put
// the strips on a half pixel and drag every glyph on them a pixel left.
const { x: ORIGIN_X, y: ORIGIN_Y } = frameOrigin(WIDTH, HEIGHT);

/** Frame-local left edges of the four tab button SPRITES. */
const TAB_X = [7, 107, 207, 307];
const TAB_WIDTH = 73;
/** A Button's sprite starts at container.x + 0.2 (button.ts's LEFT_POS
 * anchors the 13px left cap to END at 13.2), so a measured sprite-left
 * is placed by taking that fifth of a pixel back off. */
const BUTTON_CAP_INSET = 0.2;
const TAB_Y = ORIGIN_Y + 8;
const BOTTOM_BUTTON_Y = ORIGIN_Y + 195;
const DONE_X = 293;
const DONE_WIDTH = 73;
const JETTISON_X = 60;
const JETTISON_WIDTH = 124;

/** Text-box origin sits INK_TO_BOX above the ink it renders; the
 * references' first table row inks at frame y=45. */
const CONTENT_X = ORIGIN_X + 9;
const CONTENT_TOP = ORIGIN_Y + 45 - INK_TO_BOX;
const ROW_HEIGHT = 16;
const VALUE_OFFSET = 75;
const RIGHT_COLUMN_X = ORIGIN_X + 209;

/** Geneva 9.4 — the same bitmap face the comm dialogs and mission popups
 * use (popup_layout's POPUP_FONT), at this dialog's 16px pitch. Row LABELS
 * are dim in the references and the values beside them white. */
const INFO_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 9.4, fill: 0xffffff,
    align: 'left', wordWrap: false, lineHeight: ROW_HEIGHT,
};
const LABEL_FONT: Partial<PIXI.ITextStyle> =
    { ...INFO_FONT, fill: 0xa0a0a0 };
/**
 * The prose pages (Cargo / Extras / Honors) are NOT set on the table's 16px
 * step: cargo_with_stuff.png's three paragraphs ink at frame y = 48 / 72 / 96,
 * a 24px paragraph pitch — one blank line at the font's natural 12px leading,
 * the same pitch the mission popups use (popup_layout.POPUP_LINE_HEIGHT). The
 * table's 16 is an explicit per-row step, not the font's leading.
 */
const PROSE_LINE_HEIGHT = 12;
const PROSE_TOP = ORIGIN_Y + 48 - INK_TO_BOX;
const PROSE_FONT: Partial<PIXI.ITextStyle> = {
    ...INFO_FONT, wordWrap: true, wordWrapWidth: WIDTH - 20,
    lineHeight: PROSE_LINE_HEIGHT,
};

type Page = 'general' | 'cargo' | 'extras' | 'honors';

/**
 * The government whose CrimeTol scales the "Legal Status:" line for a
 * system: its own, or — for an independent system — gövt 128, per the
 * Bible's Appendix II ("if the system is independent, it is based on the
 * first government's [ID 128] crime tolerance"). The same rule keys the
 * record itself (mission_logic's stellarRecord), so the dialog reads the
 * record and the tolerance of ONE government.
 */
export const INDEPENDENT_STATUS_GOVT = 'nova:128';

/**
 * The dialog's "Legal Status:" value for a system: reputation.ts's
 * `legalStatusName` — the very function the starmap prints — over the
 * record and CrimeTol of the system's status government. This used to be a
 * second, CrimeTol-blind tier table of its own, so the map and the 'p'
 * dialog could name the same record differently (#119).
 */
export function systemLegalStatus(record: number,
    govt: { crimeTol: number } | undefined): string {
    return legalStatusName(record, govt?.crimeTol ?? 0);
}

/**
 * The ShipPhysics the player-info dialog reports for the player's ship:
 * the hull's numbers with the ship's CURRENT outfits summed onto them.
 *
 * WHY THIS IS NOT JUST `entity.components.get(ShipPhysicsComponent)`.
 * While the player is landed their entity is out of the world, and the
 * outfitter DELETES ShipPhysicsComponent from it so that takeoff rebuilds
 * it with the new outfit set (spaceport.ts showOutfitter; an outfit
 * granted by an accepted mission does the same, mission_accept.ts). So
 * after any visit to the outfitter the component is simply ABSENT while
 * still docked, and the old `component ?? shipData.physics` fallback
 * printed the BARE HULL's Speed / Accel / Turn — every outfit modifier
 * silently vanished from the General page until the player took off.
 *
 * Re-deriving goes through ship_plugin's deriveShipPhysics, the very
 * function the takeoff deriver uses, over the same outfit state — so the
 * landed numbers are the ones the ship will fly with (player_info_physics_test
 * pins that identity). The result is deliberately NOT attached to the
 * entity: setting a derived component on a DETACHED entity fires no
 * ChangeEvent, which is exactly the off-world staleness the reconciling
 * stat systems in ship_plugin.ts exist to undo.
 *
 * `attached` (the entity's own ShipPhysicsComponent, while it still has
 * one) then the bare hull are the fallbacks for a cold outfit cache —
 * the dialog's load() awaits every owned outfit first, so a miss means
 * an outfit whose data failed to load at all.
 */
export function dialogShipPhysics(gameData: SimulationGameDataInterface,
    shipData?: ShipData, outfits?: OutfitsState,
    attached?: ShipPhysics): ShipPhysics | undefined {
    if (shipData && outfits) {
        const derived = deriveShipPhysics(shipData, gameData, outfits);
        if (derived) {
            return derived;
        }
    }
    return attached ?? shipData?.physics;
}

/**
 * One line of a table page.
 *
 * The ordinary row is a dim `label` in the left column and a white `value`
 * 75px further right (VALUE_OFFSET) — the two-column table the reference
 * screenshots show on both halves of the General page.
 *
 * The BUDGET rows are the exception, and the reference is unambiguous about
 * it. Measured off p_properties/general.png's last row, the ink runs:
 * "Expenses:" at frame x 9..52 in the dim label grey (0xa0a0a0-ish, the
 * screenshot's 192), then "3,300 credits" at 60..121 in white, then
 * "per day" at 126..158 dim again. So the value does NOT start in the value
 * column (which is at 84) — the line simply FLOWS: label, value, tail, each
 * a space apart, with only the middle run white. Hence `flow` and `tail`.
 */
export interface InfoRow {
    /** Dim, left column. */
    label: string;
    /** White. */
    value: string;
    /** Dim text after the value on the same line ("per day"). */
    tail?: string;
    /** Run the value straight on from the label instead of starting it in
     * the value column. */
    flow?: boolean;
}

/**
 * The General page's three physics rows, straight off the physics
 * `dialogShipPhysics` resolved. Turn rate is stored in rad/sec (raw EVN
 * units * 0.3°/sec); speed and acceleration in px/sec (raw * 30/100).
 * Display the original's raw-unit numbers, as the reference does. All
 * three read '-' only when the ship's physics could not be resolved at
 * all (no ship data).
 */
export function physicsRows(physics?: ShipPhysics): InfoRow[] {
    if (!physics) {
        return [{ label: 'Turn Rate:', value: '-' },
            { label: 'Accel Rate:', value: '-' },
            { label: 'Max Speed:', value: '-' }];
    }
    return [
        { label: 'Turn Rate:',
            value: `${Math.round(physics.turnRate * 180 / Math.PI)}°/sec` },
        { label: 'Accel Rate:',
            value: `${Math.round(physics.acceleration * 100 / 30)}` },
        { label: 'Max Speed:',
            value: `${Math.round(physics.speed * 100 / 30)}` },
    ];
}

/**
 * "Shield Status: 100% (150)" — the percentage the original shows, plus the
 * ship's TOTAL shield or armor points in parentheses (Matthew: "let's put
 * the total shields / armor next to Shield Status and Armor Status like we
 * do for energy"). The TOTAL and not "current/max": the parenthesis on the
 * Energy row is a derived capacity figure ("(5 jumps)"), so the matching
 * thing to put here is the capacity too, and the percentage already says
 * where in that capacity the ship is.
 *
 * THE CAPACITY COMES FROM THE DERIVED PHYSICS, not from the Stat's own max,
 * and the percentage is taken against that same number. This is the docked
 * staleness `dialogShipPhysics` exists for, one layer on: while the player
 * is landed the outfitter deletes ShipPhysicsComponent so takeoff rebuilds
 * it, and the Stat's `max` is only reconciled by the stat systems once the
 * ship is back in the world (ship_plugin's shipStatSystem). Reading the
 * stale max would print the shield capacity the player had BEFORE they
 * bought the booster they are standing in the outfitter holding. Taking the
 * percentage against the same max keeps the pair honest: a freshly bought
 * booster reads "95% (44)" — 42 points of shielding in a 44-point envelope,
 * which is exactly what lifts off — rather than a "100%" that is not true of
 * either number.
 *
 * '-' when there is no capacity to report at all (no physics and no stat, or
 * a hull with none of that stat), as the other unresolved rows do.
 */
export function healthStatus(stat?: { current: number, max: number },
    derivedMax?: number): string {
    const max = derivedMax ?? stat?.max;
    if (max === undefined || max <= 0) {
        return '-';
    }
    const current = Math.max(0, Math.min(max, stat?.current ?? max));
    return `${Math.round(100 * current / max)}% (${Math.round(max)})`;
}

/**
 * The budget line under Energy Status, in the reference's own words:
 * "Expenses: 3,300 credits per day".
 *
 * ONE LINE, NOT TWO, and the layout is what settles it. The content pane is
 * 147px tall and the table steps 16px from an ink baseline at frame y=45, so
 * the left column has room for exactly NINE rows (y = 45..173) — and
 * p_properties/general.png uses all nine: the eight fixed rows (Pilot Name
 * through Energy Status) plus one budget line. A tenth row would ink at y=189
 * and land on the 8520 bottom strip, over the Done button. The original's
 * General page is dimensioned for one budget row, so this reports the NET of
 * the day's books and labels it with its sign:
 *
 *     income > expenses   ->  "Income: N credits per day"
 *     expenses > income   ->  "Expenses: N credits per day"
 *
 * That is also the honest reading of the line: it is what a day does to the
 * player's credits, which is exactly what `settleDailyBudget` applies. A
 * pilot drawing a 200 cr salary while paying a 1,100 cr Viper is 900 cr a day
 * worse off, and the line says so.
 *
 * IT ONLY APPEARS WHEN THERE IS SOMETHING TO SAY. The reference pilot pays
 * escorts and draws no salary, so their page shows the Expenses line and
 * nothing else; a pilot with no escorts and no salaried ränk gets the eight
 * rows the dialog has always had, rather than "0 credits per day". Books that
 * happen to balance (a salary that exactly covers the flock) are in that
 * same "nothing happens to your credits" case and print nothing.
 *
 * The numbers are {@link DailyBudget}'s, which is the very computation
 * `advanceEntityDate` settles the player's credits with (daily_budget.ts) —
 * the rate quoted here is the rate charged.
 */
export function budgetRows(budget: DailyBudget): InfoRow[] {
    const net = Math.round(budget.income) - Math.round(budget.expenses);
    if (net === 0) {
        return [];
    }
    return [{
        label: net > 0 ? 'Income:' : 'Expenses:',
        value: `${Math.abs(net).toLocaleString()} credits`,
        tail: 'per day',
        flow: true,
    }];
}

/**
 * The player-info dialog ('p'): four pages — General, Cargo, Extras,
 * Honors — on the 8518/8519/8520 three-part frame, per the
 * p_properties reference screenshots. Toggles from flight and from the
 * spaceport; read-only (the reference's Jettison Cargo button is shown
 * greyed — jettison isn't modeled, and in flight the cargo hold
 * belongs to the simulation).
 */
export class PlayerInfoDialog {
    container = new PIXI.Container();
    private controls: MenuControls;
    private closed = new Subject<void>();
    private tabs: { [page in Page]: Button };
    private jettison: Button;
    private content = new PIXI.Container();
    private page: Page = 'general';
    private entity?: Entity;
    private shipData?: ShipData;
    private cargoCapacity = 0;
    /** Standard cargo names (STR# 4000), loaded on first show. */
    private cargoNames: string[] = [];
    private outfitNames =
        new Map<string, { name: string, price: number, builtIn: boolean }>();
    /** The player's active ranks, loaded on show for the Honors page. */
    private ranks: RankData[] = [];
    /** The same ranks by id, for the General page's salary arithmetic. */
    private rankData = new Map<string, RankData>();
    /** Ship classes of the escorts on the player's payroll, for Expenses. */
    private payrollShips = new Map<string, ShipData>();

    constructor(private displayAssets: DisplayAssetDataInterface,
        private simulationData: SimulationGameDataInterface,
        controlEvents: Observable<ControlEvent>,
        /** The system the player is currently in (for Legal Status). */
        private getSystemId?: () => string | undefined) {
        this.container.name = 'PlayerInfo';
        this.container.visible = false;

        // A modal shield behind the frame, so clicks can't reach the
        // screen underneath while the dialog is up.
        const shield = new PIXI.Graphics()
            .beginFill(0x000000, 0.001)
            .drawRect(-4000, -4000, 8000, 8000)
            .endFill();
        shield.interactive = true;
        this.container.addChild(shield);

        const top = displayAssets.spriteFromPict('nova:8518');
        top.position.set(ORIGIN_X, ORIGIN_Y);
        const middle = new PIXI.TilingSprite(
            displayAssets.textureFromPict('nova:8519'),
            WIDTH, CONTENT_HEIGHT);
        middle.position.set(ORIGIN_X, ORIGIN_Y + TOP_HEIGHT);
        const bottom = displayAssets.spriteFromPict('nova:8520');
        bottom.position.set(ORIGIN_X, ORIGIN_Y + TOP_HEIGHT + CONTENT_HEIGHT);
        top.interactive = middle.interactive = bottom.interactive = true;
        this.container.addChild(top, middle, bottom);

        const tabButton = (label: string, page: Page, slot: number) => {
            const button = new Button(displayAssets, label, TAB_WIDTH, {
                x: ORIGIN_X + TAB_X[slot] - BUTTON_CAP_INSET,
                y: TAB_Y,
            });
            button.click.subscribe(() => this.showPage(page));
            return button;
        };
        this.tabs = {
            general: tabButton('General', 'general', 0),
            cargo: tabButton('Cargo', 'cargo', 1),
            extras: tabButton('Extras', 'extras', 2),
            honors: tabButton('Honors', 'honors', 3),
        };
        for (const tab of Object.values(this.tabs)) {
            this.container.addChild(tab.container);
        }

        // The reference's Jettison Cargo button (cargo page only).
        // Greyed: jettison isn't modeled yet, and the dialog is
        // read-only in flight.
        this.jettison = new Button(displayAssets, 'Jettison Cargo',
            JETTISON_WIDTH,
            { x: ORIGIN_X + JETTISON_X - BUTTON_CAP_INSET, y: BOTTOM_BUTTON_Y });
        this.jettison.state = 'grey';
        this.jettison.container.visible = false;
        this.container.addChild(this.jettison.container);

        const done = new Button(displayAssets, 'Done', DONE_WIDTH,
            { x: ORIGIN_X + DONE_X - BUTTON_CAP_INSET, y: BOTTOM_BUTTON_Y });
        done.click.subscribe(() => this.closed.next());
        this.container.addChild(done.container);

        this.container.addChild(this.content);

        this.controls = new MenuControls(controlEvents, {
            // 'p' toggles the dialog closed again; 'd' backs out too.
            properties: () => this.closed.next(),
            depart: () => this.closed.next(),
        });
    }

    /** Shows the dialog and resolves when the player dismisses it. */
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

    async show(entity: Entity): Promise<void> {
        this.entity = entity;
        try {
            await this.load(entity);
        } catch (e) {
            console.warn('Player info failed to load game data:', e);
        }
        this.showPage(this.page);
        this.container.visible = true;
        this.controls.bind();
        await firstValueFrom(this.closed);
        this.controls.unbind();
        this.container.visible = false;
    }

    private async load(entity: Entity) {
        const shipId = entity.components.get(ShipComponent)?.id;
        this.shipData = shipId
            ? await this.simulationData.data.Ship.get(shipId) : undefined;
        this.cargoCapacity =
            await computeCargoCapacity(entity, this.simulationData);
        if (this.cargoNames.length === 0) {
            const ids = await this.simulationData.ids;
            if (ids.PlayerStart[0]) {
                this.cargoNames = [...(await this.simulationData.data
                    .PlayerStart.get(ids.PlayerStart[0])).cargoNames];
            }
        }
        // The player's active ranks, for the Honors page. Only the ones
        // they actually hold are fetched — the set is at most a handful.
        const active = entity.components.get(ActiveRanksComponent);
        const loaded = new Map<string, RankData>();
        for (const id of active ?? []) {
            try {
                loaded.set(id, await this.simulationData.data.Rank.get(id));
            } catch {
                // A rank this build cannot resolve is simply not listed.
            }
        }
        this.ranks = activeRankData(active, id => loaded.get(id));
        this.rankData = loaded;

        // The hulls of the escorts drawing a wage, so the General page's
        // "Expenses:" line can price them (mission_session.loadPayrollShips
        // is the same fetch the date advance does before it charges).
        this.payrollShips =
            await loadPayrollShips(entity, this.simulationData);

        // Outfit names and prices, for the Extras page.
        this.outfitNames.clear();
        const outfits = entity.components.get(OutfitsStateComponent);
        if (outfits) {
            for (const id of outfits.keys()) {
                try {
                    const outfit =
                        await this.simulationData.data.Outfit.get(id);
                    this.outfitNames.set(id, {
                        name: outfit.name,
                        price: outfit.price,
                        builtIn: outfit.builtIn,
                    });
                } catch {
                    this.outfitNames.set(id,
                        { name: id, price: 0, builtIn: false });
                }
            }
        }
    }

    private showPage(page: Page) {
        this.page = page;
        // The current page's tab is the greyed one, as in the
        // reference screenshots.
        for (const [name, tab] of Object.entries(this.tabs)) {
            tab.state = name === page ? 'grey' : 'normal';
        }
        // Jettison Cargo only appears on the cargo page and only when
        // there is cargo aboard (compare p_properties/cargo.png — no
        // button — with cargo_with_stuff.png). Greyed: jettison isn't
        // modeled yet.
        const cargo = this.entity?.components.get(CargoComponent);
        const hasCargo = !![...(cargo ?? new Map())]
            .find(([, count]) => count > 0);
        this.jettison.container.visible = page === 'cargo' && hasCargo;
        this.content.removeChildren();
        if (!this.entity) {
            return;
        }
        switch (page) {
            case 'general':
                this.renderGeneral(this.entity);
                break;
            case 'cargo':
                this.renderCargo(this.entity);
                break;
            case 'extras':
                this.renderExtras(this.entity);
                break;
            case 'honors':
                this.renderHonors();
                break;
        }
    }

    private addRows(rows: InfoRow[], x: number) {
        rows.forEach((row, i) => {
            const y = CONTENT_TOP + i * ROW_HEIGHT;
            const labelText = new PIXI.Text(row.label, LABEL_FONT);
            labelText.position.set(x, y);
            this.content.addChild(labelText);
            // A `flow` row is one sentence with a white middle, so each run
            // is placed by MEASURING THE PREFIX of the whole string rather
            // than by adding up the widths of the runs: that is what makes
            // "Expenses:" + " 3,300 credits" + " per day" lay out exactly as
            // the single string would, spaces and kerning included.
            const width = (text: string) => PIXI.TextMetrics.measureText(
                text, new PIXI.TextStyle(LABEL_FONT)).width;
            const valueX = row.flow ? width(row.label) : VALUE_OFFSET;
            const valueText = new PIXI.Text(
                row.flow ? ` ${row.value}` : row.value, INFO_FONT);
            valueText.position.set(x + valueX, y);
            this.content.addChild(valueText);
            if (row.tail !== undefined) {
                const tailText = new PIXI.Text(` ${row.tail}`, LABEL_FONT);
                tailText.position.set(x + (row.flow
                    ? width(`${row.label} ${row.value}`)
                    : valueX + width(row.value)), y);
                this.content.addChild(tailText);
            }
        });
    }

    private addProse(lines: string[]) {
        const text = new PIXI.Text(lines.join('\n\n'), PROSE_FONT);
        text.position.set(CONTENT_X, PROSE_TOP);
        this.content.addChild(text);
    }

    private renderGeneral(entity: Entity) {
        const date = entity.components.get(GameDateComponent);
        const credits = entity.components.get(CreditsComponent);
        const shield = entity.components.get(ShieldComponent);
        const armor = entity.components.get(ArmorComponent);
        const fuel = entity.components.get(FuelComponent);
        const rating = entity.components.get(CombatRatingComponent);
        const records = entity.components.get(LegalRecordsComponent);
        // Re-derived from the ship's current outfits rather than read off
        // the entity, which while landed may have no ShipPhysicsComponent
        // at all — see dialogShipPhysics. load() has already awaited every
        // owned outfit's data, so the cache it reads is warm.
        const physics = dialogShipPhysics(this.simulationData, this.shipData,
            entity.components.get(OutfitsStateComponent),
            entity.components.get(ShipPhysicsComponent));

        const percent = (part?: { current: number, max: number }) =>
            part && part.max > 0
                ? `${Math.round(100 * part.current / part.max)}%` : '-';

        const systemId = this.getSystemId?.();
        // Legal status is with the current system's government (gövt
        // 128's for an independent one), whose id keys the player's
        // legal records and whose CrimeTol scales the tiers.
        let legal = '-';
        if (systemId) {
            const status = this.systemGovtRecord(systemId, records);
            if (status !== undefined) {
                legal = systemLegalStatus(status.record, status.govt);
            }
        }

        const left: InfoRow[] = [
            // Pilot naming isn't modeled (the original shows the
            // save-file pilot's name here).
            { label: 'Pilot Name:', value: '-' },
            { label: 'Current Date:', value: date ? formatDate(date) : '-' },
            { label: 'System:', value: this.systemName ?? '-' },
            { label: 'Legal Status:', value: legal },
            { label: 'Combat Rating:',
                value: combatRatingName(rating?.kills ?? 0) },
            { label: 'Shield Status:',
                value: healthStatus(shield, physics?.shield) },
            { label: 'Armor Status:',
                value: healthStatus(armor, physics?.armor) },
            { label: 'Energy Status:', value: fuel
                ? `${percent(fuel)} (${Math.floor(fuel.current / 100)} jumps)`
                : '-' },
            // "Income:" / "Expenses:", each only when there is one — the
            // reference pilot pays escorts and draws no salary, so
            // general.png shows Expenses alone (budgetRows).
            ...budgetRows(this.budget(entity, credits?.credits ?? 0)),
        ];
        const right: InfoRow[] = [
            // Player ship naming isn't modeled; both rows show the
            // class (the original's Ship Name is the pilot's own).
            { label: 'Ship Name:', value: this.shipData?.name ?? '-' },
            { label: 'Ship Class:', value: this.shipData?.name ?? '-' },
            ...physicsRows(physics),
            { label: 'Credits:',
                value: credits ? credits.credits.toLocaleString() : '-' },
        ];
        this.addRows(left, CONTENT_X);
        this.addRows(right, RIGHT_COLUMN_X);
    }

    /**
     * The player's daily books as of right now — the numbers the Income /
     * Expenses rows print.
     *
     * Deliberately the SAME call the date advance settles credits with
     * (daily_budget.ts's `dailyBudget`, over the same payroll list from
     * `playerPayroll` and the same rank set): what this dialog quotes is
     * what the next landing or jump will actually debit and credit.
     */
    private budget(entity: Entity, credits: number): DailyBudget {
        return dailyBudget({
            ranks: entity.components.get(ActiveRanksComponent),
            getRank: id => this.rankData.get(id),
            escortShips: playerPayroll(entity),
            getShip: id => this.payrollShips.get(id),
        }, credits);
    }

    private systemName?: string;

    /** Loads the current system's name and the player's record there. */
    /**
     * The player's record with the system's status government (see
     * INDEPENDENT_STATUS_GOVT) and that government's data, for the
     * "Legal Status:" row. An absent record reads as the govt's
     * InitialRec, exactly as the simulation reads it (recordWith).
     */
    private systemGovtRecord(systemId: string,
        records?: ReadonlyMap<string, number>):
        { record: number, govt: GovtData | undefined } | undefined {
        // Kick off (or reuse) the async load; the value shows on the
        // next page render if it wasn't ready yet.
        void this.simulationData.data.System.get(systemId).then(system => {
            this.systemName = displayName(system.name);
        }).catch(() => undefined);
        const cached = this.simulationData.data.System.getCached(systemId);
        if (!cached) {
            return records ? { record: 0, govt: undefined } : undefined;
        }
        this.systemName = displayName(cached.name);
        const govtId = cached.govt ?? INDEPENDENT_STATUS_GOVT;
        void this.simulationData.data.Govt.get(govtId).catch(() => undefined);
        const govt = this.simulationData.data.Govt.getCached(govtId);
        return {
            record: recordWith(new Map(records ?? []), govtId, govt),
            govt,
        };
    }

    private renderCargo(entity: Entity) {
        const cargo = entity.components.get(CargoComponent) ?? new Map();
        const missions = entity.components.get(MissionsComponent);
        const lines: string[] = ['Current cargo in your ship:'];
        let held = 0;
        const itemLines: string[] = [];
        for (const [key, count] of cargo) {
            if (count <= 0) {
                continue;
            }
            held += count;
            if (key.startsWith('cargo:')) {
                const index = Number(key.slice('cargo:'.length));
                itemLines.push(`${count} tons of `
                    + `${cargoName(index, this.cargoNames)}.`);
            } else if (key.startsWith('junk:')) {
                itemLines.push(`${count} tons of cargo.`);
            } else {
                // Mission cargo: name it from the active mission that
                // carries it, as the reference does ("Space probe.").
                let named = false;
                if (missions) {
                    for (const [missionId, active] of missions) {
                        if (missionCargoKey(missionId) === key
                            && active.cargoType >= 0) {
                            itemLines.push(cargoName(active.cargoType,
                                this.cargoNames) + '.');
                            named = true;
                            break;
                        }
                    }
                }
                if (!named) {
                    itemLines.push(`${count} tons of mission cargo.`);
                }
            }
        }
        if (itemLines.length === 0) {
            itemLines.push('Nothing.');
        }
        lines.push(itemLines.join('\n'));
        lines.push('Free cargo space: '
            + `${Math.max(0, this.cargoCapacity - held)} tons`);
        this.addProse(lines);
    }

    private renderExtras(entity: Entity) {
        const outfits = entity.components.get(OutfitsStateComponent);
        const parts: string[] = [];
        let outfitValue = 0;
        if (outfits) {
            for (const [id, { count }] of outfits) {
                if (count <= 0) {
                    continue;
                }
                const info = this.outfitNames.get(id);
                // A built-in weapon is part of the hull, not an extra the
                // player bought — and it has no trade-in value, because
                // the shipyard's valuation prices real oütf items.
                if (info?.builtIn) {
                    continue;
                }
                const name = info?.name ?? id;
                parts.push(count > 1 ? `${count} x ${name}` : name);
                outfitValue += (info?.price ?? 0) * count;
            }
        }
        const lines = ['Current extras for your ship:',
            parts.length > 0 ? parts.join(', ') + '.' : 'None.'];
        if (this.shipData) {
            // Trade-in at 25% of the ship's and outfits' original
            // cost (the original's shipyard trade-in rate).
            const tradeIn = Math.floor(
                0.25 * (this.shipData.price + outfitValue));
            lines.push(`Ship trade-in value: `
                + `${tradeIn.toLocaleString()} credits`);
        }
        this.addProse(lines);
    }

    private renderHonors() {
        // "the name of that rank is displayed in the player-info dialog ...
        // Ranks with higher weight are displayed first" (EVN Bible, ränk).
        // The RESOURCE NAME is the full rank name shown here — "The name of
        // the ränk resource is the full name of the rank, displayed in the
        // player-info dialog. example: 'Commission of Space Marshall in the
        // Hector Empire'" — not ConvName, which is the conversational <PRK>
        // form.
        //
        // Stock rank names carry an authoring suffix after a semicolon
        // ("Federation Naval Rank of Commander;Fed 1"), the same convention
        // mission names use; only the part before it is player-facing.
        const names = this.ranks
            .map(rank => rank.name.split(';')[0].trim())
            .filter(name => name.length > 0);
        this.addProse(['Your ranks and honors:',
            names.length > 0 ? names.join('\n') : 'None.']);
    }
}
