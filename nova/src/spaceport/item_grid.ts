import { Text } from '@pixi/text';
import { BehaviorSubject } from 'rxjs';
import { GameData } from '../client/gamedata/GameData';
import { Graphics } from '@pixi/graphics';
import { Container } from '@pixi/display';

const TILE_SIZE = [83, 54];

export class ItemTile<I extends Item> {
    private font = {
        normal: {
            fontFamily: "Geneva", fontSize: 10, fill: 0xffffff,
            align: 'center', wordWrap: true, wordWrapWidth: TILE_SIZE[0]
        } as const,
        grey: {
            fontFamily: "Geneva", fontSize: 10, fill: 0x262626,
            align: 'center', wordWrap: true, wordWrapWidth: TILE_SIZE[0]
        } as const,
        count: {
            fontFamily: "Geneva", fontSize: 10, fill: 0xffffff,
            align: 'right', wordWrap: false, wordWrapWidth: TILE_SIZE[0]
        } as const,
    };

    // TODO: Use the colr resource
    private colors = {
        dim: 0x404040,
        bright: 0xFF0000,
    };
    private lineWidth = 1;
    private dimStyle = [this.lineWidth, this.colors.dim] as const;
    private brightStyle = [this.lineWidth, this.colors.bright] as const;
    private graphics = new Graphics();
    private wrappedQuantity = 0;
    private quantityText: Text;
    readonly container = new Container();
    private wrappedActive = false;
    public built = false;
    public largePict = new Container();

    constructor(private gameData: GameData, readonly item: I) {
        const nameText = new Text(item.name, this.font.normal);
        nameText.anchor.x = 0.5;
        nameText.position.x = TILE_SIZE[0] / 2;
        nameText.position.y = TILE_SIZE[1] / 2;

        this.quantityText = new Text("", this.font.normal);
        this.quantityText.anchor.x = 1;
        this.quantityText.position.x = TILE_SIZE[0] - 2;
        this.quantityText.position.y = 2;

        this.container.interactive = true;
        this.active = false;

        this.container.addChild(this.graphics);
        this.container.addChild(nameText);
        this.container.addChild(this.quantityText);
    }

    build() {
        if (this.built) {
            return;
        }

        if (this.item.pict) {
            const smallPict = this.gameData.spriteFromPict(this.item.pict);
            const largePict = this.gameData.spriteFromPict(this.item.pict);
            this.largePict.addChild(largePict);
            smallPict.anchor.x = 0.5;
            smallPict.position.x = TILE_SIZE[0] / 2;
            smallPict.position.y = 1;

            const scale = 0.15;
            smallPict.scale.x = scale;
            smallPict.scale.y = scale;

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
        this.graphics.drawRect(0, 0, TILE_SIZE[0], TILE_SIZE[1]);
    }

    hide() {
        this.container.visible = false;
    }

    show() {
        this.container.visible = true;
        this.build(); // Builds if not already built
    }

    moveTo(x: number, y: number) {
        this.container.position.x = x;
        this.container.position.y = y;
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
}

const BOX_COUNT = [4, 5];

export class ItemGrid<I extends Item> {
    public activeTile = new BehaviorSubject<ItemTile<I> | undefined>(undefined);
    public container = new Container();
    private selectionIndex = -1;
    private scroll = 0;
    private tilesDict = new Map<string, ItemTile<I>>();
    private tiles: ItemTile<I>[];

    constructor(gameData: GameData, private items: I[]) {
        this.tiles = items.map(item => {
            const tile = new ItemTile(gameData, item);
            this.container.addChild(tile.container);
            tile.container.on('pointerdown', () => this.tileClicked(tile));
            this.tilesDict.set(item.id, tile);
            return tile;
        });
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
        console.log(tile);
        console.log(this.selectionIndex);

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
                this.container.addChildAt(tile.container, this.tiles.length - 1);
            }

            else {
                tile.active = false;
            }

            tile.moveTo(xcount * TILE_SIZE[0], ycount * TILE_SIZE[1])
            tile.draw();
        }
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
