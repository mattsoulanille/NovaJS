import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Observable } from 'rxjs';
import { GameData } from '../client/gamedata/GameData';
import { ControlEvent } from '../nova_plugin/controls_plugin';
import { WeaponsComponent } from '../nova_plugin/fire_weapon_plugin';
import { AppliedOutfitsComponent, OutfitsStateComponent } from '../nova_plugin/outfit_plugin';
import { WeaponsStateComponent } from '../nova_plugin/weapon_plugin';
import { Button } from './button';
import { Menu } from './menu';
import { Outfitter } from './outfitter';


export class Spaceport {
    readonly built: Promise<void>;
    readonly container = new PIXI.Container();
    private menu: Menu;
    private outfitter: Outfitter;

    private font = {
        title: {
            fontFamily: "Geneva", fontSize: 18, fill: 0xffffff,
            align: 'center'
        } as const,
        desc: {
            fontFamily: "Geneva", fontSize: 9, fill: 0xffffff,
            align: 'left', wordWrap: true, wordWrapWidth: 301
        } as const,
    };

    constructor(private gameData: GameData, private id: string,
        private playerShip: Entity, private controls: Observable<ControlEvent>,
        depart: (playerShip: Entity) => void) {
        const buttons = {
            outfitter: new Button(gameData, "Outfitter", 120, { x: 160, y: 116 }),
            shipyard: new Button(gameData, "Shipyard", 120, { x: 160, y: 74 }),
            leave: new Button(gameData, "Leave", 120, { x: 160, y: 200 })
        };

        buttons.leave.click.subscribe(() => depart(this.playerShip));
        this.menu = new Menu(gameData, 'nova:8500', buttons);
        this.container.addChild(this.menu.container);

        const outfits = playerShip.components.get(OutfitsStateComponent) ?? new Map();
        this.outfitter = new Outfitter(gameData, outfits, controls, (newOutfits) => {
            this.playerShip.components.set(OutfitsStateComponent, newOutfits);
            // Delete these so they are re-created with the new outfits.
            this.playerShip.components.delete(WeaponsStateComponent);
            this.playerShip.components.delete(WeaponsComponent);
            this.playerShip.components.delete(AppliedOutfitsComponent);
            this.outfitter.visible = false;
        });

        this.outfitter.visible = false;
        buttons.outfitter.click.subscribe(() => this.outfitter.visible = true);

        this.built = this.build();
    }

    async build() {
        await this.menu.built;
        const data = await this.gameData.data.Planet.get(this.id);
        const title = new PIXI.Text(data.name, this.font.title);
        title.position.x = -24;
        title.position.y = 39;
        this.container.addChild(title);

        const desc = new PIXI.Text(data.landingDesc, this.font.desc);
        desc.position.x = -149;
        desc.position.y = 70;
        this.container.addChild(desc);

        const spaceportPict = await this.gameData.spriteFromPict(data.landingPict)
        spaceportPict.position.x = -306;
        spaceportPict.position.y = -256;
        this.container.addChild(spaceportPict)
        this.container.addChild(this.outfitter.container);
    }
}
