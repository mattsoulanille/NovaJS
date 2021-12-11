import { Container } from "@pixi/display";
import { Text } from "@pixi/text";
import { OutfitData } from "novadatainterface/OutiftData";
import { DefaultMap } from "nova_ecs/utils";
import { Observable } from "rxjs";
import { GameData } from "../client/gamedata/GameData";
import { ControlEvent } from "../nova_plugin/controls_plugin";
import { OutfitsState } from "../nova_plugin/outfit_plugin";
import { Button } from "./button";
import { ItemGrid, ItemTile } from "./item_grid";
import { Menu } from "./menu";


const descWidth = 190;
export const FONT = {
    normal: {
        fontFamily: "Geneva", fontSize: 10, fill: 0xffffff,
        align: 'left', wordWrap: true, wordWrapWidth: descWidth
    } as const,
    grey: {
        fontFamily: "Geneva", fontSize: 10, fill: 0x262626,
        align: 'left', wordWrap: true, wordWrapWidth: descWidth
    } as const,
    count: {
        fontFamily: "Geneva", fontSize: 10, fill: 0xffffff,
        align: 'right', wordWrap: false, wordWrapWidth: descWidth
    } as const,
};

export class Outfitter extends Menu<OutfitsState> {
    private itemGrid?: ItemGrid<OutfitData>;
    private pictContainer = new Container();
    private outfits: DefaultMap<string, number>;

    private text = {
        description: new Text("", FONT.normal),
        itemPrice: new Text("Item Price:", FONT.normal),
        price: new Text("5,000 cr", FONT.normal),
        youHave: new Text("You Have:", FONT.normal),
        count: new Text("∞ cr", FONT.normal),
        itemMass: new Text("Item Mass:", FONT.normal),
        mass: new Text("3", FONT.normal),
        availableMass: new Text("Available:", FONT.normal),
        freeMass: new Text("", FONT.normal),
    }

    constructor(gameData: GameData,
        controlEvents: Observable<ControlEvent>) {
        super(gameData, "nova:8502", controlEvents);

        this.outfits = new DefaultMap(() => 0);
        const buttons = {
            buy: new Button(gameData, "Buy", 60, { x: -100, y: 126 }),
            sell: new Button(gameData, "Sell", 60, { x: 0, y: 126 }),
            done: new Button(gameData, "Done", 60, { x: 100, y: 126 })
        };

        buttons.buy.click.subscribe(this.buyOutfit.bind(this));
        buttons.sell.click.subscribe(this.sellOutfit.bind(this));
        buttons.done.click.subscribe(this.done.bind(this));
        this.addButtons(buttons);

        this.pictContainer.position.x = 174;
        this.pictContainer.position.y = -152.5;
        this.pictContainer.scale.x = 1;
        this.pictContainer.scale.y = 1;
        this.container.addChild(this.pictContainer);

        this.text.description.position.x = -27;
        this.text.description.position.y = -150;

        this.text.itemPrice.position.x = 234;
        this.text.itemPrice.position.y = 58;

        this.text.price.position.x = 300;
        this.text.price.position.y = 58;

        this.text.youHave.position.x = 234;
        this.text.youHave.position.y = 70;

        this.text.count.position.x = 300;
        this.text.count.position.y = 70;

        this.text.itemMass.position.x = 234;
        this.text.itemMass.position.y = 94;

        this.text.mass.position.x = 300;
        this.text.mass.position.y = 94;

        this.text.availableMass.position.x = 234;
        this.text.availableMass.position.y = 106;

        this.text.freeMass.position.x = 300;
        this.text.freeMass.position.y = 106;

        for (const t of Object.values(this.text)) {
            this.container.addChild(t);
        }
    }

    protected async build() {
        const itemGrid = await this.makeOutfitsGrid();
        this.itemGrid = itemGrid;
        this.container.addChild(this.itemGrid.container);

        this.itemGrid.drawGrid();
        this.itemGrid.container.position.x = -373;
        this.itemGrid.container.position.y = -153;
        this.itemGrid.activeTile.subscribe(this.setOutfitSelected.bind(this));

        this.controls.controls = {
            left: () => itemGrid.left(),
            right: () => itemGrid.right(),
            up: () => itemGrid.up(),
            down: () => itemGrid.down(),
            buy: this.buyOutfit.bind(this),
            sell: this.sellOutfit.bind(this),
            depart: this.done.bind(this),
        };
    }

    private async makeOutfitsGrid() {
        const ids = (await this.gameData.ids).Outfit;
        const outfits = await Promise.all(ids.map(id =>
            this.gameData.data.Outfit.get(id, 100)));
        outfits.sort((a, b) => b.displayWeight - a.displayWeight);
        const itemGrid = new ItemGrid(this.gameData, outfits);
        itemGrid.setCounts(this.outfits);
        return itemGrid;
    }

    private buyOutfit() {
        //const mass = this.itemGrid?.selection.physics.freeMass;
        //if (mass <= global.myShip.properties.physics.freeMass) {
        const id = this.itemGrid?.selection.id;
        if (!id) {
            return;
        }
        this.outfits.set(id, this.outfits.get(id) + 1);

        //     global.myShip.addOutfit(outfit, false);
        // global.myShip.properties.physics.freeMass -= mass;
        // this.setFreeMassText();
        this.itemGrid?.setCounts(this.outfits);
        //}
    }

    private sellOutfit() {
        const id = this.itemGrid?.selection.id;
        if (!id) {
            return;
        }
        this.outfits.set(id, Math.max(0, this.outfits.get(id) - 1));
        if (this.outfits.get(id) === 0) {
            this.outfits.delete(id);
        }
        // var outfit = { id: this.itemGrid.selection.id, count: 1 };
        // if (global.myShip.removeOutfit(outfit, false)) {
        //     global.myShip.properties.physics.freeMass += this.itemGrid.selection.physics.freeMass;
        // }
        // this.setFreeMassText();
        this.itemGrid?.setCounts(this.outfits);
    }

    private setOutfitSelected(outfitTile: ItemTile<OutfitData> | undefined) {
        // Set Picture
        this.pictContainer.children.length = 0;
        this.text.description.text = "";
        this.text.price.text = "";
        this.text.mass.visible = false;
        this.text.itemMass.visible = false;
        this.text.availableMass.visible = false;
        this.text.freeMass.visible = false;

        if (!outfitTile) {
            return;
        }

        if (outfitTile.largePict) {
            this.pictContainer.addChild(outfitTile.largePict);
        }

        // Set Description
        this.text.description.text = outfitTile.item.desc;

        // Set price text
        this.text.price.text = formatPrice(outfitTile.item.price);

        if (outfitTile.item.physics.freeMass > 0) {
            // Set mass text
            this.text.mass.text = outfitTile.item.physics.freeMass + " tons";
            this.setFreeMassText();
            this.text.mass.visible = true;
            this.text.itemMass.visible = true;
            this.text.availableMass.visible = true;
            this.text.freeMass.visible = true;
        }
    }

    private setFreeMassText() {
        //this.text.freeMass.text = formatMass(global.myShip.properties.physics.freeMass);
    }

    protected setInput(input: OutfitsState) {
        this.outfits = new DefaultMap(() => 0, [...input].map(
            ([k, v]) => [k, v.count]));
        super.setInput(input);
        this.itemGrid?.setCounts(this.outfits);
    }

    protected done() {
        this.input = new Map([...this.outfits]
            .map(([id, count]) => [id, { count }]));
        super.done();
    }
}

function addCommas(p: number) {
    return p.toLocaleString();
}

function formatPrice(p: number) {
    var mil = 1000000;
    if (p >= mil) {
        var modmil = String(p % mil).substring(0, 3);
        modmil += "0".repeat(3 - modmil.length);
        return addCommas(Math.floor(p / mil)) + "." + modmil + "M cr";
    }
    else {
        return addCommas(p) + " cr";
    }
};

function formatMass(m: number) {
    return m.toLocaleString() + " tons";
};
