import { GameState } from "../../engine/GameState";
import * as PIXI from "pixi.js";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { StatusBar } from "./StatusBar";
import { GameData } from "../GameData";
import { SpriteSheetSprite } from "./SpriteSheetSprite";
import { ShipData } from "novadatainterface/ShipData";
import { ShipState } from "../../engine/ShipState";
import { ShipGraphic } from "./ShipGraphic";
import { SystemState } from "../../engine/SystemState";
import { Vector } from "../../engine/Vector";
import { PlanetState } from "../../engine/PlanetState";
import { PlanetGraphic } from "./PlanetGraphic";
import { SpaceObjectState } from "../../engine/SpaceObjectState";
import { FactoryQueueMap } from "../../common/FactoryQueueMap";
import { IDGraphic } from "./IDGraphic";
import { AnimationGraphic } from "./AnimationGraphic";
import { ObjectDrawer } from "./ObjectDrawer";


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
        this.systemContainer.addChild(this.shipDrawer);
        this.planetDrawer = new ObjectDrawer({
            gameData: this.gameData,
            graphicClass: PlanetGraphic
        });
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
            let ship = state.ships[shipID];
            this.shipDrawer.draw(ship, shipID);
        }
        this.shipDrawer.cleanup();
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

	/*
    private drawObject<O extends SpaceObjectState>(
        state: O,
        uuid: string,
        storage: { [index: string]: PIXI.Container },
        buildNew: (id: string) => PIXI.Container) {

        if (!(uuid in storage)) {
            let newGraphic = buildNew(
                this.shipGraphics[uuid] = newGraphic;
            this.systemContainer.addChild(newGraphic);
        }

        let s = this.shipGraphics[uuid];
        s.drawState(ship);


    }


    private drawShip(ship: ShipState, uuid: string) {
        if (!(uuid in this.shipGraphics)) {
            let newGraphic = new ShipGraphic({
                gameData: this.gameData,
                id: ship.id
            });
            this.shipGraphics[uuid] = newGraphic;
            this.systemContainer.addChild(newGraphic);
        }

        let s = this.shipGraphics[uuid];
        s.drawState(ship);
    }

    private drawPlanet(planet: PlanetState, uuid: string) {
        if (!(uuid in this.planetGraphics)) {
            let newGraphic = new PlanetGraphic({
                gameData: this.gameData,
                id: planet.id
            });
            this.planetGraphics[uuid] = newGraphic;
            this.systemContainer.addChild(newGraphic);
        }
        let p = this.planetGraphics[uuid];
        p.drawState(planet);
    }
*/

    resize(x: number, y: number) {
        this.dimensions = new Vector(x, y);
        this.statusBar.resize(x, y);
    }

}

export { Display }
