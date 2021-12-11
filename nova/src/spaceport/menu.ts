import { Container } from '@pixi/display';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { GameData } from '../client/gamedata/GameData';
import { ControlEvent } from '../nova_plugin/controls_plugin';
import { Button } from './button';
import { MenuControls } from './menu_controls';

type Buttons = {
    [index: string]: Button,
};

export abstract class Menu<T> {
    container = new Container();
    readonly buildPromise: Promise<void>;
    built = false;
    protected controls: MenuControls;
    private results = new Subject<T>();
    protected input!: T;

    constructor(protected gameData: GameData,
        private background: string,
        controlEvents: Observable<ControlEvent>) {
        this.controls = new MenuControls(controlEvents);

        const backgroundSprite = this.gameData.spriteFromPict(this.background);
        // So you can't press things behind this menu:
        backgroundSprite.interactive = true;
        backgroundSprite.anchor.x = 0.5;
        backgroundSprite.anchor.y = 0.5;
        this.container.visible = false;
        this.container.addChild(backgroundSprite);
        this.buildPromise = this.doBuild();
    }

    private async doBuild() {
        await this.build();
        this.built = true;
    }

    addButtons(buttons: Buttons) {
        for (const button of Object.values(buttons)) {
            this.container.addChild(button.container);
        }
    }

    protected async build() { }

    protected setInput(input: T) {
        this.input = input;
    }

    async show(input: T): Promise<T> {
        this.container.visible = true;
        this.controls.bind();
        this.setInput(input);
        const result = await firstValueFrom(this.results);
        this.container.visible = false;
        this.controls.unbind();
        return result;
    }

    protected done() {
        this.results.next(this.input);
    }
}
