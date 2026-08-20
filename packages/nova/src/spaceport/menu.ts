import * as PIXI from 'pixi.js';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/controls_plugin.js';
import { Button } from './button.js';
import { MenuControls } from './menu_controls.js';

type Buttons = {
    [index: string]: Button,
};

export abstract class Menu<T> {
    container = new PIXI.Container();
    readonly buildPromise: Promise<void>;
    built = false;
    /** Guards {@link build} against being run a second time. */
    private buildEntered = false;
    protected controls: MenuControls;
    private results = new Subject<T>();
    protected input!: T;

    constructor(protected displayAssets: DisplayAssetDataInterface,
        protected simulationData: SimulationGameDataInterface,
        private background: string,
        controlEvents: Observable<ControlEvent>) {
        this.controls = new MenuControls(controlEvents);

        const backgroundSprite = this.displayAssets.spriteFromPict(this.background);
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

    /**
     * Subclass hook for filling in the menu's contents. Menu's constructor
     * already runs it exactly once, through {@link buildPromise} — a
     * subclass must NEVER call build() itself.
     *
     * Overrides start with `await super.build()`, both because the first
     * await is what lets the subclass's field initialisers run before the
     * body sees `this` (see the class doc) and because that is what arms
     * this guard. The shipyard's constructor used to end with an extra
     * `this.build()`, which added a second ItemGrid on top of the first and
     * left half the menu's state pointing at a grid nobody could see; a
     * duplicate build is always a bug, so say so loudly rather than
     * silently double up whatever the subclass adds.
     */
    protected async build() {
        if (this.buildEntered) {
            throw new Error(`${this.constructor.name}.build() ran twice. `
                + 'Menu builds itself once from its constructor; do not '
                + 'call build() again.');
        }
        this.buildEntered = true;
    }

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

    /**
     * Closes the menu from OUTSIDE (the owning display world is being torn
     * down — a jump or gate transit while the map is open). Resolves the
     * pending show() with the current input so the MenuControls binding is
     * released; a menu left bound after its world died kept the keyboard
     * for good, and the ship could not be flown in the next system.
     * No-op when not shown.
     */
    dismiss() {
        if (this.container.visible) {
            this.done();
        }
    }
}
