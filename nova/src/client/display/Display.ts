import { SystemState } from "novajs/nova/src/proto/system_state_pb";
import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import * as PIXI from "pixi.js";
import { Position } from "../../engine/Position";
import { Vector } from "../../engine/Vector";
import { DrawableMap } from "./DrawableMap";
import { ShipDrawable } from "./ShipDrawable";
import { PlanetDrawable } from "./PlanetDrawable";
import { PlanetState } from "novajs/nova/src/proto/planet_state_pb";
import { ShipState } from "novajs/nova/src/proto/ship_state_pb";

export class Display {
    readonly displayObject = new PIXI.Container();
    readonly systemContainer = new PIXI.Container();
    private readonly gameData: GameDataInterface;
    //private statusBar: StatusBar;
    readonly buildPromise: Promise<unknown>;
    //    private activeShip: string | undefined; // The uuid of the ship to render from.
    built: boolean;

    private readonly ships =
        new DrawableMap<ShipDrawable, ShipState>(
            () => new ShipDrawable(this.gameData));
    private readonly planets =
        new DrawableMap<PlanetDrawable, PlanetState>(
            () => new PlanetDrawable(this.gameData));

    private _target!: string | Position;
    private targetPosition: Position;

    constructor({ gameData, target }: { gameData: GameDataInterface, target?: Position | string }) {
        this.gameData = gameData;
        this.displayObject.addChild(this.systemContainer);
        this.systemContainer.addChild(this.ships.displayObject);
        this.systemContainer.addChild(this.planets.displayObject);

        // this.statusBar = new StatusBar({
        //     gameData: gameData
        // });
        // this.container.addChild(this.statusBar);

        //this.planetDrawer = new PersistentMultiDrawer(PlanetDrawable.getFactory(gameData));
        //this.systemContainer.addChild(this.planetDrawer.displayObject);

        //this.shipDrawer = new PersistentMultiDrawer(ShipDrawable.getFactory(gameData));
        //this.systemContainer.addChild(this.shipDrawer.displayObject);

        this.built = false;
        this.buildPromise = Promise.resolve();
        //this.buildPromise = Promise.all([this.statusBar.buildPromise])
        this.buildPromise.then(() => { this.built = true });

        this.targetPosition = new Position(0, 0);
        if (target !== undefined) {
            this.target = target;
        }
        else {
            this.target = new Position(0, 0);
        }
    }

    private setTargetPosition(state: SystemState) {
        if (!(this.target instanceof Vector)) {
            const ships = state.getShipsMap();
            let targetShip = ships.get(this.target);
            if (targetShip !== undefined) {
                const positionProto = targetShip
                    .getSpaceobjectstate()?.getPosition();

                if (positionProto) {
                    this.targetPosition = Position.fromProto(positionProto);
                }
                else {
                    this.targetPosition = new Position(0, 0);
                }
            }
        }
    }

    draw(state: SystemState) {
        this.setTargetPosition(state);

        this.ships.draw(state.getShipsMap().getEntryList(),
            this.targetPosition);

        this.planets.draw(state.getPlanetsMap().getEntryList(),
            this.targetPosition);
        //this.statusBar.draw(state, this.targetPosition)
    }

    set target(target: string | Position) {
        if (target instanceof Position) {
            this.targetPosition = target;
        }
        this._target = target;
    }

    get target() {
        return this._target;
    }

    resize(_x: number, _y: number) {
        //this.dimensions = new Vector(x, y);
        //this.statusBar.resize(x, y);
        //this.systemContainer.position.x = (x - this.statusBar.width) / 2;
        //this.systemContainer.position.y = y / 2;
    }
}
