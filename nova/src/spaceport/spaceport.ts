import { PlanetData } from 'nova_data_interface/PlanetData';
import { AsyncSystemResource } from 'nova_ecs/async_system';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import * as PIXI from 'pixi.js';
import { Observable } from 'rxjs';
import { GameData } from '../client/gamedata/GameData';
import { ControlEvent } from '../nova_plugin/controls_plugin';
import { GameDataResource } from '../nova_plugin/game_data_resource';
import { ArmorComponent, ShieldComponent } from '../nova_plugin/health_plugin';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin';
import { ShipPhysicsComponent } from '../nova_plugin/ship_plugin';
import { SystemIdResource } from '../nova_plugin/system_id_resource';
import { SystemPlugin } from '../nova_plugin/system_plugin';
import { WeaponsStateComponent } from '../nova_plugin/weapons_state';
import { Button } from './button';
import { Menu } from './menu';
import { MenuControls } from './menu_controls';
import { Outfitter } from './outfitter';
import { Shipyard } from './shipyard';

export class Spaceport extends Menu<Entity> {
    private outfitter: Outfitter;
    private shipyard: Shipyard;
    private data?: PlanetData;

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

    constructor(gameData: GameData, private id: string,
        controlEvents: Observable<ControlEvent>) {
        super(gameData, "nova:8500", controlEvents);
        this.container.name = 'Spaceport';

        const buttons = {
            outfitter: new Button(gameData, "Outfitter", 120, { x: 160, y: 116 }),
            shipyard: new Button(gameData, "Shipyard", 120, { x: 160, y: 74 }),
            leave: new Button(gameData, "Leave", 120, { x: 160, y: 200 })
        };

        buttons.leave.click.subscribe(this.done.bind(this));

        this.outfitter = new Outfitter(gameData, controlEvents);
        const showOutfitter = async () => {
            this.controls.unbind();
            const outfits = this.input.components.get(OutfitsStateComponent) ?? new Map();
            const newOutfits = await this.outfitter.show(outfits);
            this.input.components.set(OutfitsStateComponent, newOutfits);
            // Delete these so they are re-created with the new outfits.
            // TODO: Find a better way to do this.
            this.input.components.delete(WeaponsStateComponent);
            this.input.components.delete(ShipPhysicsComponent);
            this.controls.bind();
        };
        buttons.outfitter.click.subscribe(showOutfitter);

        this.shipyard = new Shipyard(gameData, controlEvents);

        const showShipyard = async () => {
            this.controls.unbind();
            const newInput = await this.shipyard.show(this.input);
            if (newInput !== this.input) {
                // Construct a fake system and run providers so that outfits of the new
                // ship are provided.
                const shipBuildWorld = new World('outfit builder');
                shipBuildWorld.resources.set(GameDataResource, gameData);
                shipBuildWorld.resources.set(SystemIdResource, 'nova:128');
                await shipBuildWorld.addPlugin(SystemPlugin);
                shipBuildWorld.entities.set('ship', newInput);
                shipBuildWorld.step();
                await shipBuildWorld.resources.get(AsyncSystemResource)?.done;
                shipBuildWorld.step();
                shipBuildWorld.entities.delete('ship');
            }
            this.input = newInput;

            this.controls.bind();
        };
        buttons.shipyard.click.subscribe(showShipyard);
        this.addButtons(buttons);

        this.controls = new MenuControls(controlEvents, {
            outfitter: showOutfitter,
            shipyard: showShipyard,
            depart: this.done.bind(this),
        });
    }

    async build() {
        await super.build();
        const data = await this.gameData.data.Planet.get(this.id);
        this.data = data;
        const title = new PIXI.Text(data.name, this.font.title);
        title.position.x = -24;
        title.position.y = 39;
        this.container.addChild(title);

        const desc = new PIXI.Text(data.landingDesc, this.font.desc);
        desc.position.x = -149;
        desc.position.y = 70;
        this.container.addChild(desc);

        const spaceportPict = this.gameData.spriteFromPict(data.landingPict)
        spaceportPict.position.x = -306;
        spaceportPict.position.y = -256;
        this.container.addChild(spaceportPict)
        this.container.addChild(this.outfitter.container);
        this.container.addChild(this.shipyard.container);
    }

    protected done() {
        if (this.data) {
            const movement = this.input.components.get(MovementStateComponent);
            if (movement) {
                movement.position = new Position(...this.data.position);
                movement.velocity = new Vector(0, 0);
            }
            const shield = this.input.components.get(ShieldComponent);
            if (shield) {
                shield.current = shield.max;
            }
            const armor = this.input.components.get(ArmorComponent);
            if (armor) {
                armor.current = armor.max;
            }
        }
        super.done();
    }
}
