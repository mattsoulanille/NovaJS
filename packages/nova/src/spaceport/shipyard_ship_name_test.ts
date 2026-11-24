import 'jasmine';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    CreditsComponent, PlayerNamesComponent,
} from '../nova_plugin/player/index.js';
import { OutfitsStateComponent, ShipComponent } from '../nova_plugin/ship/index.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { Shipyard } from './shipyard.js';

/**
 * Buy Ship asks "Please name your new <ship>:" (ship_name_prompt.ts)
 * before anything is bought: OK buys the ship and names it, Cancel buys
 * nothing.
 */
describe('the shipyard\'s ship name prompt', () => {
    beforeAll(() => installHeadlessPixi());

    const OLD = 'nova:128';
    const NEW = 'nova:129';

    function displayAssets(): DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
            data: {},
        } as unknown as DisplayAssetDataInterface;
    }

    function ship(id: string, name: string, price: number): ShipData {
        // BuyRandom 100: always for sale (0 hides a hull from the grid).
        return {
            ...getDefaultShipData(), id, name, price, pict: '', buyRandom: 100,
        };
    }

    function simulationData(): SimulationGameDataInterface {
        const ships = new Map([
            [OLD, ship(OLD, 'Shuttle', 10_000)],
            [NEW, ship(NEW, 'Kit Mass Roomy 300', 100_000)],
        ]);
        return {
            ids: Promise.resolve({
                Ship: [...ships.keys()], Outfit: [], Govt: [],
                Weapon: [], Planet: [], System: [], Mission: [], Pers: [],
                Cron: [], Rank: [], Fleet: [], Dude: [], Junk: [],
                Oops: [], Asteroid: [], SpriteSheet: [], PlayerStart: [],
            }),
            data: {
                Ship: { get: async (id: string) => ships.get(id) },
                Outfit: { get: async () => undefined },
                Govt: { get: async () => undefined },
            },
        } as unknown as SimulationGameDataInterface;
    }

    function player(): Entity {
        return new Entity()
            .addComponent(ShipComponent, { id: OLD })
            .addComponent(MultiplayerData, { owner: 'peer' })
            .addComponent(CreditsComponent, { credits: 1_000_000 })
            .addComponent(OutfitsStateComponent, new Map())
            .addComponent(ControlBitsComponent, new Set<number>())
            .addComponent(PlayerNamesComponent,
                { pilot: 'Matt', ship: 'Shuttle 552' });
    }

    async function settle() {
        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    /** A shipyard showing `entity`, with the second hull selected. */
    async function openOnNewHull(entity: Entity) {
        const shipyard = new Shipyard(displayAssets(), simulationData(),
            new Subject<ControlEvent>());
        await shipyard.buildPromise;
        const shown = shipyard.show(entity);
        await settle();
        shipyard.itemGrid!.right();
        shipyard.itemGrid!.right();
        expect(shipyard.itemGrid!.selection?.id).toBe(NEW);
        await settle();
        const purchased: Entity[] = [];
        shipyard.onShipPurchased = ship => purchased.push(ship);
        return { shipyard, shown, purchased };
    }

    it('OK buys the ship and gives it the typed name, keeping the pilot\'s',
        async () => {
            const { shipyard, shown, purchased } =
                await openOnNewHull(player());
            const buying = shipyard.buyShip();
            await settle();
            const prompt = shipyard.namePrompt.alert;
            expect(prompt.shown).toBeTrue();
            // Prefilled with "<class name> <random 100-999>", all of it
            // selected.
            expect(prompt.value.selected).toBeTrue();
            expect(prompt.value.text).toMatch(/^Kit Mass Roomy 300 [1-9]\d\d$/);
            // Nothing is bought while the prompt is up.
            expect(purchased.length).toBe(0);
            prompt.type('Rocinante');
            prompt.confirm();
            await buying;
            expect(purchased.length).toBe(1);
            const bought = purchased[0];
            expect(bought.components.get(ShipComponent)?.id).toBe(NEW);
            expect(bought.components.get(PlayerNamesComponent))
                .toEqual({ pilot: 'Matt', ship: 'Rocinante' });
            expect(bought.components.get(CreditsComponent)!.credits)
                .toBeLessThan(1_000_000);
            shipyard.dismiss();
            const final = await shown;
            expect(final.components.get(PlayerNamesComponent)?.ship)
                .toBe('Rocinante');
        });

    it('an emptied field buys the ship with a blank name (wave 16, '
        + 'finding 3)', async () => {
            const { shipyard, shown, purchased } =
                await openOnNewHull(player());
            const buying = shipyard.buyShip();
            await settle();
            shipyard.namePrompt.alert.type('');
            shipyard.namePrompt.alert.confirm();
            await buying;
            expect(purchased[0].components.get(ShipComponent)?.id).toBe(NEW);
            expect(purchased[0].components.get(PlayerNamesComponent)?.ship)
                .toBe('');
            shipyard.dismiss();
            await shown;
        });

    it('Cancel buys nothing: same hull, same credits, same name',
        async () => {
            const entity = player();
            const { shipyard, shown, purchased } = await openOnNewHull(entity);
            const buying = shipyard.buyShip();
            await settle();
            shipyard.namePrompt.alert.cancel();
            await buying;
            expect(purchased.length).toBe(0);
            shipyard.dismiss();
            const final = await shown;
            expect(final.components.get(ShipComponent)?.id).toBe(OLD);
            expect(final.components.get(CreditsComponent)?.credits)
                .toBe(1_000_000);
            expect(final.components.get(PlayerNamesComponent))
                .toEqual({ pilot: 'Matt', ship: 'Shuttle 552' });
        });

    it('a second Buy press while the prompt is up opens no second prompt',
        async () => {
            const { shipyard, shown, purchased } =
                await openOnNewHull(player());
            const first = shipyard.buyShip();
            await settle();
            await shipyard.buyShip();
            shipyard.namePrompt.alert.confirm();
            await first;
            expect(purchased.length).toBe(1);
            shipyard.dismiss();
            await shown;
        });
});
