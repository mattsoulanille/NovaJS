import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import * as PIXI from "pixi.js";
import { Position } from "../../engine/space_object/Position";
import { SpaceObjectView, SystemView, ISystemView } from "../../engine/TreeView";
import { Vector } from "../../engine/Vector";
import { DrawableMap } from "./DrawableMap";
import { SpaceObjectDrawable } from "./SpaceObjectDrawable";


export class Display {
    readonly displayObject = new PIXI.Container();
    readonly systemContainer = new PIXI.Container();
    private readonly gameData: GameDataInterface;
    //private statusBar: StatusBar;
    readonly buildPromise: Promise<unknown>;
    //    private activeShip: string | undefined; // The uuid of the ship to render from.
    built: boolean; // Is this necessary or used?

    private readonly spaceObjects =
        new DrawableMap<SpaceObjectDrawable, SpaceObjectView>(
            () => new SpaceObjectDrawable(this.gameData));

    private wrappedTarget!: string | Position;
    private targetPosition: Position;

    constructor({ gameData, target }: { gameData: GameDataInterface, target?: Position | string }) {
        this.gameData = gameData;
        this.displayObject.addChild(this.systemContainer);
        this.systemContainer.addChild(this.spaceObjects.displayObject);

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

    private setTargetPosition(view: ISystemView) {
        if (!(this.target instanceof Vector)) {
            const spaceObjects = view.families.spaceObjects;
            let targetObject = spaceObjects.get(this.target);
            if (targetObject !== undefined) {
                this.targetPosition = Position.fromProto(targetObject.protobuf.position);
            }
        }
    }

    draw(state: ISystemView) {
        this.setTargetPosition(state);

        this.spaceObjects.draw(
            state.families.spaceObjects,
            this.targetPosition);
        //this.statusBar.draw(state, this.targetPosition)
    }

    set target(target: string | Position) {
        if (target instanceof Position) {
            this.targetPosition = target;
        }
        this.wrappedTarget = target;
    }

    get target() {
        return this.wrappedTarget;
    }

    resize(x: number, y: number) {
        //this.dimensions = new Vector(x, y);
        //this.statusBar.resize(x, y);
        //this.systemContainer.position.x = (x - this.statusBar.width) / 2;
        this.systemContainer.position.x = x / 2;
        this.systemContainer.position.y = y / 2;
    }
}
