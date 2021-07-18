import * as PIXI from 'pixi.js';
import { GameData } from '../client/gamedata/GameData';
import { Button } from './button';

type Buttons = {
    [index: string]: Button,
};

export class Menu {
    container = new PIXI.Container();
    readonly built: Promise<void>;

    constructor(protected gameData: GameData,
        private background: string,
        public buttons: Buttons) {
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

        for (const button of Object.values(this.buttons)) {
            this.container.addChild(button.container);
        }
    }
}
