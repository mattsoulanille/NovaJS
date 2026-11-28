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
    CreditsComponent, PlayerNamesComponent, StoredShipsComponent,
} from '../nova_plugin/player/index.js';
import { OutfitsStateComponent, ShipComponent } from '../nova_plugin/ship/index.js';
import { overrideEnhancements } from '../enhancements.js';
import { Button } from './button.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
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
                // getCached: the hangar (the y key's specs) reads names
                // through the synchronous lookups.
                Ship: {
                    get: async (id: string) => ships.get(id),
                    getCached: (id: string) => ships.get(id),
                },
                Outfit: {
                    get: async () => undefined,
                    getCached: () => undefined,
                },
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
    describe('buy and keep (Option-click, ship storage)', () => {
        const OPTION = { option: true, shift: false };

        it('goes through the same prompt: OK buys at the full price, names '
            + 'the new ship and stores the old one under its own name',
            async () => {
                const { shipyard, shown, purchased } =
                    await openOnNewHull(player());
                const buying = shipyard.buyShip(OPTION);
                await settle();
                const prompt = shipyard.namePrompt.alert;
                expect(prompt.shown).toBeTrue();
                expect(purchased.length).toBe(0);
                prompt.type('Rocinante');
                prompt.confirm();
                await buying;
                expect(purchased.length).toBe(1);
                const bought = purchased[0];
                expect(bought.components.get(ShipComponent)?.id).toBe(NEW);
                expect(bought.components.get(PlayerNamesComponent))
                    .toEqual({ pilot: 'Matt', ship: 'Rocinante' });
                // The full asking price: nothing was traded in.
                expect(bought.components.get(CreditsComponent)!.credits)
                    .toBe(1_000_000 - 100_000);
                const stored = bought.components.get(StoredShipsComponent);
                expect(stored?.map(record => [record.ship, record.name,
                    record.shipName])).toEqual([[OLD, 'Shuttle', 'Shuttle 552']]);
                shipyard.dismiss();
                await shown;
            });

        it('with ship storage OFF, Option-click is the ordinary trade-in '
            + 'and the Your Ships pill is hidden', async () => {
                overrideEnhancements({ enhShipStorage: false });
                try {
                    const { shipyard, shown, purchased } =
                        await openOnNewHull(player());
                    expect((shipyard as unknown as { hangarButton: Button })
                        .hangarButton.container.visible).toBeFalse();
                    const buying = shipyard.buyShip(OPTION);
                    await settle();
                    shipyard.namePrompt.alert.confirm();
                    await buying;
                    expect(purchased.length).toBe(1);
                    expect(purchased[0].components.has(StoredShipsComponent))
                        .toBeFalse();
                    // The trade-in was credited.
                    expect(purchased[0].components.get(CreditsComponent)!
                        .credits).toBeGreaterThan(1_000_000 - 100_000);
                    shipyard.dismiss();
                    await shown;
                } finally {
                    overrideEnhancements({});
                }
            });

        it('Cancel buys and stores nothing', async () => {
            const entity = player();
            const { shipyard, shown, purchased } = await openOnNewHull(entity);
            const buying = shipyard.buyShip(OPTION);
            await settle();
            shipyard.namePrompt.alert.cancel();
            await buying;
            expect(purchased.length).toBe(0);
            shipyard.dismiss();
            const final = await shown;
            expect(final).toBe(entity);
            expect(final.components.get(ShipComponent)?.id).toBe(OLD);
            expect(final.components.get(CreditsComponent)?.credits)
                .toBe(1_000_000);
            expect(final.components.has(StoredShipsComponent)).toBeFalse();
            expect(final.components.get(PlayerNamesComponent))
                .toEqual({ pilot: 'Matt', ship: 'Shuttle 552' });
        });
    });

    describe('the y key (Matthew 2026-11-27: y presses Your Ships)', () => {
        const hangarOf = (shipyard: Shipyard) =>
            (shipyard as unknown as { hangar: { container: PIXI.Container } })
                .hangar;

        async function open() {
            const controls = new Subject<ControlEvent>();
            const shipyard = new Shipyard(displayAssets(), simulationData(),
                controls);
            await shipyard.buildPromise;
            const shown = shipyard.show(player());
            await settle();
            const y = async () => {
                controls.next({ action: 'hail', state: 'start' });
                await settle();
            };
            return { shipyard, shown, controls, y };
        }

        afterEach(() => overrideEnhancements({}));

        it('opens the hangar while the shipyard holds the keyboard, and '
            + 'does nothing over it', async () => {
                const { shipyard, shown, y } = await open();
                expect(hangarOf(shipyard).container.visible).toBeFalse();
                await y();
                expect(hangarOf(shipyard).container.visible).toBeTrue();
                // The hangar holds the keys now: y again neither closes
                // nor reopens it, and Return presses the HANGAR's Done.
                await y();
                expect(hangarOf(shipyard).container.visible).toBeTrue();
                expect(MenuControls.pressDefaultButton({ key: 'Enter' }))
                    .toBeTrue();
                await settle();
                expect(hangarOf(shipyard).container.visible).toBeFalse();
                expect(shipyard.container.visible).toBeTrue();
                // Back on the shipyard, y works again.
                await y();
                expect(hangarOf(shipyard).container.visible).toBeTrue();
                shipyard.dismiss();
                await shown;
            });

        it('does nothing with ship storage off (the pill is hidden)',
            async () => {
                overrideEnhancements({ enhShipStorage: false });
                const { shipyard, shown, y } = await open();
                await y();
                expect(hangarOf(shipyard).container.visible).toBeFalse();
                shipyard.dismiss();
                await shown;
            });
    });
});
