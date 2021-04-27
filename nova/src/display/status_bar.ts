import { StatusBarData } from "novadatainterface/StatusBarData";
import { Component } from "nova_ecs/component";
import { Plugin } from "nova_ecs/plugin";
import { ProvideAsync } from "nova_ecs/provider";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import { GameData } from "../client/gamedata/GameData";
import { GameDataResource } from "../nova_plugin/game_data_resource";
import { PlayerShipSelector } from "../nova_plugin/ship_controller_plugin";
import { ResizeEvent } from "./resize_event";
import { Stage } from "./stage_resource";


class StatusBar {
    readonly container = new PIXI.Container();
    readonly built: Promise<void>;
    width = 0;

    constructor(private statusBarData: StatusBarData, private gameData: GameData) {
        this.built = this.build();
    }

    private async build() {
        const background = await this.gameData.spriteFromPict(this.statusBarData.image);
        this.container.addChild(background);
        this.width = background.width;
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
        container.position.x = width - container.width;
        container.position.y = 0;
    }
});

const StatusBarSystem = new System({
    name: 'StatusBarSystem',
    args: [StatusBarProvider, PlayerShipSelector] as const,
    step() {

    }
});


export const StatusBarPlugin: Plugin = {
    name: 'StatusBar',
    build(world) {
        world.addComponent(StatusBarComponent);
        world.addSystem(StatusBarSystem);
        world.addSystem(StatusBarResize);
    }
}
