import { CronData } from 'novadatainterface/cron_data';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { CronStatesComponent } from '../nova_plugin/player/index.js';
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

/** STR# 8100 "Commercials": the local advert the window opens with. */
export const COMMERCIALS_STRING_TABLE = 'nova:8100';
/** STR# 8101 "Generic News": the news when no crön has any for here. */
export const GENERIC_NEWS_STRING_TABLE = 'nova:8101';

/** Stock STR# 8100 samples, for a data set without the table. */
const FALLBACK_COMMERCIALS = [
    'Local eatery has an offer of all you can eat for 2 credits for all '
    + 'off-worlders for your entire stay.',
];
/** Stock STR# 8101 samples, for a data set without the table. */
const FALLBACK_GENERIC_NEWS = [
    'Local News:  A recent spate of thefts around the spaceport have '
    + 'local traders up in arms.',
    'Financial News:  Stock prices fall again. Gli-Tech shares have '
    + 'reached a 750 year low of 1823 credits per share.',
    'Top News:  Pirate raids on the increase Federation-wide.  '
    + 'Information leading to the discovery of their home-base is now '
    + 'worth 1 billion credits.',
];

/** The string lists the window draws from, one list per source. */
export interface NewsSources {
    /** STR# 8100. */
    commercials: readonly string[];
    /** Per active crön with news for this stellar's govt: its list. */
    local: readonly (readonly string[])[];
    /** Per active crön with only independent news: its IndNews list. */
    independent: readonly (readonly string[])[];
    /** STR# 8101. */
    generic: readonly string[];
}

/**
 * WHAT THE WINDOW SAYS: one commercial, then ONE news item — the
 * original's news window on bar/news (Earth, wartime): "Local eatery has
 * an offer..." (STR# 8100 index 0) over a single crön item ("News from
 * the border: After quelling Auroran resistance..."), the pair filling
 * the pane's seven lines. We used to stack up to three crön items, which
 * ran ten-plus lines past the pane's bottom edge and over the spaceport
 * description (Matthew's 2026-11-27 playtest at a Polaris station: three
 * "Auroran/Federation border" items).
 *
 * The news item is a random string of a random crön among those with
 * LOCAL news for this govt, else among those with independent news, else
 * a random STR# 8101 line (Bible p. 21: local beats independent). Which
 * crön when several qualify is not documented; the one reference shows a
 * single item, so one is drawn at random. `random` is [0, 1): the window
 * is player-local UI, nothing here reaches the simulation.
 */
export function composeNews(sources: NewsSources,
    random: () => number = Math.random): string[] {
    const items: string[] = [];
    if (sources.commercials.length > 0) {
        items.push(pick(sources.commercials, random));
    }
    const crons = sources.local.length > 0
        ? sources.local : sources.independent;
    const withStrings = crons.filter(list => list.length > 0);
    if (withStrings.length > 0) {
        items.push(pick(pick(withStrings, random), random));
    } else if (sources.generic.length > 0) {
        items.push(pick(sources.generic, random));
    }
    return items;
}

/**
 * The bar news window, opened from the bar's Holovid button (or 'n'). The
 * background is the stellar's government NewsPic (e.g. the Hyper News
 * Network for the Federation) or the generic independent frame; dismissed
 * with a click or the depart key. Content: {@link composeNews}.
 *
 * Crön news: crons whose per-player state is currently active contribute
 * their GovtNews strings when the stellar's govt matches, otherwise their
 * IndNewsStr strings. Documented gap: allied governments do not share
 * local news (only an exact govt match).
 *
 * The text is CLIPPED to the black pane (NEWS.pane): a plug-in's long
 * strings, or a commercial and a five-line item together, are cut at the
 * pane's edge instead of being drawn over the spaceport underneath. The
 * spaceport's own description staying visible below the window is the
 * original's behaviour too (bar/news shows Earth's "...humanity. It is
 * said that all roads lead to Sol" under the window).
 */
export class NewsDialog {
    container = new PIXI.Container();
    private controls: MenuControls;
    private closed = new Subject<void>();
    private background?: PIXI.Sprite;
    /** One text per news item: the original separates items by a HALF
     * line, which a single wrapped Text cannot express. */
    private items: PIXI.Text[] = [];
    /** The items' layer, masked to the text pane. */
    private text = new PIXI.Container();
    private paneMask = new PIXI.Graphics();

    constructor(private displayAssets: DisplayAssetDataInterface,
        private simulationData: SimulationGameDataInterface,
        controlEvents: Observable<ControlEvent>,
        private universe: MissionUniverse,
        private planetId: string) {
        this.container.name = 'NewsDialog';
        this.container.visible = false;
        this.text.name = 'NewsText';
        const pane = NEWS.pane;
        this.paneMask.beginFill(0xffffff);
        this.paneMask.drawRect(pane.left, pane.top,
            pane.right - pane.left, pane.bottom - pane.top);
        this.paneMask.endFill();
        this.text.mask = this.paneMask;
        this.container.addChild(this.text, this.paneMask);
        this.controls = new MenuControls(controlEvents, {
            depart: () => this.closed.next(),
        });
    }

    /** The items currently laid out, in order (for specs and probes). */
    get shownItems(): string[] {
        return this.items.map(text => text.text);
    }

    /**
     * Stacks the items down the text pane, each starting a half line
     * (6px) below the previous item's last line — the original's spacing
     * on bar/news/*.png, where the second item's cap lands 30px below the
     * first's (two 12px lines plus the gap), not 36.
     */
    private layoutItems(items: string[]) {
        for (const text of this.items) {
            this.text.removeChild(text);
            text.destroy();
        }
        this.items = [];
        let y = NEWS.text.y;
        for (const item of items) {
            const text = new PIXI.Text(item, NEWS_FONT);
            text.position.set(NEWS.text.x, y);
            this.text.addChild(text);
            this.items.push(text);
            const lines = text.text ? Math.max(1,
                Math.round(text.height / LINE_HEIGHT)) : 1;
            y += lines * LINE_HEIGHT + NEWS.paragraphGap;
        }
    }

    /** A STR# list, or `fallback` when the data set has no such table. */
    private async strings(id: string, fallback: readonly string[]):
        Promise<readonly string[]> {
        try {
            const table = await this.displayAssets.data.StringTable.get(id);
            const strings = table.strings.filter(s => s.trim() !== '');
            return strings.length > 0 ? strings : fallback;
        } catch {
            return fallback;
        }
    }

    /** The crön news lists that apply to the player at this stellar. */
    private cronNews(entity: Entity, govtId: string | null):
        Pick<NewsSources, 'local' | 'independent'> {
        const cronStates = entity.components.get(CronStatesComponent);
        const active: CronData[] = this.universe.crons.filter(
            cron => cronStates?.get(cron.id)?.phase === 'active');
        const local: string[][] = [];
        const independent: string[][] = [];
        for (const cron of active) {
            const matching = govtId ? cron.govtNews.find(
                news => news.govt === govtId) : undefined;
            if (matching) {
                local.push(matching.strings);
            } else if (cron.indNews.length > 0) {
                independent.push(cron.indNews);
            }
        }
        return { local, independent };
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

        const [commercials, generic] = await Promise.all([
            this.strings(COMMERCIALS_STRING_TABLE, FALLBACK_COMMERCIALS),
            this.strings(GENERIC_NEWS_STRING_TABLE, FALLBACK_GENERIC_NEWS),
        ]);
        let crons: Pick<NewsSources, 'local' | 'independent'> =
            { local: [], independent: [] };
        try {
            await this.universe.load();
            crons = this.cronNews(entity, govtId);
        } catch (e) {
            console.warn('News dialog failed to load crons:', e);
        }
        this.layoutItems(composeNews({ commercials, generic, ...crons }));

        this.container.visible = true;
        this.controls.bind();
        await firstValueFrom(this.closed);
        this.controls.unbind();
        this.container.visible = false;
    }
}

function pick<T>(items: readonly T[], random: () => number): T {
    return items[Math.min(items.length - 1,
        Math.floor(random() * items.length))];
}
