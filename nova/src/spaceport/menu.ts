import * as PIXI from 'pixi.js';
import { GameData } from '../client/gamedata/GameData';


export class Menu {
    container = new PIXI.Container();
    readonly built: Promise<void>;

    constructor(protected gameData: GameData, private background: string) {
        this.built = this.build();
    }

    private async build() {
        const backgroundSprite =
            await this.gameData.spriteFromPict(this.background);
        // So you can't press things behind this menu:
        backgroundSprite.interactive = true;
        backgroundSprite.anchor.x = 0.5;
        backgroundSprite.anchor.y = 0.5;
        this.container.addChild(backgroundSprite);
    }
}
