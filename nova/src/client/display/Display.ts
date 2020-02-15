import { SystemState } from "novajs/nova/src/proto/system_state_pb";
import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import * as PIXI from "pixi.js";
import { Position } from "../../engine/Position";
import { Vector } from "../../engine/Vector";
import { GameData } from "../gamedata/GameData";

class Display {
    readonly container: PIXI.Container;
    readonly systemContainer: PIXI.Container;
    private readonly gameData: GameDataInterface;
    //private statusBar: StatusBar;
    readonly buildPromise: Promise<unknown>;
    //    private activeShip: string | undefined; // The uuid of the ship to render from.
    built: boolean;

    //private readonly shipDrawer: PersistentMultiDrawer<ShipDrawable, ShipState>;
    //private readonly planetDrawer: PersistentMultiDrawer<PlanetDrawable, PlanetState>;

    private _target!: string | Position;
    private targetPosition: Position;
    private dimensions: Vector; // To be used for the starfield

    constructor({ container, gameData, target }: { container: PIXI.Container, gameData: GameData, target?: Position | string }) {
        this.gameData = gameData;
        this.container = container;
        this.systemContainer = new PIXI.Container();
        this.container.addChild(this.systemContainer);

        // this.statusBar = new StatusBar({
        //     gameData: gameData
        // });
        // this.container.addChild(this.statusBar);

        //this.planetDrawer = new PersistentMultiDrawer(PlanetDrawable.getFactory(gameData));
        //this.systemContainer.addChild(this.planetDrawer.displayObject);

        //this.shipDrawer = new PersistentMultiDrawer(ShipDrawable.getFactory(gameData));
        //this.systemContainer.addChild(this.shipDrawer.displayObject);


        this.dimensions = new Vector(10, 10);
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

    draw(state: SystemState) {

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

        // this.shipDrawer.clear();
        // for (const [_shipUUID, shipState] of state.getShipsMap().getEntryList()) {
        //     this.shipDrawer.draw(shipState, this.targetPosition);
        // }

        // this.planetDrawer.clear();
        // for (const [_planetUUID, planetState] of state.getPlanetsMap().getEntryList()) {
        //     this.planetDrawer.draw(planetState, this.targetPosition);
        // }

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

    resize(x: number, y: number) {
        this.dimensions = new Vector(x, y);
        //this.statusBar.resize(x, y);
        //this.systemContainer.position.x = (x - this.statusBar.width) / 2;
        //this.systemContainer.position.y = y / 2;
    }
}

export { Display };
