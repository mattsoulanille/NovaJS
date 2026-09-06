import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { ControlEvent } from '../nova_plugin/controls_plugin.js';
import { Button, ButtonClick } from './button.js';
import { GAMBLE } from './dialog_layout.js';
import { MenuControls } from './menu_controls.js';
import { QuantityDialog } from './quantity_dialog.js';

// The 470x230 racing dialog (PICT 8529): the header LED strip on top,
// four 100x100 racer PICTs and the metal button strip along the bottom.
// Geometry lives in dialog_layout.ts, measured against bar/gamble/*.png.
const SLOT_CENTERS_X = GAMBLE.slotCentersX;
const SLOT_CENTER_Y = GAMBLE.slotCenterY;
const SLOT_SIZE = GAMBLE.slotSize;
const TRACK = { left: -223, right: 221, top: -31, bottom: 72 };
const BUTTON_Y = GAMBLE.button.y;

/** The four racer PICTs (8530-8533), one per selection box. */
const RACER_PICTS = ['nova:8530', 'nova:8531', 'nova:8532', 'nova:8533'];

const STATUS_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 12, fill: 0xffffff,
    // Kept narrower than the LED strip so text clears the checkered
    // flag art on either side.
    align: 'center', wordWrap: true, wordWrapWidth: 310,
};

const RACE_DURATION_MS = 3500;

/**
 * The bar's gambling minigame, the Galactic Racing Network: pick a
 * racer, place a bet (the original's fixed Bet 1000 / Bet 5000
 * stakes, STR# 150), and watch the race. The stake is deducted when
 * the bet is placed and a win pays back 4x the stake (3-to-1 profit) —
 * verified against the original game (Matthew, 2026-07-27: bet 1000,
 * deducted immediately; the win then paid 4000).
 *
 * Bets settle into the caller's credits working copy — the landing's one
 * ledger (landed_transaction.ts), the same object the hire dialog charges
 * and the outfitter spends from — which lands on the entity when the
 * player leaves the bar. The race outcome uses plain Math.random: this is landed,
 * player-local UI (like mission offer rolls); only the resulting
 * credit balance ever reaches the simulation.
 */
export class GambleDialog {
    container = new PIXI.Container();
    private controls: MenuControls;
    private closed = new Subject<void>();
    private credits: { credits: number } = { credits: 0 };
    private selected = -1;
    private racerSprites: PIXI.Sprite[] = [];
    private selectionBoxes: PIXI.Graphics[] = [];
    private highlight = new PIXI.Graphics();
    private statusBackdrop = new PIXI.Graphics();
    private status = new PIXI.Text('', STATUS_FONT);
    private raceOverlay = new PIXI.Container();
    private racing = false;
    private buttons: {
        help: Button, bet1000: Button, bet5000: Button, cancel: Button,
    };
    private quantityDialog: QuantityDialog;

    constructor(private displayAssets: DisplayAssetDataInterface,
        controlEvents: Observable<ControlEvent>) {
        this.container.name = 'GambleDialog';
        this.container.visible = false;

        const background = displayAssets.spriteFromPict('nova:8529');
        background.anchor.set(0.5);
        background.interactive = true;
        this.container.addChild(background);

        // The header LED strip already carries the baked-in "choose
        // your racer" prompt; the backdrop covers it once there is
        // race status to show instead.
        this.statusBackdrop.beginFill(0x000000)
            .drawRect(-165, -105, 330, 62).endFill();
        this.statusBackdrop.visible = false;
        this.status.anchor.set(0.5);
        this.status.position.set(0, -74);
        this.container.addChild(this.statusBackdrop);

        RACER_PICTS.forEach((pict, i) => {
            const sprite = displayAssets.spriteFromPict(pict);
            sprite.anchor.set(0.5);
            sprite.position.set(SLOT_CENTERS_X[i], SLOT_CENTER_Y);
            // The racer PICTs are already 100x100 and the original
            // blits them 1:1 (bar/gamble/gamble.png: the first fills
            // x738..837, y513..612); only oversized plug-in art scales.
            const scale = Math.min(1, SLOT_SIZE / Math.max(
                sprite.width || SLOT_SIZE, sprite.height || SLOT_SIZE, 1));
            sprite.scale.set(scale);
            sprite.interactive = true;
            sprite.cursor = 'pointer';
            sprite.on('pointerdown', () => this.select(i));
            this.container.addChild(sprite);
            this.racerSprites.push(sprite);
        });
        this.container.addChild(this.highlight);
        this.container.addChild(this.raceOverlay);
        this.container.addChild(this.status);

        this.buttons = {
            help: new Button(displayAssets, 'Help', GAMBLE.button.width,
                { x: GAMBLE.button.help, y: BUTTON_Y }),
            bet1000: new Button(displayAssets, 'Bet 1000',
                GAMBLE.button.width,
                { x: GAMBLE.button.help, y: BUTTON_Y }),
            bet5000: new Button(displayAssets, 'Bet 5000',
                GAMBLE.button.width,
                { x: GAMBLE.button.cancel, y: BUTTON_Y }),
            cancel: new Button(displayAssets, 'Cancel',
                GAMBLE.button.width,
                { x: GAMBLE.button.cancel, y: BUTTON_Y }),
        };
        this.buttons.help.click.subscribe(() => this.showHelp());
        // Option+click on a bet button opens the quantity dialog for a
        // custom stake, in the outfitter/trade-center style.
        this.buttons.bet1000.click.subscribe(
            click => void this.betClicked(1000, click));
        this.buttons.bet5000.click.subscribe(
            click => void this.betClicked(5000, click));
        this.buttons.cancel.click.subscribe(() => {
            if (!this.racing) {
                this.closed.next();
            }
        });
        for (const button of Object.values(this.buttons)) {
            this.container.addChild(button.container);
        }

        this.quantityDialog = new QuantityDialog(controlEvents);
        // On top of everything, so its modal shield covers the dialog.
        this.container.addChild(this.quantityDialog.container);

        this.controls = new MenuControls(controlEvents, {
            depart: () => {
                if (!this.racing) {
                    this.closed.next();
                }
            },
        });
    }

    /** Bet buttons appear once a racer is chosen, per the original. */
    private layoutButtons() {
        const chosen = this.selected >= 0;
        this.buttons.help.container.visible = !chosen;
        this.buttons.bet1000.container.visible = chosen;
        this.buttons.bet5000.container.visible = chosen;
        // The reference's base dialog is Help / Cancel; once a racer is
        // picked our two stakes take those two slots and Cancel moves
        // right of them (the original bets a fixed 1,000 on the click).
        this.buttons.cancel.container.position.x =
            chosen ? GAMBLE.button.cancel + 113 : GAMBLE.button.cancel;
        const affordable = (bet: number) =>
            chosen && !this.racing && this.credits.credits >= bet;
        this.buttons.bet1000.state = affordable(1000) ? 'normal' : 'grey';
        this.buttons.bet5000.state = affordable(5000) ? 'normal' : 'grey';
    }

    private select(index: number) {
        if (this.racing) {
            return;
        }
        this.selected = index;
        this.highlight.clear();
        this.highlight.lineStyle(2, 0xff0000);
        this.highlight.drawRect(SLOT_CENTERS_X[index] - SLOT_SIZE / 2,
            SLOT_CENTER_Y - SLOT_SIZE / 2 - 2, SLOT_SIZE, SLOT_SIZE + 4);
        this.setStatus('Place your bet!');
        this.layoutButtons();
    }

    private showHelp() {
        this.setStatus('Pick a racer, place your bet, and watch the '
            + 'race. A win pays 3 to 1.');
    }

    private setStatus(text: string) {
        this.status.text = text;
        this.statusBackdrop.visible = text.length > 0;
    }

    /**
     * A bet button press: plain clicks stake the button's amount; an
     * option+click asks for a custom stake, clamped to the player's
     * credits and prefilled with the button's amount.
     */
    private async betClicked(amount: number, click?: ButtonClick) {
        if (!click?.option) {
            return this.bet(amount);
        }
        if (this.racing || this.selected < 0) {
            return;
        }
        const max = this.credits.credits;
        if (max <= 0) {
            return;
        }
        const quantity = await this.quantityDialog.show({
            verb: 'Bet',
            initial: Math.min(amount, max),
            max,
        });
        if (!quantity) {
            return;
        }
        return this.bet(quantity);
    }

    private async bet(amount: number) {
        if (this.racing || this.selected < 0
            || this.credits.credits < amount) {
            return;
        }
        this.racing = true;
        this.credits.credits -= amount;
        this.layoutButtons();

        // Player-local UI randomness (see class doc).
        const winner = Math.floor(Math.random() * RACER_PICTS.length);
        this.setStatus('And they’re off!');
        await this.runRace(winner);

        const won = winner === this.selected;
        if (won) {
            this.credits.credits += amount * 4;
        }
        this.setStatus(won
            ? `Your racer wins! You collect ${(amount * 4).toLocaleString()} `
            + `credits. You now have ${this.credits.credits.toLocaleString()} cr.`
            : `Racer ${winner + 1} takes the race. You lose your `
            + `${amount.toLocaleString()} credit bet. You now have `
            + `${this.credits.credits.toLocaleString()} cr.`);
        this.racing = false;
        this.layoutButtons();
    }

    /** A stand-in for the original's race holovid (the QuickTime
     * "Race N.mov" files): the racers sprint across a black track
     * overlay, the predetermined winner leading at the finish. */
    private runRace(winner: number): Promise<void> {
        const overlay = this.raceOverlay;
        overlay.removeChildren();
        const backdrop = new PIXI.Graphics().beginFill(0x000008)
            .drawRect(TRACK.left, TRACK.top,
                TRACK.right - TRACK.left, TRACK.bottom - TRACK.top)
            .endFill();
        overlay.addChild(backdrop);

        const laneHeight = (TRACK.bottom - TRACK.top) / RACER_PICTS.length;
        const racers = RACER_PICTS.map((pict, i) => {
            const sprite = this.displayAssets.spriteFromPict(pict);
            sprite.anchor.set(0.5);
            const scale = (laneHeight * 0.9) / Math.max(
                sprite.height || laneHeight, 1);
            sprite.scale.set(scale);
            sprite.rotation = Math.PI / 2; // Racer art points up; run right.
            sprite.position.set(TRACK.left + 12,
                TRACK.top + laneHeight * (i + 0.5));
            overlay.addChild(sprite);
            return sprite;
        });

        const start = performance.now();
        const distance = TRACK.right - TRACK.left - 24;
        // Everyone else finishes a beat behind the winner.
        const paces = racers.map((_, i) => i === winner
            ? 1 : 0.75 + Math.random() * 0.17);
        return new Promise(resolve => {
            const tick = () => {
                const t = Math.min(1,
                    (performance.now() - start) / RACE_DURATION_MS);
                racers.forEach((sprite, i) => {
                    // A dash of jitter so the pack trades places.
                    const wobble = Math.sin(t * 20 + i * 1.7) * 0.02;
                    const progress = Math.min(1,
                        t * paces[i] + (t < 0.9 ? wobble : 0));
                    sprite.position.x = TRACK.left + 12
                        + distance * Math.max(0, progress);
                });
                if (t >= 1) {
                    PIXI.Ticker.shared.remove(tick);
                    setTimeout(() => {
                        overlay.removeChildren();
                        resolve();
                    }, 400);
                    return;
                }
            };
            PIXI.Ticker.shared.add(tick);
        });
    }

    /**
     * Shows the dialog; bets settle into `credits` (a working copy —
     * the caller commits it). Resolves when the player leaves.
     */
    async show(credits: { credits: number }): Promise<void> {
        this.credits = credits;
        this.selected = -1;
        this.highlight.clear();
        this.raceOverlay.removeChildren();
        this.setStatus('');
        this.layoutButtons();
        this.container.visible = true;
        this.controls.bind();
        await firstValueFrom(this.closed);
        this.controls.unbind();
        this.container.visible = false;
    }
}
