import { ShipData } from 'novadatainterface/ship_data';
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
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import { CreditsComponent, GameDateComponent, MissionsComponent } from '../nova_plugin/player_state_plugin.js';
import { combatRatingName } from '../nova_plugin/reputation.js';
import { CombatRatingComponent, LegalRecordsComponent } from '../nova_plugin/reputation_plugin.js';
import { ShipComponent, ShipPhysicsComponent } from '../nova_plugin/ship_plugin.js';
import { Button } from './button.js';
import { frameOrigin, INK_TO_BOX } from './hail_layout.js';
import { MenuControls } from './menu_controls.js';
import { computeCargoCapacity } from './mission_session.js';
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
 * An approximation of the original's legal-status strings (STR# 7100
 * is not parsed yet): classifies the player's legal record with the
 * current system's government. A fresh pilot (record 0) is a
 * "Citizen", as in the p_properties/general.png reference.
 */
export function legalStatusName(record: number): string {
    if (record <= -200) {
        return 'Public Enemy';
    }
    if (record <= -25) {
        return 'Criminal';
    }
    if (record < 0) {
        return 'Offender';
    }
    if (record < 25) {
        return 'Citizen';
    }
    if (record < 100) {
        return 'Good Citizen';
    }
    return 'Pillar of Society';
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

    private addRows(rows: [string, string][], x: number) {
        rows.forEach(([label, value], i) => {
            const labelText = new PIXI.Text(label, LABEL_FONT);
            labelText.position.set(x, CONTENT_TOP + i * ROW_HEIGHT);
            const valueText = new PIXI.Text(value, INFO_FONT);
            valueText.position.set(x + VALUE_OFFSET,
                CONTENT_TOP + i * ROW_HEIGHT);
            this.content.addChild(labelText, valueText);
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
        const physics = entity.components.get(ShipPhysicsComponent)
            ?? this.shipData?.physics;

        const percent = (part?: { current: number, max: number }) =>
            part && part.max > 0
                ? `${Math.round(100 * part.current / part.max)}%` : '-';

        const systemId = this.getSystemId?.();
        // Legal status is with the current system's government. The
        // system's govt id keys the player's legal records.
        let legal = '-';
        if (systemId) {
            const record = this.systemGovtRecord(systemId, records);
            if (record !== undefined) {
                legal = legalStatusName(record);
            }
        }

        const left: [string, string][] = [
            // Pilot naming isn't modeled (the original shows the
            // save-file pilot's name here).
            ['Pilot Name:', '-'],
            ['Current Date:', date ? formatDate(date) : '-'],
            ['System:', this.systemName ?? '-'],
            ['Legal Status:', legal],
            ['Combat Rating:', combatRatingName(rating?.kills ?? 0)],
            ['Shield Status:', percent(shield)],
            ['Armor Status:', percent(armor)],
            ['Energy Status:', fuel
                ? `${percent(fuel)} (${Math.floor(fuel.current / 100)} jumps)`
                : '-'],
        ];
        // Turn rate is stored in rad/sec (raw EVN units * 0.3°/sec);
        // speed and acceleration in px/sec (raw * 30/100). Display the
        // original's raw-unit numbers, as the reference does.
        const degPerSec = physics
            ? Math.round(physics.turnRate * 180 / Math.PI) : undefined;
        const rawSpeed = physics
            ? Math.round(physics.speed * 100 / 30) : undefined;
        const rawAccel = physics
            ? Math.round(physics.acceleration * 100 / 30) : undefined;
        const right: [string, string][] = [
            // Player ship naming isn't modeled; both rows show the
            // class (the original's Ship Name is the pilot's own).
            ['Ship Name:', this.shipData?.name ?? '-'],
            ['Ship Class:', this.shipData?.name ?? '-'],
            ['Turn Rate:', degPerSec !== undefined
                ? `${degPerSec}°/sec` : '-'],
            ['Accel Rate:', rawAccel !== undefined ? `${rawAccel}` : '-'],
            ['Max Speed:', rawSpeed !== undefined ? `${rawSpeed}` : '-'],
            ['Credits:', credits
                ? credits.credits.toLocaleString() : '-'],
        ];
        this.addRows(left, CONTENT_X);
        this.addRows(right, RIGHT_COLUMN_X);
    }

    private systemName?: string;

    /** Loads the current system's name and the player's record there. */
    private systemGovtRecord(systemId: string,
        records?: ReadonlyMap<string, number>): number | undefined {
        // Kick off (or reuse) the async load; the value shows on the
        // next page render if it wasn't ready yet.
        void this.simulationData.data.System.get(systemId).then(system => {
            this.systemName = displayName(system.name);
        }).catch(() => undefined);
        const cached = this.simulationData.data.System.getCached(systemId);
        if (!cached) {
            return records ? 0 : undefined;
        }
        this.systemName = displayName(cached.name);
        if (!cached.govt) {
            return 0;
        }
        return records?.get(cached.govt) ?? 0;
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
