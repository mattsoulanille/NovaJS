import { PlanetData } from "novadatainterface/PlanetData";
import { ShipData } from "novadatainterface/ShipData";
import { StatusBarData } from "novadatainterface/StatusBarData";
import { UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { Plugin } from "nova_ecs/plugin";
import { MovementState, MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Provide, ProvideAsync } from "nova_ecs/provider";
import { Query } from "nova_ecs/query";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import { GameData } from "../client/gamedata/GameData";
import { GameDataResource } from "../nova_plugin/game_data_resource";
import { PlanetDataComponent } from "../nova_plugin/planet_plugin";
import { PlayerShipSelector } from "../nova_plugin/ship_controller_plugin";
import { ShipDataComponent } from "../nova_plugin/ship_plugin";
import { ResizeEvent } from "./resize_event";
import { Stage } from "./stage_resource";


class StatusBar {
    readonly container = new PIXI.Container();
    readonly built: Promise<void>;
    width = 0;
    private radarScale = new Vector(6000, 6000);
    private radar = new PIXI.Graphics();
    radarPeriod = 200;

    constructor(private statusBarData: StatusBarData, private gameData: GameData) {
        this.built = this.build();
    }

    private async build() {
        const background = await this.gameData.spriteFromPict(this.statusBarData.image);
        this.container.addChild(background);
        this.width = background.width;
        const dataAreas = this.statusBarData.dataAreas;
        [this.radar.position.x, this.radar.position.y] = dataAreas.radar.position;
        this.container.addChild(this.radar);
    }

    drawRadar(source: Position, ships: Iterable<readonly [string, MovementState, ShipData]>,
        planets: Iterable<readonly [string, MovementState, PlanetData]>) {
        this.radar.clear();
        this.drawDot(source, this.statusBarData.colors.brightRadar, source);

        for (const [, { position }] of ships) {
            const color = this.statusBarData.colors.dimRadar;
            this.drawDot(position, color, source);
        }

        for (const [, { position }] of planets) {
            this.drawDot(position, 0xFFFF00, source, 2);
        }
    }

    private drawDot(dotPos: Position, color: number, source = new Position(0, 0), size = 1) {
        // draws a dot from nova position
        const radarSize = new Vector(...this.statusBarData.dataAreas.radar.size);
        const pixiPos = new Vector(dotPos.x, dotPos.y).subtract(source)
            .times(radarSize).div(this.radarScale).add(radarSize.scale(0.5));

        if (pixiPos.x <= radarSize.x && pixiPos.x >= 0 &&
            pixiPos.y <= radarSize.y && pixiPos.y >= 0) {
            // TODO: Make this work with any sizes
            this.radar.moveTo(pixiPos.x, pixiPos.y);
            this.radar.beginFill(color);
            this.radar.lineTo(pixiPos.x + size, pixiPos.y);
            this.radar.lineTo(pixiPos.x + size, pixiPos.y + size);
            this.radar.lineTo(pixiPos.x, pixiPos.y + size);
            this.radar.endFill()
        }
    }
}

export const StatusBarComponent = new Component<StatusBar>('StatusBar');
const StatusBarProvider = ProvideAsync({
    provided: StatusBarComponent,
    args: [GameDataResource, Stage] as const,
    async factory(gameData, stage) {
        // Casting to the client version of GameData, which includes
        // helper functions for creating sprites from picts.
        const statusBar = new StatusBar(
            await gameData.data.StatusBar.get("nova:128"), gameData as GameData);
        await statusBar.built;
        stage.addChild(statusBar.container);
        statusBar.container.position.x = window.innerWidth - statusBar.container.width;
        statusBar.container.position.y = 0;

        return statusBar;
    }
});

const StatusBarResize = new System({
    name: 'StatusBarResize',
    events: [ResizeEvent],
    args: [StatusBarComponent, ResizeEvent] as const,
    step({ container }, [width]) {
        container.position.x = width - container.width + 1;
        container.position.y = 0;
    }
});

const RadarTime = new Component<{ lastTime: number }>('RadarTime');
const RadarTimeProvider = Provide({
    provided: RadarTime,
    args: [] as const,
    factory: () => ({ lastTime: 0 }),
});
const DrawRadar = new System({
    name: 'DrawRadar',
    args: [RadarTimeProvider, TimeResource, StatusBarProvider, MovementStateComponent,
        new Query([UUID, MovementStateComponent, ShipDataComponent] as const),
        new Query([UUID, MovementStateComponent, PlanetDataComponent] as const),
        PlayerShipSelector] as const,
    step(radarTime, { time }, statusBar, { position }, ships, planets) {
        if (time - radarTime.lastTime > statusBar.radarPeriod) {
            statusBar.drawRadar(position, ships, planets);
            radarTime.lastTime = time;
        }
    }
});


export const StatusBarPlugin: Plugin = {
    name: 'StatusBar',
    build(world) {
        world.addComponent(StatusBarComponent);
        world.addSystem(DrawRadar);
        world.addSystem(StatusBarResize);
    }
}
