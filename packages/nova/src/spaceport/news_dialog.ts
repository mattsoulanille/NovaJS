import { CronData } from 'novadatainterface/cron_data';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/core/controls_plugin.js';
import { CronStatesComponent } from '../nova_plugin/player/player_state_plugin.js';
import { LINE_HEIGHT, NEWS } from './dialog_layout.js';
import { MenuControls } from './menu_controls.js';
import { MissionUniverse } from './mission_universe.js';

// The 300x230 news dialog PICTs (9000 generic, 9001+ per-govt
// NewsPic): header art on top, text pane below a rule at y554.
// Geometry lives in dialog_layout.ts, measured against bar/news/*.png.
const NEWS_FONT: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Geneva', fontSize: 9.4, fill: 0xffffff,
    align: 'left', wordWrap: true, wordWrapWidth: NEWS.wrapWidth,
    lineHeight: LINE_HEIGHT,
};

/** Shown when no crön has news for this stellar (cf. STR# 8101). */
const GENERIC_NEWS = [
    'Local News: A recent spate of thefts around the spaceport '
    + 'have local traders up in arms.',
    'Financial News: Stock prices fall again. Gli-Tech shares have '
    + 'reached a 750 year low of 1823 credits per share.',
    'Top News: Pirate raids on the increase Federation-wide. '
    + 'Information leading to the discovery of their home-base is '
    + 'now worth 1 billion credits.',
];

/**
 * The bar news window, shown when the player enters the bar (as in
 * the original). The background is the stellar's government NewsPic
 * (e.g. the Hyper News Network for the Federation) or the generic
 * independent frame; dismissed with a click or the depart key.
 *
 * Content comes from the crön machinery: crons whose per-player state
 * is currently active contribute their news — GovtNews strings when
 * the stellar's govt matches, otherwise IndNewsStr strings. Local
 * news beats independent news, per the Bible. Simplifications
 * (documented gaps): allied governments do not share local news (only
 * an exact govt match), and the generic no-news flavor is a hardcoded
 * sample of STR# 8101 rather than the parsed resource.
 *
 * Which string of a list shows is plain Math.random: player-local UI,
 * like mission offer rolls — nothing here reaches the simulation.
 */
export class NewsDialog {
    container = new PIXI.Container();
    private controls: MenuControls;
    private closed = new Subject<void>();
    private background?: PIXI.Sprite;
    /** One text per news item: the original separates items by a HALF
     * line, which a single wrapped Text cannot express. */
    private items: PIXI.Text[] = [];

    constructor(private displayAssets: DisplayAssetDataInterface,
        private simulationData: SimulationGameDataInterface,
        controlEvents: Observable<ControlEvent>,
        private universe: MissionUniverse,
        private planetId: string) {
        this.container.name = 'NewsDialog';
        this.container.visible = false;
        this.controls = new MenuControls(controlEvents, {
            depart: () => this.closed.next(),
        });
    }

    /**
     * Stacks the day's items down the text pane, each starting a half
     * line (6px) below the previous item's last line — the original's
     * spacing on bar/news/*.png, where the second item's cap lands 30px
     * below the first's (two 12px lines plus the gap), not 36.
     */
    private layoutItems(items: string[]) {
        for (const text of this.items) {
            this.container.removeChild(text);
            text.destroy();
        }
        this.items = [];
        let y = NEWS.text.y;
        for (const item of items) {
            const text = new PIXI.Text(item, NEWS_FONT);
            text.position.set(NEWS.text.x, y);
            this.container.addChild(text);
            this.items.push(text);
            const lines = text.text ? Math.max(1,
                Math.round(text.height / LINE_HEIGHT)) : 1;
            y += lines * LINE_HEIGHT + NEWS.paragraphGap;
        }
    }

    /** Picks the news for the player's active crons at this stellar. */
    private pickNews(entity: Entity, govtId: string | null): string[] {
        const cronStates = entity.components.get(CronStatesComponent);
        const active: CronData[] = this.universe.crons.filter(
            cron => cronStates?.get(cron.id)?.phase === 'active');

        const local: string[] = [];
        const independent: string[] = [];
        for (const cron of active) {
            const matching = govtId ? cron.govtNews.find(
                news => news.govt === govtId) : undefined;
            if (matching) {
                local.push(pick(matching.strings));
            } else if (cron.indNews.length > 0) {
                independent.push(pick(cron.indNews));
            }
        }
        // Local news takes precedence over independent (Bible p. 21);
        // show a couple of items like the original's news feed.
        const items = (local.length > 0 ? local : independent).slice(0, 3);
        if (items.length === 0) {
            items.push(pick(GENERIC_NEWS));
        }
        return items;
    }

    /** Shows the dialog and resolves when the player dismisses it. */
    async show(entity: Entity): Promise<void> {
        let govtId: string | null = null;
        let backgroundPict = 'nova:9000';
        try {
            const planet = await this.simulationData.data.Planet
                .get(this.planetId);
            govtId = planet.govt;
            if (govtId) {
                const govt = await this.simulationData.data.Govt.get(govtId);
                if (govt.newsPic) {
                    backgroundPict = govt.newsPic;
                }
            }
        } catch (e) {
            console.warn('News dialog failed to load planet/govt:', e);
        }

        this.background?.destroy();
        this.background = this.displayAssets.spriteFromPict(backgroundPict);
        this.background.anchor.set(0.5);
        this.background.interactive = true;
        this.background.cursor = 'pointer';
        // Any click on the news window dismisses it.
        this.background.on('pointerdown', () => this.closed.next());
        this.container.addChildAt(this.background, 0);

        try {
            await this.universe.load();
            this.layoutItems(this.pickNews(entity, govtId));
        } catch (e) {
            console.warn('News dialog failed to load crons:', e);
            this.layoutItems([GENERIC_NEWS[0]]);
        }

        this.container.visible = true;
        this.controls.bind();
        await firstValueFrom(this.closed);
        this.controls.unbind();
        this.container.visible = false;
    }
}

function pick<T>(items: T[]): T {
    return items[Math.floor(Math.random() * items.length)];
}
