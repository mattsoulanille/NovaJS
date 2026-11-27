import * as PIXI from 'pixi.js';
import { BehaviorSubject, Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { displayName } from '../nova_plugin/core/index.js';
import { enhancementEnabled } from '../enhancements.js';
import { WheelRowStepper } from './grid_wheel.js';


const TILE_SIZE = [83, 54];

/**
 * The caption's line pitch. Measured on
 * shipyard/earth_spaceport.png: the "Asteroid" / "Miner" tile's two
 * lines have their ink tops at screen y 475 and 486, and the
 * "Starbridge" / "- used -" tile's at 529 and 540 -- 11px apart in both.
 * (The description panes' body text runs at a 12px pitch; the tile
 * captions are tighter.)
 */
export const CAPTION_LINE_HEIGHT = 11;

/**
 * Where a tile's caption block starts, in tile coordinates -- the y handed
 * to the first line's PIXI.Text, whose ink begins 2px lower.
 *
 * The original uses two layouts, which the reference screenshots show
 * directly (tile tops at screen y 387 / 441 / 495 in
 * shipyard/earth_spaceport.png):
 *
 *   one line   "Thunderhead"   ink rows 537-543, i.e. tile-relative 42-48
 *   two lines  "Starbridge"    ink rows 529-535, tile-relative 34-40
 *              "- used -"      ink rows 540-546, tile-relative 45-51
 *
 * so a second line does not push the first one up by a whole line (11) but
 * by 8. outfitter/earth_outfitter.png agrees, one pixel lower throughout
 * because that grid itself sits one pixel lower (see the outfitter's grid
 * container y).
 */
export const CAPTION_TOP = { single: 40, multi: 32 } as const;

/**
 * The subtitle grey. The "- used -" line in shipyard/earth_spaceport.png
 * is a flat (78,78,78) -- the original's font is a bitmap, so the sample
 * is exact rather than an antialiased average.
 */
export const CAPTION_GREY = 0x4e4e4e;

/**
 * The caption face: the original's Geneva 9, our 9.4px as everywhere on
 * the landed screens. At 10px ours ran 5-10% wide ("Light Blaster" inked
 * 61px against the R8 wave-5 03-outfitter.png's 57, "Sensor Boost" 64
 * against 58; at 9.4px "Cargo Expansion" advances 74.4px where the
 * capture inks x841..914).
 */
export const CAPTION_FONT_SIZE = 9.4;

/**
 * The y handed to each caption line's PIXI.Text, top to bottom, for a
 * caption of `lines` lines. The block is BOTTOM-aligned (reference
 * "Outfitter long item names ..., wave 43"): one line at CAPTION_TOP.single,
 * two at CAPTION_TOP.multi and a pitch below, and every further line pushes
 * the block up by a whole pitch (three lines were never seen in the
 * original; the stock data has none, so that step is the plain reading of
 * "a second line grows upward").
 */
export function captionLineTops(lines: number): number[] {
    if (lines <= 0) {
        return [];
    }
    if (lines === 1) {
        return [CAPTION_TOP.single];
    }
    const first = CAPTION_TOP.multi - (lines - 2) * CAPTION_LINE_HEIGHT;
    return Array.from({ length: lines },
        (_, i) => first + i * CAPTION_LINE_HEIGHT);
}

/**
 * How far past the grid's outer rule a caption line may spill before it is
 * clipped. The original draws a long line whole, centred on its cell and
 * across its neighbours, and cuts it only at the dialog window's edge (wave
 * 43 ln_a: "Kit Very Long Name For A Test" in the left column loses its
 * start about 8 px left of the grid's rule, where the outfitter's frame
 * ends; NovaJS's shops put the grid 8 px inside their dialog art, at x
 * -373). Used on every side: on the right the original let a line run on
 * over the frame into the next pane, which only a caption wider than about
 * 100 px in the right column ever reaches.
 */
export const CAPTION_CLIP_MARGIN = 8;

/**
 * The name of every tile's caption container (ItemTile.caption), which
 * sits at the tile's own position in the grid's caption layer: headless
 * drivers find a tile by its caption text through it.
 */
export const ITEM_TILE_CAPTION_NAME = 'ItemTileCaption';

/** One rendered line-group of a tile caption: a run of text and its colour. */
export interface CaptionSegment {
    text: string;
    /** True for the grey subtitle styling (see captionSegments). */
    grey: boolean;
}

/**
 * The caption lines a shipyard/outfitter tile shows, per the EVN Bible's
 * shïp ShortName (~:2680):
 *
 *   "The short string that is displayed in the shipyard dialog menu for
 *    this ship type. If you want to split this name into two separate
 *    lines, put the characters "\n" into the name [...] lines that start
 *    with an alphanumeric character are drawn in white, while lines that
 *    start with other symbols are drawn in grey."
 *
 * The separator really is the two characters backslash-n, not a newline
 * byte -- that is what the parser reads out of the resource (e.g.
 * "Heavy Shuttle\\n- used -", "Asteroid\\nMiner").
 *
 * The oütf ShortName reads the same (Bible ~:2038), and the original
 * outfitter and shipyard draw ONLY these lines: no wrapping, truncation or
 * shrinking, a line too wide for its cell running on over the neighbours,
 * and an EMPTY ShortName drawing no caption at all (reference "Outfitter
 * long item names ..., wave 43": kit items with a blank ShortName showed
 * the icon cell only, on both grids).
 *
 * An item with no ShortName FIELD (shortName undefined: not an oütf or a
 * shïp) falls back to its name with the "; developer note" suffix
 * stripped, on one line.
 */
export function captionSegments(
    item: { name: string, shortName?: string }): CaptionSegment[] {
    const source = item.shortName ?? displayName(item.name);
    return source.split(/\\n|\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(text => ({ text, grey: !/^[a-zA-Z0-9]/.test(text) }));
}

/**
 * The selected-item pict pane budget shared by the shipyard, outfitter,
 * and hire dialogs. STOCK picts are the reference: every stock outfit
 * and ship pict is exactly 200x200 (measured across the parsed data —
 * e.g. oütf 128/131/145 picts 6000/6003/6017, shïp 128 pict 5000), and
 * they fill the pane 1:1 in the original. The fit only ever SHRINKS, so
 * stock art keeps rendering exactly as the original does; PLUGIN picts
 * come in arbitrary sizes that vary by plugin ('missile things' ships
 * 400x400 — 'Nuclear Missile', 'IR type Multi Launcher') and are scaled
 * down to the stock budget. Ships ride the same tile path.
 */
export const LARGE_PICT_FIT = 200;

/** The tile thumbnail budget: the stock 200x200 pict at its 0.15 scale. */
export const TILE_PICT_FIT = LARGE_PICT_FIT * 0.15;

/** The downscale-to-fit factor: never upscales. */
export function fitScale(width: number, height: number, max: number): number {
    return Math.min(1, max / width, max / height);
}

/**
 * Applies {@link fitScale} once the sprite's texture is loaded —
 * spriteFromPict textures load asynchronously, so the dimensions aren't
 * known at construction.
 */
function fitWhenLoaded(sprite: PIXI.Sprite, max: number) {
    const fit = () => {
        const { width, height } = sprite.texture;
        if (width <= 1 || height <= 1) {
            return;
        }
        sprite.scale.set(fitScale(width, height, max));
    };
    if (sprite.texture.baseTexture.valid) {
        fit();
    } else {
        sprite.texture.baseTexture.once('loaded', fit);
    }
}

export class ItemTile<I extends Item> {
    private font = {
        // Never wordWrap: a caption line is drawn whole (captionSegments).
        normal: {
            fontFamily: "Geneva", fontSize: CAPTION_FONT_SIZE, fill: 0xffffff,
            align: 'center', wordWrap: false,
            lineHeight: CAPTION_LINE_HEIGHT,
        } as const,
        grey: {
            fontFamily: "Geneva", fontSize: CAPTION_FONT_SIZE,
            fill: CAPTION_GREY, align: 'center', wordWrap: false,
            lineHeight: CAPTION_LINE_HEIGHT,
        } as const,
        count: {
            fontFamily: "Geneva", fontSize: CAPTION_FONT_SIZE, fill: 0xffffff,
            align: 'right', wordWrap: false, wordWrapWidth: TILE_SIZE[0]
        } as const,
    };

    // Tracker issue: these are cölr gridDim / gridBright, but cölr is
    // not exposed through NovaDataInterface yet.
    private colors = {
        dim: 0x404040,
        bright: 0xFF0000,
    };
    private lineWidth = 1;
    private dimStyle = [this.lineWidth, this.colors.dim] as const;
    private brightStyle = [this.lineWidth, this.colors.bright] as const;
    private graphics = new PIXI.Graphics();
    private wrappedQuantity = 0;
    private quantityText: PIXI.Text;
    readonly container = new PIXI.Container();
    /**
     * The caption lines, kept OUT of `container` so the grid can layer
     * every caption above every tile's opaque background: a line wider
     * than its cell runs on over the neighbours, as the original's does.
     * Moved, shown and hidden with the tile.
     */
    readonly caption = new PIXI.Container();
    private wrappedActive = false;
    public built = false;
    public largePict = new PIXI.Container();

    constructor(private displayAssets: DisplayAssetDataInterface, readonly item: I) {
        // The ShortName caption: one PIXI.Text per "\n"-separated segment,
        // so each can carry its own colour (PIXI has no per-line fill), and
        // each exactly one line, centred on the cell however wide it is.
        this.caption.name = ITEM_TILE_CAPTION_NAME;
        const segments = captionSegments(item);
        const tops = captionLineTops(segments.length);
        segments.forEach(({ text, grey }, i) => {
            const line = new PIXI.Text(text,
                grey ? this.font.grey : this.font.normal);
            line.anchor.x = 0.5;
            line.position.x = TILE_SIZE[0] / 2;
            line.position.y = tops[i];
            this.caption.addChild(line);
        });

        this.quantityText = new PIXI.Text("", this.font.normal);
        this.quantityText.anchor.x = 1;
        this.quantityText.position.x = TILE_SIZE[0] - 2;
        this.quantityText.position.y = 2;

        this.container.interactive = true;
        this.active = false;

        this.container.addChild(this.graphics);
        this.container.addChild(this.quantityText);
    }

    build() {
        if (this.built) {
            return;
        }

        if (this.item.pict) {
            const smallPict = this.displayAssets.spriteFromPict(this.item.pict);
            const largePict = this.displayAssets.spriteFromPict(this.item.pict);
            fitWhenLoaded(largePict, LARGE_PICT_FIT);
            this.largePict.addChild(largePict);
            smallPict.anchor.x = 0.5;
            smallPict.position.x = TILE_SIZE[0] / 2;
            smallPict.position.y = 1;

            // The tile thumbnail is the stock 200x200 pict at 0.15 (30px).
            // Fit to that same 30px budget so oversized plugin picts (e.g.
            // 400x400) shrink like the large pane's do, and stock stays
            // exactly as before (fitScale never upscales).
            fitWhenLoaded(smallPict, TILE_PICT_FIT);

            this.container.addChildAt(smallPict, 1);
        }
        this.built = true;
    }

    draw() {
        this.graphics.clear();
        if (this.active) {
            this.graphics.lineStyle(...this.brightStyle);
        }
        else {
            this.graphics.lineStyle(...this.dimStyle);
        }

        this.graphics.beginFill(0x000000);
        // Half-pixel origin so the 1px stroke, which PIXI centres on the
        // path, covers whole pixels instead of straddling two. Drawn from
        // (0,0) the left edge spanned x 586.5-587.5 and rasterized to 586,
        // one pixel left of the original's lattice (the reference grids'
        // vertical rules are at screen x 587/670/753/836/919 in both
        // shipyard/earth_spaceport.png and outfitter/earth_outfitter.png);
        // the horizontal rules happened to round the other way and were
        // already right. From (0.5,0.5) neither axis is ambiguous.
        this.graphics.drawRect(0.5, 0.5, TILE_SIZE[0], TILE_SIZE[1]);
    }

    hide() {
        this.container.visible = false;
        this.caption.visible = false;
    }

    show() {
        this.container.visible = true;
        this.caption.visible = true;
        this.build(); // Builds if not already built
    }

    moveTo(x: number, y: number) {
        this.container.position.set(x, y);
        this.caption.position.set(x, y);
    }

    get quantity() {
        return this.wrappedQuantity;
    }

    set quantity(count: number) {
        this.wrappedQuantity = count;
        if (this.wrappedQuantity == 0) {
            this.quantityText.text = "";
        }
        else {
            this.quantityText.text = String(this.quantity);
        }
    }

    get active() {
        return this.wrappedActive;
    }

    set active(val: boolean) {
        this.wrappedActive = val;
        this.draw();
    }
}


interface Item {
    name: string,
    id: string,
    desc: string,
    pict: string,
    /**
     * shïp / oütf ShortName, the caption the original prints on the tile
     * (see captionSegments); empty draws none. Items without the field
     * fall back to the resource name.
     */
    shortName?: string,
}

/**
 * Whether an item matches the shop search's query: a case-insensitive
 * substring of the name the player reads — the resource name without its
 * "; developer note" suffix, or the shïp / oütf ShortName caption the tile
 * shows (its "\n" line breaks read as spaces). Names only: descriptions
 * are long enough that a short query ("laser", "fed") would match half
 * the shop, which is not what a search box over a grid of names promises.
 * A blank query matches everything.
 */
export function itemMatches(item: { name: string, shortName?: string },
    query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) {
        return true;
    }
    const names = [displayName(item.name)];
    if (item.shortName) {
        names.push(item.shortName.replace(/\\n|\n/g, ' '));
    }
    return names.some(name =>
        name.replace(/\s+/g, ' ').toLowerCase().includes(q));
}

const BOX_COUNT = [4, 5];
/** Tiles on one page of the grid. */
export const ITEM_GRID_PAGE_SIZE = BOX_COUNT[0] * BOX_COUNT[1];
/** The grid's outer size, its closing rules included. */
const GRID_SIZE = [BOX_COUNT[0] * TILE_SIZE[0] + 1,
    BOX_COUNT[1] * TILE_SIZE[1] + 1] as const;

/** The parts of a PIXI container raiseToTop needs. */
export interface LayerContainer<C> {
    readonly children: readonly C[];
    addChild(child: C): unknown;
}

/**
 * Raises `child` above every other child of `container`, relying on
 * addChild's move-to-the-end semantics rather than an explicit index.
 *
 * Regression guard: this used to be addChildAt(tile, visibleTiles - 1),
 * which was correct only while the container held exactly one child per
 * visible tile. Once tiles were pooled by id (so the container keeps
 * every tile ever built while the visible list is a subset of them), that
 * index dropped the selected tile near the BOTTOM of the pool, and the
 * neighbouring tiles' opaque backgrounds painted over its red highlight —
 * leaving red visible only at the grid's edges, and the whole grid
 * looking like two misaligned copies. Deriving the position from the
 * container itself makes that class of bug impossible.
 */
export function raiseToTop<C>(container: LayerContainer<C>, child: C): void {
    container.addChild(child);
}

/**
 * The name every grid's root container carries, so the shop menus' display
 * lists can be inspected by name the way the Button:<label> containers are
 * (see shipyard_grid_build_test.ts, which counts them).
 */
export const ITEM_GRID_NAME = 'ItemGrid';

export class ItemGrid<I extends Item> {
    public activeTile = new BehaviorSubject<ItemTile<I> | undefined>(undefined);
    public container = new PIXI.Container();
    /** The tiles' frames, picts and counts (the selected one raised). */
    private tileLayer = new PIXI.Container();
    /**
     * Every tile's caption, above every tile (ItemTile.caption), clipped
     * CAPTION_CLIP_MARGIN outside the grid. Not hit-tested, so a caption
     * running over a neighbour never steals that neighbour's click.
     */
    private captionLayer = new PIXI.Container();
    /** Fires after the wheel scrolled the page, so the owner can update
     * its scroll arrows (the arrow and key paths update them directly). */
    readonly scrolled = new Subject<void>();
    private selectionIndex = -1;
    private scroll = 0;
    private tilesDict = new Map<string, ItemTile<I>>();
    private tiles: ItemTile<I>[];
    private readonly wheel = new WheelRowStepper();
    /** Every item the owner offers (setItems), before the search filter. */
    private allItems: I[];
    /** The shop search's query (setFilter); '' shows everything. */
    private filterText = '';

    constructor(private displayAssets: DisplayAssetDataInterface,
        private items: I[]) {
        this.container.name = ITEM_GRID_NAME;
        this.captionLayer.eventMode = 'none';
        this.captionLayer.interactiveChildren = false;
        this.container.addChild(this.tileLayer, this.captionLayer);
        this.allItems = items;
        this.tiles = items.map(item => this.tileFor(item));
        // The wheel over the grid, empty cells included (NovaJS
        // Enhancements, "Scroll wheel in shops"; the original's wheel does
        // nothing here). Read per event, so the toggle applies at once.
        this.container.eventMode = 'static';
        this.container.hitArea = new PIXI.Rectangle(0, 0,
            GRID_SIZE[0], GRID_SIZE[1]);
        this.container.on('wheel', (event: PIXI.FederatedWheelEvent) => {
            const native = event.nativeEvent as WheelEvent & {
                wheelDeltaY?: number };
            this.onWheel({
                deltaX: event.deltaX, deltaY: event.deltaY,
                deltaMode: event.deltaMode, ctrlKey: event.ctrlKey,
                wheelDeltaY: typeof native?.wheelDeltaY === 'number'
                    ? native.wheelDeltaY : undefined,
                timeStamp: event.timeStamp,
            });
        });
    }

    /**
     * One wheel event over the grid: scrolls the page by whole rows (see
     * WheelRowStepper) when the "Scroll wheel in shops" enhancement is on,
     * and does nothing at all when it is off. Public for specs and
     * headless driving.
     */
    onWheel(sample: Parameters<WheelRowStepper['rows']>[0]): void {
        if (!enhancementEnabled('enhShopScrollWheel')) {
            return;
        }
        const rows = this.wheel.rows(sample);
        if (rows !== 0 && this.scrollBy(rows)) {
            this.scrolled.next();
        }
    }

    /**
     * Masks the caption layer to the grid plus CAPTION_CLIP_MARGIN, once.
     * Built with the first tile rather than in the constructor: a
     * PIXI.Graphics needs a DOM, and an empty grid (specs) has none.
     */
    private clipCaptions() {
        if (this.captionLayer.mask) {
            return;
        }
        const clip = new PIXI.Graphics();
        clip.beginFill(0xffffff);
        clip.drawRect(-CAPTION_CLIP_MARGIN, -CAPTION_CLIP_MARGIN,
            GRID_SIZE[0] + 2 * CAPTION_CLIP_MARGIN,
            GRID_SIZE[1] + 2 * CAPTION_CLIP_MARGIN);
        clip.endFill();
        this.container.addChild(clip);
        this.captionLayer.mask = clip;
    }

    /** The tile for an item, built (and cached) on first use. Tiles are
     * pooled by id so setItems can show a different subset without
     * rebuilding sprites. */
    private tileFor(item: I): ItemTile<I> {
        const existing = this.tilesDict.get(item.id);
        if (existing) {
            return existing;
        }
        const tile = new ItemTile(this.displayAssets, item);
        this.clipCaptions();
        this.tileLayer.addChild(tile.container);
        this.captionLayer.addChild(tile.caption);
        tile.container.on('pointerdown', () => this.tileClicked(tile));
        this.tilesDict.set(item.id, tile);
        return tile;
    }

    /**
     * Replaces the displayed items, keeping the selection on the same item
     * when it survives the change (matched by id, since the caller may pass
     * freshly-loaded data objects). Tiles for items that dropped out are
     * hidden but kept in the pool, so toggling an item back in is cheap.
     * The scroll is clamped so a shorter list can't leave the view past the
     * end.
     */
    setItems(items: I[]) {
        this.allItems = items;
        this.showItems(this.allItems.filter(
            item => itemMatches(item, this.filterText)));
    }

    /**
     * Narrows the grid to the items whose name matches `query` (the shop
     * search, a NovaJS Enhancement; see itemMatches). The page goes back
     * to the top, and the selection stays on its item when that item
     * still matches (it clears otherwise, as for setItems). '' shows every
     * item again.
     */
    setFilter(query: string) {
        if (query === this.filterText) {
            return;
        }
        this.filterText = query;
        this.scroll = 0;
        this.setItems(this.allItems);
    }

    /** The current search query ('' when none). */
    get filter(): string {
        return this.filterText;
    }

    /** How many items the grid shows (after the search filter). */
    get itemCount(): number {
        return this.items.length;
    }

    private showItems(items: I[]) {
        const selectedId = this.items[this.selectionIndex]?.id;
        const shown = new Set(items.map(item => item.id));
        for (const [id, tile] of this.tilesDict) {
            if (!shown.has(id)) {
                tile.hide();
            }
        }
        this.items = items;
        this.tiles = items.map(item => this.tileFor(item));
        this.selectionIndex = selectedId === undefined ? -1
            : items.findIndex(item => item.id === selectedId);
        this.scroll = Math.min(this.scroll, this.maxScroll);
        this.drawGrid();
    }

    get selection() {
        return this.items[this.selectionIndex];
    }

    set selection(item) {
        this.selectionIndex = this.items.indexOf(item);
        this.drawGrid();
    }

    tileClicked(tile: ItemTile<I>) {
        this.selectionIndex = this.tiles.indexOf(tile);

        this.drawGrid();
    }

    drawGrid() {
        // Hide everything first. Reveal them later
        this.tiles.forEach(function(t) {
            t.hide();
        });

        const start = BOX_COUNT[0] * this.scroll;

        for (let i = 0; i < Math.min(this.items.length - start, BOX_COUNT[0] * BOX_COUNT[1]); i++) {
            var itemIndex = i + start;
            var tile = this.tiles[itemIndex];
            let xcount = i % BOX_COUNT[0];
            let ycount = Math.floor(i / BOX_COUNT[0]);

            tile.show();
            if (itemIndex === this.selectionIndex) {
                tile.active = true;
                // send which one is selected
                this.activeTile.next(tile);

                // Make sure it is above the others
                raiseToTop(this.tileLayer, tile.container);
            }

            else {
                tile.active = false;
            }

            tile.moveTo(xcount * TILE_SIZE[0], ycount * TILE_SIZE[1])
            tile.draw();
        }
        // No selection (e.g. setItems emptied the grid, or the selected
        // item vanished): tell subscribers so detail panes clear instead
        // of lingering on the last selection. Guarded so redraws with a
        // live selection don't churn the subject.
        if (this.selectionIndex === -1 && this.activeTile.value !== undefined) {
            this.activeTile.next(undefined);
        }
    }

    /** The furthest the grid can scroll: the top row of the last page. */
    private get maxScroll() {
        const rows = Math.ceil(this.items.length / BOX_COUNT[0]);
        return Math.max(0, rows - BOX_COUNT[1]);
    }

    /** True when more items exist above / below the visible page. */
    get canScrollUp() {
        return this.scroll > 0;
    }
    get canScrollDown() {
        return this.scroll < this.maxScroll;
    }

    /**
     * Scrolls the visible page up / down by ONE ROW, for the scroll-arrow
     * buttons (the view moves without changing the selection). The
     * original's outfitter and shipyard arrows move a row a click, on the
     * release, and a held arrow does not repeat (reference "Scrolling ...
     * wave 12"); the arrows fire on the release (ScrollArrow.click).
     */
    scrollUp() {
        this.scrollBy(-1);
    }
    scrollDown() {
        this.scrollBy(1);
    }

    /** Scrolls the visible page by `rows` (negative = up), clamped to the
     * list. The selection stays where it is. Returns whether it moved. */
    scrollBy(rows: number): boolean {
        const next = Math.max(0, Math.min(this.maxScroll, this.scroll + rows));
        if (next === this.scroll) {
            return false;
        }
        this.scroll = next;
        this.drawGrid();
        return true;
    }

    /** The top visible row (0 = the first). */
    get scrollRow(): number {
        return this.scroll;
    }

    setCounts(items: Map<string, number>) {
        for (const tile of this.tiles) {
            tile.quantity = 0;
        }

        for (const [id, count] of items) {
            const tile = this.tilesDict.get(id);
            if (tile) {
                tile.quantity = count;
            }
        }
    }

    left() {
        if (this.selectionIndex === -1) {
            this.selectionIndex = Math.min(BOX_COUNT[0] * BOX_COUNT[1],
                this.items.length);
        }
        else {
            this.selectionIndex -= 1;
            if (this.selectionIndex < 0) {
                this.selectionIndex = 0;
            }
        }

        if (this.scroll * BOX_COUNT[0] > this.selectionIndex) {
            this.scroll -= 1;
        }
        this.drawGrid();
    }

    right() {
        if (this.selectionIndex === -1) {
            this.selectionIndex = 0;
        }
        else {
            this.selectionIndex += 1;
            if (this.selectionIndex > this.items.length - 1) {
                this.selectionIndex = this.items.length - 1;
            }

        }
        if (this.scroll * BOX_COUNT[0] +
            BOX_COUNT[0] * BOX_COUNT[1] <= this.selectionIndex) {
            this.scroll += 1;
        }
        this.drawGrid();
    }

    up() {
        if (this.selectionIndex === -1) {
            this.selectionIndex = Math.min(BOX_COUNT[0] * BOX_COUNT[1],
                this.items.length);
        }
        else if (this.selectionIndex - BOX_COUNT[0] >= 0) {
            this.selectionIndex -= BOX_COUNT[0];
        }

        if (this.scroll * BOX_COUNT[0] > this.selectionIndex) {
            this.scroll -= 1;
        }
        this.drawGrid();
    }

    down() {
        if (this.selectionIndex === -1) {
            this.selectionIndex = 0;
        }
        else if (this.selectionIndex + BOX_COUNT[0] < this.items.length) {
            this.selectionIndex += BOX_COUNT[0];
        }
        else {
            this.selectionIndex = this.items.length - 1;
        }

        if (this.scroll * BOX_COUNT[0] +
            BOX_COUNT[0] * BOX_COUNT[1] <= this.selectionIndex) {
            this.scroll += 1;
        }

        this.drawGrid();
    }

}
