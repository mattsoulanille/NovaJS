import { ShipData } from 'novadatainterface/ship_data';
import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent, displayName } from '../nova_plugin/core/index.js';
import { Button } from './button.js';
import { MenuControls } from './menu_controls.js';

// The ship-info dialog composes onto the "Ship description + pict" frame
// (PICT 8507, 614x537): the ship's rendered PICT fills the top, its
// full name sits on the dark strip below, and two columns of stats plus
// a Standard Weapons list run underneath, with Done at the bottom right.
// Measured against the shipyard/*_info.png reference screenshots
// (1920x1080).
const WIDTH = 614;
const HEIGHT = 537;
const ORIGIN_X = -WIDTH / 2;
const ORIGIN_Y = -HEIGHT / 2;

// The picture area (the framed region above the name strip).
const PICT_AREA = { x: 0, y: ORIGIN_Y + 210, w: 590, h: 400 };
// The name strip. Its text was 12px too low (ours ran to screen y 716,
// past the strip's own bottom, where shuttle_info.png has the name's ink
// on rows 690-702) and two sizes too small: the original's caps there are
// 13 rows tall, exactly like the spaceport title bar's -- which our 18px
// Geneva already matches -- against 11 rows for the 14px we used.
const NAME_Y = ORIGIN_Y + 414.5;
// The stats block. Measured on shipyard/shuttle_info.png: the seven
// left-column rows (Speed .. Turrets) have their ink tops at screen y
// 719, 731, 743, 755, 767, 779 and 791 -- a flat 12px pitch, not 11.5,
// and the first box top two pixels above the first ink row (540 + 177).
const STATS_TOP = ORIGIN_Y + 445.5;
const ROW_HEIGHT = 12;
const LEFT_LABEL_X = ORIGIN_X + 10;
const LEFT_VALUE_X = ORIGIN_X + 62;
const MID_LABEL_X = ORIGIN_X + 150;
const MID_VALUE_X = ORIGIN_X + 200;
const WEAPONS_X = ORIGIN_X + 268;
const WEAPONS_WIDTH = 260;
const DONE_Y = ORIGIN_Y + 508;
// Measured against shipyard/shuttle_info.png: the reference Done pill spans
// screen x 1163-1243 (an 80px-wide button, wider than the default caption
// width). ORIGIN_X + 503 with width 74 lands our pill on the same rectangle.
const DONE_X = ORIGIN_X + 503;
const DONE_WIDTH = 74;

const NAME_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 18, fill: 0xffffff, align: 'center',
};
const STAT_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 10, fill: 0xffffff, align: 'left',
    wordWrap: false,
};
const WEAPONS_FONT: Partial<PIXI.ITextStyle> = {
    ...STAT_FONT, wordWrap: true, wordWrapWidth: WEAPONS_WIDTH,
};

/**
 * The qualitative acceleration rating shown in the ship info dialog, in
 * the original's raw shïp Accel units. The original's exact bands are
 * not documented; these are calibrated against the reference
 * screenshots (Shuttle 500 = "Good", IDA Frigate 275 = "Average").
 */
function accelRating(raw: number): string {
    if (raw >= 700) return 'Excellent';
    if (raw >= 550) return 'Very Good';
    if (raw >= 400) return 'Good';
    if (raw >= 250) return 'Average';
    if (raw >= 150) return 'Poor';
    return 'Feeble';
}

/**
 * The qualitative turn rating shown in the ship info dialog, in the
 * original's raw shïp Maneuver units. Calibrated against the reference
 * screenshots (Shuttle 40 = "Good", IDA Frigate 30 = "Average").
 */
function turnRating(raw: number): string {
    if (raw >= 70) return 'Excellent';
    if (raw >= 45) return 'Very Good';
    if (raw >= 35) return 'Good';
    if (raw >= 25) return 'Average';
    if (raw >= 15) return 'Poor';
    return 'Feeble';
}

/** "Maximum of N", "None", or the bare count, as the original shows. */
function hardpoints(count: number): string {
    if (count <= 0) return 'None';
    return `Maximum of ${count}`;
}

/**
 * The name the More Info dialog prints on its strip: the shïp Long Name,
 * not the resource name. The three reference captures show
 * "Sigma Shipyards Alpha class Shuttle" (shuttle_info.png),
 * "Sigma Shipyards Epsilon Class Heavy Shuttle"
 * (heavy_shuttle_info.png) and "Old Earth IDA Frigate"
 * (ida_frigate_info.png), where the resources are merely named "Shuttle;
 * Version A", "Heavy Shuttle; Version A" and "IDA Frigate; 350".
 *
 * Falls back to the resource name (minus its "; developer note" suffix)
 * for ships and plug-ins that leave Long Name blank.
 */
export function infoDialogName(
    ship: { name: string, longName?: string }): string {
    return ship.longName?.trim() ? ship.longName : displayName(ship.name);
}

/**
 * The shipyard's Info dialog: shows the selected ship's rendered
 * picture, full name, stats, and standard-weapon loadout over the
 * shipyard, on the 8507 frame. Pointer- and key-driven; resolves when
 * the player dismisses it. Preserves the shipyard beneath it.
 */
export class ShipInfoDialog {
    container = new PIXI.Container();
    private controls: MenuControls;
    private closed = new Subject<void>();
    private pictContainer = new PIXI.Container();
    private content = new PIXI.Container();
    private nameText = new PIXI.Text('', NAME_FONT);

    constructor(private displayAssets: DisplayAssetDataInterface,
        private simulationData: SimulationGameDataInterface,
        controlEvents: Observable<ControlEvent>) {
        this.container.name = 'ShipInfo';
        this.container.visible = false;

        // A modal shield behind the frame, so clicks can't reach the
        // shipyard underneath while the dialog is up.
        const shield = new PIXI.Graphics()
            .beginFill(0x000000, 0.001)
            .drawRect(-4000, -4000, 8000, 8000)
            .endFill();
        shield.interactive = true;
        this.container.addChild(shield);

        const background = this.displayAssets.spriteFromPict('nova:8507');
        background.anchor.set(0.5);
        background.interactive = true;
        this.container.addChild(background);

        this.nameText.anchor.set(0.5, 0);
        this.nameText.position.set(0, NAME_Y);
        this.container.addChild(this.pictContainer, this.nameText,
            this.content);

        const done = new Button(displayAssets, 'Done', DONE_WIDTH,
            { x: DONE_X, y: DONE_Y });
        done.click.subscribe(() => this.closed.next());
        this.container.addChild(done.container);

        this.controls = new MenuControls(controlEvents, {
            depart: () => this.closed.next(),
        });
    }

    /** Shows the dialog for a ship; resolves when it is dismissed. */
    async show(ship: ShipData): Promise<void> {
        this.pictContainer.removeChildren();
        this.content.removeChildren();
        this.nameText.text = infoDialogName(ship);

        // The ship's dedicated info artwork, scaled to fit the picture
        // area. Falls back to the shipyard browse picture for ships (and
        // plug-ins) that don't supply one.
        const infoPict = ship.infoPict ?? ship.pict;
        if (infoPict) {
            const pict = this.displayAssets.spriteFromPict(infoPict);
            pict.anchor.set(0.5);
            pict.position.set(PICT_AREA.x, PICT_AREA.y);
            // Scale down to fit, never up (keep small pictures crisp).
            const fit = () => {
                if (!pict.texture.valid) {
                    return;
                }
                const scale = Math.min(1,
                    PICT_AREA.w / pict.texture.width,
                    PICT_AREA.h / pict.texture.height);
                pict.scale.set(scale);
            };
            fit();
            pict.texture.baseTexture.once('loaded', fit);
            this.pictContainer.addChild(pict);
        }

        try {
            await this.renderStats(ship);
        } catch (e) {
            console.warn('Ship info failed to load stats:', e);
        }

        this.container.visible = true;
        this.controls.bind();
        await firstValueFrom(this.closed);
        this.controls.unbind();
        this.container.visible = false;
    }

    private addRows(rows: [string, string][], labelX: number,
        valueX: number) {
        rows.forEach(([label, value], i) => {
            const labelText = new PIXI.Text(label, STAT_FONT);
            labelText.position.set(labelX, STATS_TOP + i * ROW_HEIGHT);
            const valueText = new PIXI.Text(value, STAT_FONT);
            valueText.position.set(valueX, STATS_TOP + i * ROW_HEIGHT);
            this.content.addChild(labelText, valueText);
        });
    }

    private async renderStats(ship: ShipData) {
        const physics = ship.physics;
        // Raw shïp units, inverting the parser's conversions (see
        // ship_parse.ts / constants.ts).
        const rawSpeed = Math.round(physics.speed * 100 / 30);
        const rawAccel = Math.round(physics.acceleration * 100 / 30);
        const rawTurn = Math.round(physics.turnRate * 60 / Math.PI);
        const jumps = Math.floor(physics.energy / 100);

        const left: [string, string][] = [
            ['Speed:', `${rawSpeed}`],
            ['Accel:', accelRating(rawAccel)],
            ['Turn:', turnRating(rawTurn)],
            ['Shields:', `${physics.shield}`],
            ['Armor:', `${physics.armor}`],
            ['Guns:', hardpoints(physics.maxGuns)],
            ['Turrets:', hardpoints(physics.maxTurrets)],
        ];
        this.addRows(left, LEFT_LABEL_X, LEFT_VALUE_X);

        const mid: [string, string][] = [
            ['Space:', `${ship.freeSpace} tons`],
            ['Cargo:', `${physics.freeCargo} tons`],
            ['Energy:', jumps === 1 ? '1 jump' : `${jumps} jumps`],
            ['Length:', `${ship.length} m`],
            ['Mass:', `${physics.mass} tons`],
            ['Crew:', `${ship.crew}`],
        ];
        this.addRows(mid, MID_LABEL_X, MID_VALUE_X);

        const heading = new PIXI.Text('Standard Weapons:', STAT_FONT);
        heading.position.set(WEAPONS_X, STATS_TOP);
        this.content.addChild(heading);
        const weaponsText = new PIXI.Text(
            await this.standardWeapons(ship), WEAPONS_FONT);
        weaponsText.position.set(WEAPONS_X, STATS_TOP + ROW_HEIGHT);
        this.content.addChild(weaponsText);
    }

    /**
     * The stock weapon loadout: the ship's default weapon outfits by
     * name and count, with ammunition summarised as "+ N ammo" — the
     * original's "Standard Weapons" line. "None" when the ship has no
     * default weapons.
     */
    private async standardWeapons(ship: ShipData): Promise<string> {
        const weapons: string[] = [];
        let ammo = 0;
        for (const [id, count] of Object.entries(ship.outfits)) {
            let outfit;
            try {
                outfit = await this.simulationData.data.Outfit.get(id);
            } catch {
                continue;
            }
            const isWeapon = Object.keys(outfit.weapons).length > 0
                || outfit.fixedGun || outfit.turret;
            if (isWeapon) {
                // Strip the "; note" author suffix from the outfit name.
                const outfitName = displayName(outfit.name);
                weapons.push(count > 1 ? `${count} ${outfitName}s`
                    : `${count} ${outfitName}`);
            } else if (outfit.ammoFor) {
                ammo += count;
            }
        }
        if (weapons.length === 0) {
            return 'None';
        }
        return weapons.join(', ') + (ammo > 0 ? ` + ${ammo} ammo` : '');
    }
}
