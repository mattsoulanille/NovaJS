import * as PIXI from "pixi.js";
import { PlanetState } from "../../engine/PlanetState";
import { ShipState } from "../../engine/ShipState";
import { SystemState } from "../../engine/SystemState";
import { Vector } from "../../engine/Vector";
import { GameData } from "../GameData";
import { ObjectDrawer } from "./ObjectDrawer";
import { PlanetGraphic } from "./PlanetGraphic";
import { ShipGraphic } from "./ShipGraphic";
import { StatusBar } from "./StatusBar";


class Display {
    readonly container: PIXI.Container;
    private readonly systemContainer: PIXI.Container;
    private readonly gameData: GameData;
    private statusBarContainer: PIXI.Container;
    private statusBar: StatusBar;
    readonly buildPromise: Promise<unknown>;
    //    private activeShip: string | undefined; // The uuid of the ship to render from.
    built: boolean;

    private readonly shipDrawer: ObjectDrawer<ShipState, ShipGraphic>;
    private readonly planetDrawer: ObjectDrawer<PlanetState, PlanetGraphic>;

    private _target!: string | Vector;
    private dimensions: Vector;

    constructor({ container, gameData, target }: { container: PIXI.Container, gameData: GameData, target?: Vector | string }) {
        this.gameData = gameData;
        this.container = container;
        this.systemContainer = new PIXI.Container();
        this.systemContainer.pivot
        this.container.addChild(this.systemContainer);
        this.statusBarContainer = new PIXI.Container();
        this.container.addChild(this.statusBarContainer);
        this.statusBar = new StatusBar({
            container: this.statusBarContainer,
            gameData: this.gameData
        });

        this.shipDrawer = new ObjectDrawer({
            gameData: this.gameData,
            graphicClass: ShipGraphic
        });
        this.shipDrawer.zOrder = 100;
        this.systemContainer.addChild(this.shipDrawer);

        this.planetDrawer = new ObjectDrawer({
            gameData: this.gameData,
            graphicClass: PlanetGraphic
        });
        this.planetDrawer.zOrder = 10;
        this.systemContainer.addChild(this.planetDrawer);

        this.dimensions = new Vector(10, 10);
        this.built = false;
        this.buildPromise = Promise.all([this.statusBar.buildPromise])
        this.buildPromise.then(() => { this.built = true });

        if (target !== undefined) {
            this.target = target;
        }
        else {
            this.target = new Vector(0, 0);
        }
    }

    draw(state: SystemState) {
        if (!(this.target instanceof Vector)) {
            let targetShip = state.ships[this.target];
            if (targetShip !== undefined) {
                let middle = this.dimensions.copy();
                middle.x -= this.statusBar.width;
                middle.scaleBy(-0.5);
                middle.add(targetShip.position);
                this.setViewpoint(middle);
            }
        }

        for (let shipID in state.ships) {
            let shipState = state.ships[shipID];
            this.shipDrawer.draw(shipState, shipID);
        }
        this.shipDrawer.cleanup();

        for (let planetID in state.planets) {
            let planetState = state.planets[planetID];
            this.planetDrawer.draw(planetState, planetID);
        }
    }

    private setViewpoint(v: { x: number, y: number }) {
        // Negative because that's how you cancel out
        // positions
        this.systemContainer.position.x = -v.x;
        this.systemContainer.position.y = -v.y;
    }

    set target(target: string | Vector) {
        if (target instanceof Vector) {
            this.setViewpoint(target);
        }
        this._target = target;
    }
    get target() {
        return this._target;
    }

    resize(x: number, y: number) {
        this.dimensions = new Vector(x, y);
        this.statusBar.resize(x, y);
    }

}

export { Display };
