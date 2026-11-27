import 'jasmine';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlAction, ControlEvent } from '../nova_plugin/core/index.js';
import { PlayerShipSelector } from '../nova_plugin/player/index.js';
import { BoardingComponent, BoardingState, ShipComponent } from '../nova_plugin/ship/index.js';
import { installHeadlessPixi } from '../spaceport/headless_pixi_fixture.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import { CapturedShipNamePrompt } from '../spaceport/ship_name_prompt.js';
import {
    CaptureAnswer, CaptureAssignmentDialog, CaptureShipEvent, useCapturedShip,
} from './boarding_plugin.js';

/**
 * ============================================================================
 * THE CAPTURE PROMPT'S KEYS AND THE RENAME ALERT'S CANCEL
 * ============================================================================
 *
 * Reference "The capture prompt's keys and the rename alert's Cancel (CU
 * leftover), wave 46": `m` answers Use As My Ship and `e` Use As Escort,
 * `a` does nothing (nor, wave 45, do Return and `u`); Cancel on the rename
 * alert CANCELS THE CAPTURE — no swap, no escort, the prize left a hulk
 * that cannot be boarded again. Driven through real (headless) dialogs.
 */

/** Everything a button / background asks the asset layer for: blanks; the
 * string table is missing, so the built-in wording stands. */
const DISPLAY_ASSETS = {
    spriteFromPict: () => new PIXI.Sprite(),
    spriteFromPictAsync: async () => new PIXI.Sprite(),
    textureFromPict: () => PIXI.Texture.EMPTY,
    textureFromPictAsync: async () => PIXI.Texture.EMPTY,
    data: {
        StringTable: { get: async () => { throw new Error('no data'); } },
    },
} as unknown as DisplayAssetDataInterface;

async function settle() {
    for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}

describe('the capture prompt\'s keys (reference CU wave 46)', () => {
    beforeAll(() => installHeadlessPixi());

    let controls: Subject<ControlEvent>;
    let dialog: CaptureAssignmentDialog;
    let answers: CaptureAnswer[];

    beforeEach(() => {
        controls = new Subject<ControlEvent>();
        answers = [];
        dialog = new CaptureAssignmentDialog(DISPLAY_ASSETS, controls,
            answer => answers.push(answer));
        dialog.open();
    });

    afterEach(() => {
        dialog.close();
        expect(MenuControls.focused).toBeUndefined();
    });

    const press = (action: ControlAction) =>
        controls.next({ action, state: 'start' });

    it('owns the keyboard while it is up', () => {
        expect(MenuControls.focused).toBeDefined();
    });

    it('answers Use As My Ship on `m` (the map key)', () => {
        press('map');
        expect(answers).toEqual(['ship']);
    });

    it('answers Use As Escort on `e` (the escort key)', () => {
        press('escorts');
        expect(answers).toEqual(['escort']);
    });

    it('does nothing on `a`, `u` or Escape (accept, cloak, depart)', () => {
        press('accept');
        press('cloak');
        press('depart');
        expect(answers).toEqual([]);
        expect(MenuControls.pressDefaultButton({ key: 'Enter' }))
            .withContext('Return').toBeFalse();
        expect(answers).toEqual([]);
    });

    it('ignores key repeats and releases', () => {
        controls.next({ action: 'map', state: 'repeat' });
        controls.next({ action: 'escorts', state: false });
        expect(answers).toEqual([]);
    });
});

describe('Use As My Ship\'s rename alert, Cancel (reference CU wave 46)',
    () => {
        beforeAll(() => installHeadlessPixi());

        const PRIZE = 'prize';
        let world: World;
        let player: Entity;
        let namePrompt: CapturedShipNamePrompt;
        let abandoned: number;
        const gameData = {
            data: {
                Ship: {
                    get: async () => ({ id: 'kit:prize',
                        name: 'Kit Prize Hull' }),
                },
            },
        } as unknown as SimulationGameDataInterface;

        beforeEach(() => {
            world = new World();
            player = new Entity();
            player.components.set(PlayerShipSelector, undefined);
            player.components.set(ShipComponent, { id: 'kit:boarder' });
            player.components.set(BoardingComponent, {
                target: PRIZE, creditsAvailable: 0, ammoAvailable: 0,
                captureOdds: 75, cargoTaken: false, creditsTaken: false,
                fuelTaken: false, ammoTaken: false, capture: 'succeeded',
                crimeApplied: true,
            } as BoardingState);
            world.entities.set('player', player);
            const prize = new Entity();
            prize.components.set(ShipComponent, { id: 'kit:prize' });
            world.entities.set(PRIZE, prize);
            namePrompt = new CapturedShipNamePrompt(new Subject());
            abandoned = 0;
        });

        function ask() {
            return useCapturedShip(world, gameData, DISPLAY_ASSETS,
                namePrompt, { x: 800, y: 600 }, () => abandoned++, PRIZE);
        }

        it('abandons the capture: no captureShip record, the session ended '
            + 'through the Done path', async () => {
                const sent: unknown[] = [];
                world.events.get(CaptureShipEvent)
                    .subscribe(event => sent.push(event));
                const answer = ask();
                await settle();
                expect(namePrompt.alert.shown).toBeTrue();
                expect(namePrompt.alert.value.text)
                    .toMatch(/^Kit Prize Hull \d{3}$/);
                namePrompt.alert.cancel();
                expect(await answer).withContext('something was sent')
                    .toBeTrue();
                expect(abandoned).toBe(1);
                expect(sent).toEqual([]);
                expect(MenuControls.focused).toBeUndefined();
            });

        it('sends nothing when the session ended under the alert (dismissed)',
            async () => {
                const answer = ask();
                await settle();
                player.components.delete(BoardingComponent);
                namePrompt.alert.cancel();
                expect(await answer).toBeFalse();
                expect(abandoned).toBe(0);
            });
    });
