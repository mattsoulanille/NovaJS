import { ShipData } from 'novadatainterface/ship_data';
import { ShipAccelerationConversionFactor, ShipSpeedConversionFactor } from 'novaparse/parsers/constants';
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
/** The ship-info dialog's frame (PICT 8507). */
export const SHIP_INFO_PICT = 'nova:8507';

const WIDTH = 614;
const HEIGHT = 537;
const ORIGIN_X = -WIDTH / 2;
const ORIGIN_Y = -HEIGHT / 2;
// The frame's top edge on a whole pixel. The frame is 537 tall, so
// centring it puts its top at -268.5 and the linear sampler smears every
// bevel row across two (the before capture's top bevel read 96/84/56
// grey against the original's crisp 115/82/90 at screen y 272-274). The
// original draws it from screen y 272 (all three shipyard/*_info.png
// captures), i.e. -268 in centre-anchored coordinates.
const FRAME_TOP = Math.ceil(ORIGIN_Y);

/**
 * The picture well: the frame's opening above the name strip. Measured by
 * pixel analysis on all three shipyard/*_info.png captures, where the
 * 600x400 info PICT is blitted 1:1 at screen x 660..1259, y 278..677 --
 * flush against the 3px dark inner shadow of the bevel (x 657-659, y
 * 275-277, and the right/bottom bevels start at x 1260 / y 678). That is
 * the frame's own (7, 6) offset, in centre-anchored coordinates.
 */
export const SHIP_INFO_PICT_AREA = {
    x: ORIGIN_X + 7, y: FRAME_TOP + 6, width: 600, height: 400,
} as const;

/**
 * Where the info picture goes for a texture of the given size: the stock
 * 600x400 info PICTs fill the well exactly at 1:1 (the original never
 * scales them). Anything larger (plug-in art) is scaled down to fit,
 * never up -- the 200x200 browse-pict fallback stays crisp -- and is
 * centred in the well with its top-left on a whole pixel so it is not
 * resampled. Returns the top-left in centre-anchored coordinates.
 */
export function shipInfoPictPlacement(textureWidth: number,
    textureHeight: number): { x: number, y: number, scale: number } {
    const area = SHIP_INFO_PICT_AREA;
    const scale = Math.min(1, area.width / textureWidth,
        area.height / textureHeight);
    return {
        x: area.x + Math.round((area.width - textureWidth * scale) / 2),
        y: area.y + Math.round((area.height - textureHeight * scale) / 2),
        scale,
    };
}

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
// Column x positions, from the first ink column of each column on
// shipyard/shuttle_info.png (our Geneva's ink starts at the text's own x):
// labels 664, left values 709, mid labels 794, mid values 839, Standard
// Weapons 919.
const LEFT_LABEL_X = ORIGIN_X + 11;
const LEFT_VALUE_X = ORIGIN_X + 56;
const MID_LABEL_X = ORIGIN_X + 141;
const MID_VALUE_X = ORIGIN_X + 186;
const WEAPONS_X = ORIGIN_X + 266;
// The loadout line sits 14px under the "Standard Weapons:" heading, not
// one 12px row (ink tops 719 -> 733 on shuttle_info.png and
// ida_frigate_info.png).
const WEAPONS_LIST_Y = STATS_TOP + 14;
// ida_frigate_info.png prints "2 Medium Blaster Turrets, 1 Raven Rocket
// Turret + 100 ammo" on ONE line (ink x 919..1202), which a 260px wrap
// broke in three. Wrap at the text well's inner edge instead (x 1259),
// keeping the same 4px margin the labels keep on the left (660 -> 664).
const WEAPONS_WIDTH = 1255 - 919;
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
// The stat labels ("Speed:", "Space:" ...) are mid grey in the original,
// their values white: every label pixel on shuttle_info.png and
// ida_frigate_info.png peaks at exactly 128,128,128.
const LABEL_FONT: Partial<PIXI.ITextStyle> = { ...STAT_FONT, fill: 0x808080 };
const WEAPONS_FONT: Partial<PIXI.ITextStyle> = {
    ...STAT_FONT, wordWrap: true, wordWrapWidth: WEAPONS_WIDTH,
};

/*
 * The qualitative Accel and Turn ratings of the ship info dialog, in the
 * original's raw shïp units: six words, the lowest "Terrible". MEASURED
 * (reference "Ship-info rating edges (E11 leftover), wave 41", forty kit
 * hulls on a 10- / 2-wide Accel grid and a 1-wide Turn grid, on top of
 * wave 40's 50 / 5 grid):
 *  - Turn: Poor from 11, Average 21, Good 31, Very Good 41, Excellent 51,
 *    each edge exact ("more than 10 / 20 / 30 / 40 / 50").
 *  - Accel: Poor from 130, Average 250, Good 381, Very Good 551,
 *    Excellent 731, each edge exact (wave 41 read 128 / 248 / 380 / 550 /
 *    730 as the lower word and 130 / 250 / 382 / 552 / 732 as the upper;
 *    reference "Ship-info Accel at the odd values (E11 leftover), wave
 *    42" read 129 Terrible, 249 Poor, 381 Good, 551 Very Good, 731
 *    Excellent: "more than 129 / 249 / 380 / 550 / 730").
 *  - The hull's Speed plays no part (Accel 250 and 380 read Average at
 *    Speed 100, 300 and 1,000).
 */

/** The ship info dialog's Accel word, from the raw shïp Accel. */
export function accelRating(raw: number): string {
    if (raw >= 731) return 'Excellent';
    if (raw >= 551) return 'Very Good';
    if (raw >= 381) return 'Good';
    if (raw >= 250) return 'Average';
    if (raw >= 130) return 'Poor';
    return 'Terrible';
}

/** The ship info dialog's Turn word, from the raw shïp Maneuver. */
export function turnRating(raw: number): string {
    if (raw >= 51) return 'Excellent';
    if (raw >= 41) return 'Very Good';
    if (raw >= 31) return 'Good';
    if (raw >= 21) return 'Average';
    if (raw >= 11) return 'Poor';
    return 'Terrible';
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

        const background = this.displayAssets.spriteFromPict(SHIP_INFO_PICT);
        background.position.set(ORIGIN_X, FRAME_TOP);
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

        // The ship's dedicated info artwork, in the frame's picture well. Falls back to the shipyard browse picture for ships (and
        // plug-ins) that don't supply one.
        const infoPict = ship.infoPict ?? ship.pict;
        if (infoPict) {
            const pict = this.displayAssets.spriteFromPict(infoPict);
            pict.position.set(SHIP_INFO_PICT_AREA.x, SHIP_INFO_PICT_AREA.y);
            // 1:1 in the well for stock art; scaled down to fit, never
            // up, and centred for anything else.
            const fit = () => {
                if (!pict.texture.valid) {
                    return;
                }
                const place = shipInfoPictPlacement(
                    pict.texture.width, pict.texture.height);
                pict.position.set(place.x, place.y);
                pict.scale.set(place.scale);
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
            const labelText = new PIXI.Text(label, LABEL_FONT);
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
        const rawSpeed = Math.round(physics.speed / ShipSpeedConversionFactor);
        const rawAccel = Math.round(
            physics.acceleration / ShipAccelerationConversionFactor);
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
        weaponsText.position.set(WEAPONS_X, WEAPONS_LIST_Y);
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
