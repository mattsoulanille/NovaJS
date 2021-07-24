import { ShipData } from 'novadatainterface/ShipData';
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import * as PIXI from 'pixi.js';
import { Observable } from 'rxjs';
import { GameData } from '../client/gamedata/GameData';
import { ControlEvent } from '../nova_plugin/controls_plugin';
import { makeShip } from '../nova_plugin/make_ship';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin';
import { Button } from './button';
import { ItemGrid, ItemTile } from './item_grid';
import { Menu } from './menu';
import { MenuControls } from './menu_controls';
import { FONT } from './outfitter';


export class Shipyard {
    container = new PIXI.Container();
    private pictContainer = new PIXI.Container();
    menu: Menu;
    private controls: MenuControls | undefined;
    itemGrid?: ItemGrid<ShipData>;
    built = false;
    private wrappedVisible = false;
    private text = {
        description: new PIXI.Text("", FONT.normal),
    }

    constructor(private gameData: GameData,
        private controlEvents: Observable<ControlEvent>,
        private ship: Entity,
        private setShip: (ship: Entity) => void) {

        const buttons = {
            buy: new Button(gameData, "Buy", 60, { x: -20, y: 126 }),
            done: new Button(gameData, "Done", 60, { x: 100, y: 126 }),
        };

        this.menu = new Menu(gameData, "nova:8502", buttons);
        this.container.addChild(this.menu.container);

        buttons.buy.click.subscribe(this.buyShip.bind(this));
        buttons.done.click.subscribe(this.depart.bind(this));

        this.text.description.position.x = -27;
        this.text.description.position.y = -150;
        this.container.addChild(this.text.description);
        this.pictContainer.position.x = 174;
        this.pictContainer.position.y = -152.5;
        this.container.addChild(this.pictContainer);
        this.build();
    }

    private async build() {
        if (this.built) {
            return;
        }

        const itemGrid = await this.makeShipsGrid();
        this.itemGrid = itemGrid;
        this.container.addChild(itemGrid.container);

        this.itemGrid.drawGrid();
        this.itemGrid.container.position.x = -373;
        this.itemGrid.container.position.y = -153;
        this.itemGrid.activeTile.subscribe(this.setShipSelected.bind(this));

        this.controls = new MenuControls(this.controlEvents, {
            left: () => itemGrid.left(),
            right: () => itemGrid.right(),
            up: () => itemGrid.up(),
            down: () => itemGrid.down(),
            buy: this.buyShip.bind(this),
            depart: this.depart.bind(this),
        });

        this.built = true;
    }

    private async makeShipsGrid() {
        const ids = (await this.gameData.ids).Ship;
        const ships = await Promise.all(ids.map(id => this.gameData.data.Ship.get(id)));
        ships.sort((a, b) => b.displayWeight - a.displayWeight);
        const itemGrid = new ItemGrid(this.gameData, ships);
        return itemGrid;
    }

    private setShipSelected(shipTile: ItemTile<ShipData> | undefined) {
        this.pictContainer.children.length = 0;
        if (!shipTile) {
            return;
        }

        if (shipTile.largePict) {
            this.pictContainer.addChild(shipTile.largePict);
        }

        // Set Description
        this.text.description.text = shipTile.item.desc;
    }

    private buyShip() {
        if (!this.itemGrid?.selection) {
            return;
        }
        const multiplayerData = this.ship.components.get(MultiplayerData);
        if (!multiplayerData) {
            console.warn('Missing multiplayer data for prior ship.');
            return;
        }

        this.ship = makeShip(this.itemGrid.selection);
        this.ship.components.set(PlayerShipSelector, undefined);
        this.ship.components.set(MultiplayerData, multiplayerData);
    }

    private depart() {
        this.setShip(this.ship);
    }

    set visible(visible: boolean) {
        this.wrappedVisible = visible;
        this.container.visible = visible;
        if (visible) {
            this.controls?.bind();
        } else {
            this.controls?.unbind();
        }
    }

    get visible() {
        return this.wrappedVisible;
    }
}
