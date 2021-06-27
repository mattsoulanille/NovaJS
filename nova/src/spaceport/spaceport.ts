import * as PIXI from 'pixi.js';
import { GameData } from '../client/gamedata/GameData';
import { Button } from './button';
import { Menu } from './menu';


export class Spaceport {
    readonly built: Promise<void>;
    readonly container = new PIXI.Container();
    buttons: { [index: string]: Button };
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

    constructor(private gameData: GameData, private id: string, depart: () => void) {
        this.buttons = {
            outfitter: new Button(gameData, "Outfitter", 120, { x: 160, y: 116 }),
            shipyard: new Button(gameData, "Shipyard", 120, { x: 160, y: 74 }),
            leave: new Button(gameData, "Leave", 120, { x: 160, y: 200 })
        };

        this.buttons.leave.click.subscribe(depart);
        this.built = this.build();
    }

    async build() {
        const backgroundSprite =
            await this.gameData.spriteFromPict('nova:8500');
        // So you can't press things behind this menu:
        backgroundSprite.interactive = true;
        backgroundSprite.anchor.x = 0.5;
        backgroundSprite.anchor.y = 0.5;
        this.container.addChild(backgroundSprite);

        for (const button of Object.values(this.buttons)) {
            this.container.addChild(button.container);
        }

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
    }
}
