import 'jasmine';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import {
    CreditsComponent, PlayerNamesComponent, PlayerShipSelector, StoredShip,
    StoredShipsComponent,
} from '../nova_plugin/player/index.js';
import {
    CargoComponent, OutfitsStateComponent, ShipComponent,
} from '../nova_plugin/ship/index.js';
import {
    HANGAR_DESCRIPTION_PANE, HANGAR_MESSAGE_Y, HangarContext, HangarDialog,
    hangarDescriptionFrame, hangarEntries,
} from './hangar_dialog.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
import { STORAGE_REFUSAL_TEXT } from './ship_storage.js';
import { ShopSearchField } from './shop_search.js';

/**
 * The hangar dialog (hangar_dialog.ts) driven headlessly over mock game
 * data: the review findings that live in the dialog rather than in
 * ship_storage.ts's rules — what it refuses, what it loads before a swap,
 * how it closes — and its Return key and names.
 */
describe('the hangar dialog', () => {
    beforeAll(() => installHeadlessPixi());
    afterEach(() => {
        // Nothing a spec leaves behind may keep the keyboard.
        while (MenuControls.focused) {
            MenuControls.focused.unbind();
        }
    });

    const HERE = 'nova:200';
    const FLOWN = 'nova:128';
    const STORED = 'nova:129';
    const BLASTER = 'nova:300';
    const LICENCE = 'nova:301';
    const GONE = 'removed-plugin:128';

    function ship(id: string, name: string): ShipData {
        const base = getDefaultShipData();
        return {
            ...base, id, name, pict: '',
            physics: { ...base.physics, freeCargo: 20, energy: 300 },
        };
    }
    const SHIPS = new Map<string, ShipData>([
        [FLOWN, ship(FLOWN, 'Runabout')],
        [STORED, ship(STORED, 'Hauler')],
    ]);
    /** A plug-in loadout: forty "Build ..." outfits (Matthew's
     * 2026-11-27 screenshot). */
    const BUILD_IDS = Array.from({ length: 40 }, (_, i) => `builds:${400 + i}`);
    const OUTFITS = new Map<string, OutfitData>([
        [BLASTER, { ...getDefaultOutfitData(), id: BLASTER, name: 'Blaster' }],
        [LICENCE, {
            ...getDefaultOutfitData(), id: LICENCE, name: 'Licence',
            persistent: true,
        }],
        ...BUILD_IDS.map((id, i): [string, OutfitData] => [id, {
            ...getDefaultOutfitData(), id, name: `Build Thing ${i + 1}`,
        }]),
    ]);

    function displayAssets(): DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            data: {},
        } as unknown as DisplayAssetDataInterface;
    }

    /**
     * Game data whose caches start COLD: getCached knows a ship or outfit
     * only once get() has loaded it, as the real Gettable does. `hold`
     * makes every ship load wait on the returned release.
     */
    function simulationData(options: { hold?: Promise<void> } = {}):
        SimulationGameDataInterface {
        const ships = new Set<string>();
        const outfits = new Set<string>();
        return {
            data: {
                Ship: {
                    get: async (id: string) => {
                        await options.hold;
                        ships.add(id);
                        return SHIPS.get(id);
                    },
                    getCached: (id: string) =>
                        ships.has(id) ? SHIPS.get(id) : undefined,
                },
                Outfit: {
                    get: async (id: string) => {
                        outfits.add(id);
                        const outfit = OUTFITS.get(id);
                        if (!outfit) {
                            throw new Error(`no outfit ${id}`);
                        }
                        return outfit;
                    },
                    getCached: (id: string) =>
                        outfits.has(id) ? OUTFITS.get(id) : undefined,
                },
                Planet: {
                    get: async () => undefined,
                    getCached: () => undefined,
                },
            },
        } as unknown as SimulationGameDataInterface;
    }

    function stored(fields: Partial<StoredShip> = {}): StoredShip {
        return {
            ship: STORED, name: 'Hauler', outfits: [[BLASTER, 2]], cargo: [],
            fuel: 100, storedAt: 'nova:201', ...fields,
        };
    }

    function pilot(list: StoredShip[]): Entity {
        return new Entity('pilot')
            .addComponent(ShipComponent, { id: FLOWN })
            .addComponent(PlayerShipSelector, undefined)
            .addComponent(MultiplayerData, { owner: 'peer-1' })
            .addComponent(CreditsComponent, { credits: 5_000 })
            .addComponent(OutfitsStateComponent, new Map([
                [BLASTER, { count: 1 }], [LICENCE, { count: 1 }]]))
            .addComponent(CargoComponent, new Map())
            .addComponent(PlayerNamesComponent,
                { pilot: 'Matt', ship: 'Rocinante' })
            .addComponent(StoredShipsComponent, list);
    }

    async function settle(): Promise<void> {
        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    /** A hangar shown over `hull`; the hull follows every adopted swap. */
    function open(hull: Entity, gameData = simulationData(),
        controls = new Subject<ControlEvent>(),
        extra: Partial<HangarContext> = {}) {
        const hangar = new HangarDialog(displayAssets(), gameData, controls);
        const state = { hull };
        const context: HangarContext = {
            hull: () => state.hull,
            stellarId: HERE,
            fightersOut: () => false,
            adoptHull: next => { state.hull = next; },
            ...extra,
        };
        const shown = hangar.show(context);
        return { hangar, state, shown };
    }

    const internals = (hangar: HangarDialog) => hangar as unknown as {
        itemGrid: { right(): void, selection?: { kind: string } },
        text: { message: PIXI.Text },
    };
    const textOf = (hangar: HangarDialog) => hangar.descriptionPane.text;
    const click = (button: { click: Subject<{ option: boolean, shift: boolean }> }) =>
        button.click.next({ option: false, shift: false });

    it('refuses to swap or send out a stored ship carrying an outfit that '
        + 'is not loaded (review finding 1)', async () => {
            const hull = pilot([stored({ outfits: [[BLASTER, 1], [GONE, 1]] })]);
            const { hangar, state, shown } = open(hull);
            await settle();
            internals(hangar).itemGrid.right();
            await settle();
            expect(internals(hangar).itemGrid.selection?.kind).toBe('stored');
            expect(hangar.buttons.swap.state).toBe('grey');
            expect(hangar.buttons.move.state).toBe('grey');
            click(hangar.buttons.swap);
            await settle();
            expect(state.hull).toBe(hull);
            expect(internals(hangar).text.message.text)
                .toBe(STORAGE_REFUSAL_TEXT.notLoaded);
            click(hangar.buttons.done);
            await shown;
        });

    it('loads the flown hull\'s outfits before a swap, so its persistent '
        + 'ones follow the pilot even from a cold cache (review finding 3)',
        async () => {
            const hull = pilot([stored()]);
            const { hangar, state, shown } = open(hull);
            await settle();
            internals(hangar).itemGrid.right();
            await settle();
            expect(hangar.buttons.swap.state).toBe('normal');
            click(hangar.buttons.swap);
            await settle();
            expect(state.hull.components.get(ShipComponent)?.id).toBe(STORED);
            expect(state.hull.components.get(OutfitsStateComponent)).toEqual(
                new Map([[BLASTER, { count: 2 }], [LICENCE, { count: 1 }]]));
            const put = state.hull.components.get(StoredShipsComponent)!;
            expect(put.map(record => record.outfits))
                .toEqual([[[BLASTER, 1]]]);
            // The names follow: the stored Hauler had none, the Runabout
            // goes into storage as the Rocinante.
            expect(put[0].shipName).toBe('Rocinante');
            expect(state.hull.components.get(PlayerNamesComponent))
                .toEqual({ pilot: 'Matt' });
            click(hangar.buttons.done);
            await shown;
        });

    it('a dismiss while the first grid loads closes it and binds nothing '
        + '(review finding 4)', async () => {
            let release!: () => void;
            const hold = new Promise<void>(resolve => { release = resolve; });
            const { hangar, shown } = open(pilot([stored()]),
                simulationData({ hold }));
            await settle();
            hangar.dismiss();
            release();
            await shown;
            await settle();
            expect(hangar.container.visible).toBeFalse();
            expect(MenuControls.focused).toBeUndefined();
        });

    it('Return presses Done', async () => {
        const { hangar, shown } = open(pilot([stored()]));
        await settle();
        expect(hangar.container.visible).toBeTrue();
        expect(MenuControls.pressDefaultButton({ key: 'Enter' })).toBeTrue();
        await shown;
        expect(hangar.container.visible).toBeFalse();
        expect(MenuControls.focused).toBeUndefined();
    });

    it('clips a long outfit list to the pane and scrolls it, back to the '
        + 'top for the next ship (Matthew\'s 2026-11-27 overflow)',
        async () => {
            const hull = pilot([stored()]);
            hull.components.set(OutfitsStateComponent, new Map(
                BUILD_IDS.map(id => [id, { count: 1 }])));
            const { hangar, shown } = open(hull);
            await settle();
            const pane = hangar.descriptionPane;
            const text = textOf(hangar);
            expect(text.text).toContain('Build Thing 40');
            expect(text.mask).toBeTruthy();
            expect(pane.frame).toEqual(hangarDescriptionFrame(false));
            const bottom = HANGAR_DESCRIPTION_PANE.y
                + HANGAR_DESCRIPTION_PANE.height;
            // Forty-odd lines run far past the pane...
            expect(text.y + text.height).toBeGreaterThan(bottom + 200);
            expect(pane.maxOffset).toBeGreaterThan(200);
            // ...and the wheel brings the last of them onto it.
            for (let i = 0; i < 100; i++) {
                pane.onWheel({ deltaX: 0, deltaY: 1, deltaMode: 1,
                    ctrlKey: false, timeStamp: i });
            }
            expect(pane.offset).toBe(pane.maxOffset);
            expect(text.y + text.height).toBeCloseTo(bottom, 0);
            // The stored Hauler's short sheet: at the top, nothing to scroll.
            internals(hangar).itemGrid.right();
            await settle();
            expect(text.text).not.toContain('Build Thing');
            expect(pane.offset).toBe(0);
            expect(pane.maxOffset).toBe(0);
            click(hangar.buttons.done);
            await shown;
        });

    it('keeps the sheet above a message under it', async () => {
        const { hangar, shown } = open(pilot([stored()]));
        await settle();
        internals(hangar).itemGrid.right();
        (hangar as unknown as { say(m: string): void }).say('A message.');
        const frame = hangar.descriptionPane.frame;
        expect(frame.y + frame.height).toBe(HANGAR_MESSAGE_Y - 4);
        (hangar as unknown as { say(m: string): void }).say('');
        expect(hangar.descriptionPane.frame)
            .toEqual(hangarDescriptionFrame(false));
        click(hangar.buttons.done);
        await shown;
    });

    describe('keys (Matthew 2026-11-27: e Escort / Store, s Swap)', () => {
        const label = (button: unknown) =>
            (button as { text: PIXI.Text }).text.text;
        /** KeyS's three bindings, in settings/controls.json's order. */
        const S_KEY = ['resetSecondary', 'shipyard', 'sell'] as const;

        function press(controls: Subject<ControlEvent>,
            ...actions: ControlEvent['action'][]) {
            for (const action of actions) {
                controls.next({ action, state: 'start' });
            }
        }

        it('s (every action KeyS is bound to) swaps to the selected ship '
            + 'once, as the Swap button does', async () => {
                const controls = new Subject<ControlEvent>();
                const hull = pilot([stored()]);
                const { hangar, state, shown } = open(hull, simulationData(),
                    controls);
                await settle();
                internals(hangar).itemGrid.right();
                await settle();
                expect(hangar.buttons.swap.state).toBe('normal');
                press(controls, ...S_KEY);
                await settle();
                expect(state.hull.components.get(ShipComponent)?.id)
                    .toBe(STORED);
                // Exactly one swap: the old Runabout is the one stored ship.
                expect(state.hull.components.get(StoredShipsComponent)!
                    .map(record => record.ship)).toEqual([FLOWN]);
                click(hangar.buttons.done);
                await shown;
            });

        it('e sends a stored ship out as an escort, and e again stores it',
            async () => {
                const controls = new Subject<ControlEvent>();
                const roster: { player: string, uuid: string,
                    entity: Entity }[] = [];
                const hull = pilot([stored()]);
                const { hangar, state, shown } = open(hull, simulationData(),
                    controls, {
                        roster: () => roster as never,
                        playerUuid: 'peer-1',
                        mintUuid: () => 'escort-1',
                    });
                await settle();
                internals(hangar).itemGrid.right();
                await settle();
                expect(label(hangar.buttons.move)).toBe('Escort');
                press(controls, 'escorts');
                await settle();
                expect(roster.map(row => row.uuid)).toEqual(['escort-1']);
                expect(state.hull.components.get(StoredShipsComponent) ?? [])
                    .toEqual([]);
                // The selection follows the ship, and the pill (and its
                // key) now reads Store.
                expect(internals(hangar).itemGrid.selection?.kind)
                    .toBe('escort');
                expect(label(hangar.buttons.move)).toBe('Store');
                press(controls, 'escorts');
                await settle();
                expect(roster).toEqual([]);
                expect(state.hull.components.get(StoredShipsComponent)!
                    .map(record => record.ship)).toEqual([STORED]);
                click(hangar.buttons.done);
                await shown;
            });

        it('a greyed button ignores its key', async () => {
            const controls = new Subject<ControlEvent>();
            const hull = pilot([stored({ outfits: [[GONE, 1]] })]);
            const { hangar, state, shown } = open(hull, simulationData(),
                controls, { roster: () => [], playerUuid: 'peer-1' });
            await settle();
            // The ship being flown: nothing to swap to or move.
            expect(internals(hangar).itemGrid.selection?.kind)
                .toBe('current');
            press(controls, 'escorts', ...S_KEY);
            await settle();
            expect(state.hull).toBe(hull);
            // A stored ship that cannot load: both pills grey, both
            // keys dead (no refusal message either: a key presses the
            // button as drawn).
            internals(hangar).itemGrid.right();
            await settle();
            expect(hangar.buttons.swap.state).toBe('grey');
            expect(hangar.buttons.move.state).toBe('grey');
            press(controls, 'escorts', ...S_KEY);
            await settle();
            expect(state.hull).toBe(hull);
            expect(internals(hangar).text.message.text).toBe('');
            click(hangar.buttons.done);
            await shown;
        });

        it('only while the hangar holds the keyboard', async () => {
            const controls = new Subject<ControlEvent>();
            const hull = pilot([stored()]);
            const { hangar, state, shown } = open(hull, simulationData(),
                controls);
            await settle();
            internals(hangar).itemGrid.right();
            await settle();
            // A surface over it (a prompt, say) takes the keys.
            const over = new MenuControls(controls, {});
            over.bind();
            press(controls, ...S_KEY);
            await settle();
            expect(state.hull).toBe(hull);
            over.unbind();
            click(hangar.buttons.done);
            await shown;
            press(controls, ...S_KEY);
            await settle();
            expect(state.hull).toBe(hull);
        });
    });

    it('lists ships under their own names where the caption has room',
        () => {
            const lookups = {
                getShip: (id: string) => SHIPS.get(id),
                getOutfit: (id: string) => OUTFITS.get(id),
            };
            const gameData = {
                data: {
                    Ship: { getCached: (id: string) => SHIPS.get(id) },
                    Outfit: { getCached: (id: string) => OUTFITS.get(id) },
                },
            } as unknown as SimulationGameDataInterface;
            const hull = pilot([
                stored({ shipName: 'Tub' }),
                stored({ shipName: 'A Name Far Too Long For A Tile' }),
                stored(),
            ]);
            const entries = hangarEntries(hull, lookups, gameData,
                () => 'Somewhere', HERE);
            expect(entries.map(entry => entry.name)).toEqual([
                'Rocinante', 'Tub', 'A Name Far Too Long For A Tile',
                'Hauler']);
            expect(entries.map(entry => entry.shortName.split('\n')[0]))
                .toEqual(['Rocinante', 'Tub', 'Hauler', 'Hauler']);
            // The pane names the ship and its class.
            expect(entries[1].desc.split('\n').slice(0, 2))
                .toEqual(['Tub', 'Hauler']);
            expect(entries[3].desc.split('\n')[1]).not.toBe('Hauler');
        });

    it('the shop search stands down while a dialog covers the shop '
        + '(review finding 5)', () => {
            const search = new ShopSearchField();
            search.open(true);
            search.suspend();
            search.focus();
            expect(search.hasFocus).toBeFalse();
            search.resume();
            search.focus();
            expect(search.hasFocus).toBeTrue();
            search.close();
        });
});
