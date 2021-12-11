import { Container } from '@pixi/display';
import { Subject } from 'rxjs';
import { GameData } from '../client/gamedata/GameData';
import { Text, TextMetrics, TextStyle } from '@pixi/text';
import { TilingSprite } from '@pixi/sprite-tiling'
import '@pixi/interaction';

const BUTTON_IDS = new Map([
    ['normal', {
        left: 'nova:7500',
        middle: 'nova:7501',
        right: 'nova:7502',
    }],
    ['clicked', {
        left: 'nova:7503',
        middle: 'nova:7504',
        right: 'nova:7505'
    }],
    ['grey', {
        left: 'nova:7506',
        middle: 'nova:7507',
        right: 'nova:7508'
    }],
]);

const LEFT_POS = 13.2 // TODO: infer from texture width

export class Button {
    container = new Container();
    private states = new Map<string, Container>();
    readonly click = new Subject<undefined>();
    private text: Text;
    private wrappedState = 'normal';
    private width: number;

    // See colr resource                                                              
    private font = new Map([
        ["normal", { fontFamily: "Geneva", fontSize: 12, fill: 0xffffff, align: 'center' } as const],
        ["clicked", { fontFamily: "Geneva", fontSize: 12, fill: 0x808080, align: 'center' } as const],
        ["grey", { fontFamily: "Geneva", fontSize: 12, fill: 0x262626, align: 'center' } as const],
    ]);


    constructor(private gameData: GameData, text: string,
        width?: number, position?: { x: number, y: number },
        private buttonIds = BUTTON_IDS) {
        this.container.position.x = position?.x ?? 0;
        this.container.position.y = position?.y ?? 0;

        this.text = new Text(text, this.font.get("normal")!);
        this.text.anchor.x = 0.5;
        this.text.anchor.y = 0.5;

        const textMetrics = TextMetrics.measureText(text,
            this.text.style as TextStyle); // This required cast may be a types bug
        this.width = width ?? textMetrics.width;

        const height = 25; // TODO: infer from texture height
        this.text.position.x = LEFT_POS + this.width / 2;
        this.text.position.y = height / 2;

        // Create a container for each state
        for (const name of this.buttonIds.keys()) {
            const container = new Container();
            this.container.addChild(container);
            this.states.set(name, container);
        }

        // Set the correct container as visible
        this.state = this.wrappedState;

        this.container.interactive = true;
        this.container.buttonMode = true;
        this.container.on('pointerdown', () => {
            this.state = 'clicked';
        });

        this.container.on('pointerup', () => {
            this.state = 'normal';
            this.click.next(undefined);
        });

        for (const [name, { left, middle, right }] of this.buttonIds) {
            const stateContainer = this.states.get(name);
            if (!stateContainer) {
                throw new Error('Button missing state container');
            }
            const leftSprite = this.gameData.spriteFromPict(left);
            leftSprite.anchor.x = 1;
            leftSprite.position.x = LEFT_POS;
            stateContainer.addChild(leftSprite);

            const middleSprite = new TilingSprite(
                this.gameData.textureFromPict(middle), this.width, 25);
            middleSprite.position.x = LEFT_POS;
            stateContainer.addChild(middleSprite);

            const rightSprite = this.gameData.spriteFromPict(right);
            rightSprite.position.x = LEFT_POS + this.width;
            stateContainer.addChild(rightSprite);

            this.states.set(name, stateContainer);
        }
        this.container.addChild(this.text);
    }

    set state(state: string) {
        for (const container of this.states.values()) {
            container.visible = false;
        }
        const container = this.states.get(state);
        if (container) {
            container.visible = true;
        }

        const font = this.font.get(state);
        if (font) {
            this.text.style = font;
        }

        this.wrappedState = state;
    }

    get state() {
        return this.wrappedState;
    }
}
