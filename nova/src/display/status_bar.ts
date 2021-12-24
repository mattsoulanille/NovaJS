import { PlanetData } from "nova_data_interface/PlanetData";
import { ShipData } from "nova_data_interface/ShipData";
import { StatusBarData, StatusBarDataArea } from "nova_data_interface/StatusBarData";
import { GetEntity, RunQuery, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { Optional } from "nova_ecs/optional";
import { Plugin } from "nova_ecs/plugin";
import { MovementState, MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Query } from "nova_ecs/query";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import { GameData } from "../client/gamedata/GameData";
import { GameDataResource } from "../nova_plugin/game_data_resource";
import { ArmorComponent, ShieldComponent } from "../nova_plugin/health_plugin";
import { PlanetDataComponent } from "../nova_plugin/planet_plugin";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin";
import { ShipDataComponent } from "../nova_plugin/ship_plugin";
import { Stat } from "../nova_plugin/stat";
import { TargetComponent } from "../nova_plugin/target_component";
import { ChangeSecondaryEvent } from "../nova_plugin/weapon_plugin";
import { AnimationGraphic } from "./animation_graphic";
import { AnimationGraphicComponent } from "./animation_graphic_plugin";
import { PixiAppResource } from "./pixi_app_resource";
import { ResizeEvent } from "./screen_size_plugin";
import { Stage } from "./stage_resource";


class StatusBar {
    readonly container = new PIXI.Container();
    readonly buildPromise: Promise<void>;
    built = false;
    width = 0;
    private radarScale = new Vector(6000, 6000);
    private radar = new PIXI.Graphics();
    radarPeriod = 200;
    private statsGraphics = new PIXI.Graphics();

    private targetContainer = new PIXI.Container();
    private noTargetContainer = new PIXI.Container();
    private targetSprite = new PIXI.Sprite();

    private text: { [index: string]: PIXI.Text } = {};

    constructor(private statusBarData: StatusBarData, private gameData: GameData,
        private renderer: PIXI.Renderer | PIXI.AbstractRenderer) {
        this.buildPromise = this.build();
        this.container.name = 'StatusBar';
    }

    private async build() {
        const background = await this.gameData.spriteFromPictAsync(this.statusBarData.image);
        this.container.addChild(background);
        this.width = background.width;
        const dataAreas = this.statusBarData.dataAreas;
        [this.radar.position.x, this.radar.position.y] = dataAreas.radar.position;
        this.container.addChild(this.radar);
        this.container.addChild(this.statsGraphics);
        this.targetContainer.addChild(this.targetSprite);
        this.targetSprite.anchor.set(0.5, 0.5);
        this.targetSprite.position.x =
            this.statusBarData.dataAreas.targeting.size[0] / 2;
        this.targetSprite.position.y =
            this.statusBarData.dataAreas.targeting.size[1] / 2;

        this.makeText();
        this.built = true;
    }

    private makeText() {
        const font = new PIXI.TextStyle({
            fontFamily: 'Geneva',
            fontSize: 12,
            align: 'center',
            fill: this.statusBarData.colors.brightText,
        });
        const dimFont = new PIXI.TextStyle({
            fontFamily: 'Geneva',
            fontSize: 12,
            align: 'center',
            fill: this.statusBarData.colors.dimText,
        });

        const secondaryWeaponContainer = new PIXI.Container();
        this.container.addChild(secondaryWeaponContainer);
        secondaryWeaponContainer.position.x =
            this.statusBarData.dataAreas.weapons.position[0];
        secondaryWeaponContainer.position.y =
            this.statusBarData.dataAreas.weapons.position[1];

        this.text.noWeapon = new PIXI.Text("No Secondary Weapon", dimFont);
        this.text.noWeapon.anchor.x = 0.5;
        this.text.noWeapon.anchor.y = 0.5;
        this.text.noWeapon.position.x = this.statusBarData.dataAreas.weapons.size[0] / 2;
        this.text.noWeapon.position.y = this.statusBarData.dataAreas.weapons.size[1] / 2;;
        secondaryWeaponContainer.addChild(this.text.noWeapon);

        this.text.weapon = new PIXI.Text("", font);
        this.text.weapon.anchor.x = 0.5;
        this.text.weapon.anchor.y = 0.5;
        this.text.weapon.position.x = this.statusBarData.dataAreas.weapons.size[0] / 2;
        this.text.weapon.position.y = this.statusBarData.dataAreas.weapons.size[1] / 2;;
        secondaryWeaponContainer.addChild(this.text.weapon);

        this.targetContainer.visible = false;
        this.container.addChild(this.targetContainer);
        this.container.addChild(this.noTargetContainer);

        this.targetContainer.position.x = this.statusBarData.dataAreas.targeting.position[0];
        this.targetContainer.position.y = this.statusBarData.dataAreas.targeting.position[1];
        this.noTargetContainer.position.x = this.statusBarData.dataAreas.targeting.position[0];
        this.noTargetContainer.position.y = this.statusBarData.dataAreas.targeting.position[1];

        var size = [this.statusBarData.dataAreas.targeting.size[0],
        this.statusBarData.dataAreas.targeting.size[1]];

        this.text.shield = new PIXI.Text('Shield:', dimFont);
        this.text.shield.anchor.y = 1;
        this.text.shield.position.x = 6;
        this.text.shield.position.y = size[1] - 3;

        this.targetContainer.addChild(this.text.shield);

        this.text.armor = new PIXI.Text('Armor:', dimFont);
        this.text.armor.anchor.y = 1;
        this.text.armor.position.x = 6;
        this.text.armor.position.y = size[1] - 3;
        this.text.armor.visible = false;
        this.targetContainer.addChild(this.text.armor);


        this.text.percent = new PIXI.Text("100%", font);
        this.text.percent.anchor.y = 1;
        this.text.percent.position.x = 49;
        this.text.percent.position.y = size[1] - 3;

        this.targetContainer.addChild(this.text.percent);

        const middle = [this.statusBarData.dataAreas.targeting.size[0] / 2,
        this.statusBarData.dataAreas.targeting.size[1] / 2 - 15];

        this.text.noTarget = new PIXI.Text("No Target", dimFont);
        this.text.noTarget.anchor.x = 0.5;
        this.text.noTarget.anchor.y = 0.5;
        this.text.noTarget.position.x = middle[0];
        this.text.noTarget.position.y = middle[1] - 15;

        this.noTargetContainer.addChild(this.text.noTarget);

        this.text.targetName = new PIXI.Text("Name Placeholder", font);
        this.text.targetName.anchor.x = 0.5;
        this.text.targetName.anchor.y = 0.5;
        this.text.targetName.position.x = middle[0];
        this.text.targetName.position.y = 12;

        this.targetContainer.addChild(this.text.targetName);

        this.text.targetImagePlaceholder = new PIXI.Text("No target image", dimFont);
        this.text.targetImagePlaceholder.anchor.x = 0.5;
        this.text.targetImagePlaceholder.anchor.y = 0.5;
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

    private drawLine(dataArea: StatusBarDataArea, color: number, fullness: number) {
        var pos = [dataArea.position[0], dataArea.position[1]];
        var size = [dataArea.size[0], dataArea.size[1]];
        pos[1] += size[1] / 2;

        this.statsGraphics.lineStyle(size[1], color);
        this.statsGraphics.moveTo(pos[0], pos[1]);
        this.statsGraphics.lineTo(pos[0] + size[0] * fullness, pos[1]);
    }

    drawStats(shield: Stat, armor: Stat) {
        this.statsGraphics.clear();

        const shieldFullness = Math.max(0, shield.current / shield.max);
        this.drawLine(this.statusBarData.dataAreas.shield,
            this.statusBarData.colors.shield, shieldFullness);

        const armorFullness = Math.max(0, armor.current / armor.max);
        this.drawLine(this.statusBarData.dataAreas.armor,
            this.statusBarData.colors.armor, armorFullness);
    }

    drawSecondary(name: string | null | undefined) {
        if (!this.built) {
            return;
        }
        if (name) {
            this.text.weapon.text = name;
            this.text.weapon.visible = true;
            this.text.noWeapon.visible = false;
        } else {
            this.text.weapon.visible = false;
            this.text.noWeapon.visible = true;
        }
    }

    drawTarget(name: string, shield?: number, armor?: number,
        shipGraphic?: AnimationGraphic) {
        this.targetContainer.visible = true;
        this.noTargetContainer.visible = false;
        this.text.targetName.text = name;

        if (shield && shield > 0) {
            this.text.shield.visible = true;
            this.text.armor.visible = false;
            this.text.percent.text = `${String(shield)}%`;
        } else if (typeof armor === 'number') {
            this.text.shield.visible = false;
            this.text.armor.visible = true;
            this.text.percent.text = `${String(armor)}%`;
        } else {
            this.text.shield.visible = false;
            this.text.armor.visible = false;
        }

        if (shipGraphic) {
            const shipContainer = shipGraphic?.container;
            const baseRenderTexture = new PIXI.BaseRenderTexture({
                width: shipGraphic.size.x, height: shipGraphic.size.y,
            });
            const renderTexture = new PIXI.RenderTexture(baseRenderTexture);

            shipContainer.setTransform();
            shipContainer.position.x = shipGraphic.size.x / 2;
            shipContainer.position.y = shipGraphic.size.y / 2;
            this.renderer.render(shipContainer, { renderTexture });
            this.targetSprite.texture = renderTexture;
            let scale = 1;
            const maxSize = 110;
            const targetMaxDim = Math.max(shipGraphic.size.x, shipGraphic.size.y);
            if (targetMaxDim > maxSize) {
                scale = maxSize / targetMaxDim;
            }
            this.targetSprite.scale.set(scale, scale);
            this.targetSprite.visible = true;
        } else {
            this.targetSprite.visible = false;
        }

    }
    clearTarget() {
        this.targetContainer.visible = false;
        this.noTargetContainer.visible = true;
        this.targetSprite.visible = false;
    }
}

export const StatusBarResource = new Resource<StatusBar>('StatusBar');

const StatusBarResize = new System({
    name: 'StatusBarResize',
    events: [ResizeEvent],
    args: [StatusBarResource, ResizeEvent] as const,
    step({ container }, { x }) {
        container.position.x = x - container.width + 1;
        container.position.y = 0;
    }
});

const RadarTime = new Component<{ lastTime: number }>('RadarTime');
const DrawRadar = new System({
    name: 'DrawRadar',
    args: [Optional(RadarTime), TimeResource, StatusBarResource, MovementStateComponent,
    new Query([UUID, MovementStateComponent, ShipDataComponent] as const),
    new Query([UUID, MovementStateComponent, PlanetDataComponent] as const),
        GetEntity, PlayerShipSelector] as const,
    step(radarTime, { time }, statusBar, { position }, ships, planets, entity) {
        if (!radarTime) {
            radarTime = { lastTime: 0 };
            entity.components.set(RadarTime, radarTime);
        }
        if (time - radarTime.lastTime > statusBar.radarPeriod) {
            statusBar.drawRadar(position, ships, planets);
            radarTime.lastTime = time;
        }
    }
});

const DrawStatusBarStats = new System({
    name: 'DrawStatusBarStats',
    args: [StatusBarResource, ShieldComponent, ArmorComponent, PlayerShipSelector] as const,
    step(statusBar, shield, armor) {
        statusBar.drawStats(shield, armor);
    }
})

const DrawStatusBarSecondaryWeapon = new System({
    name: 'DrawStatusBarSecondaryWeapon',
    events: [ChangeSecondaryEvent],
    args: [StatusBarResource, ChangeSecondaryEvent, GameDataResource,
        PlayerShipSelector] as const,
    step(statusBar, activeSecondary, gameData) {
        if (activeSecondary.secondary) {
            const secondaryName = gameData.data.Weapon
                .getCached(activeSecondary.secondary);
            statusBar.drawSecondary(secondaryName?.name);
        } else {
            statusBar.drawSecondary(null);
        }
    }
});

const TargetQuery = new Query([ShipDataComponent, Optional(ShieldComponent),
    Optional(ArmorComponent), Optional(AnimationGraphicComponent)] as const);
const DrawStatusBarTarget = new System({
    name: 'DrawStatusBarTarget',
    args: [StatusBarResource, TargetComponent, RunQuery, PlayerShipSelector] as const,
    step(statusBar, { target }, runQuery) {
        if (!target) {
            statusBar.clearTarget();
            return;
        }
        const result = runQuery(TargetQuery, target)[0];
        if (result) {
            const [shipData, shield, armor, shipGraphic] = result;
            statusBar.drawTarget(shipData.name, shield?.percent, armor?.percent, shipGraphic);
        }
    }
})

export const StatusBarPlugin: Plugin = {
    name: 'StatusBar',
    async build(world) {
        const gameData = world.resources.get(GameDataResource);
        if (!gameData) {
            throw new Error('Expected gameData resource to exist');
        }

        const stage = world.resources.get(Stage);
        if (!stage) {
            throw new Error('Expected Stage resource to exist');
        }

        const app = world.resources.get(PixiAppResource);
        if (!app) {
            throw new Error('Expected PIXI App resource to exist');
        }

        const statusBar = new StatusBar(await gameData.data.StatusBar.get("nova:128"),
            gameData as GameData, app.renderer);
        await statusBar.buildPromise;
        stage.addChild(statusBar.container);
        statusBar.container.position.x = window.innerWidth - statusBar.container.width;
        statusBar.container.position.y = 0;

        world.resources.set(StatusBarResource, statusBar);

        world.addSystem(DrawRadar);
        world.addSystem(StatusBarResize);
        world.addSystem(DrawStatusBarStats);
        world.addSystem(DrawStatusBarSecondaryWeapon);
        world.addSystem(DrawStatusBarTarget);
    },
    remove(world) {
        world.removeSystem(DrawRadar);
        world.removeSystem(StatusBarResize);
        world.removeSystem(DrawStatusBarStats);
        world.removeSystem(DrawStatusBarSecondaryWeapon);
        world.removeSystem(DrawStatusBarTarget);

        const stage = world.resources.get(Stage);
        const statusBar = world.resources.get(StatusBarResource);
        if (stage && statusBar) {
            stage.removeChild(statusBar.container);
        }
        world.resources.delete(StatusBarResource);
    }
}
