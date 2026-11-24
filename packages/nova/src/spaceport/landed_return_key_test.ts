import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { beginPixiTextEntry } from '../input_focus.js';
import { ControlAction, ControlEvent } from '../nova_plugin/core/index.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { Menu } from './menu.js';
import { MenuControls } from './menu_controls.js';
import { Spaceport } from './spaceport.js';

/**
 * Return on the landed screens presses the default button, as in the
 * original (docs/reference_experiments.md, "The UI screen x key matrix,
 * wave 11", mismatch 3, and the wave-10 key notes it cites): Leave in the
 * spaceport (K1: Return = Leave), and in the outfitter and the Mission
 * BBS it closes the venue without buying or accepting anything. The
 * shipyard, trade center and bar close the same way, through their Done /
 * Leave. Option+Return is the fullscreen shortcut and never a button; a
 * held Return (key repeat) presses nothing; a text field with the
 * keyboard keeps its own Return; a surface without a default button (the
 * star map, a quantity dialog) swallows it.
 */
describe('Return on the landed screens', () => {
    beforeAll(() => installHeadlessPixi());

    type VenueName = 'outfitter' | 'shipyard' | 'tradeCenter' | 'bar'
        | 'missionComputer';
    const VENUE_KEYS: Record<VenueName, ControlAction> = {
        outfitter: 'outfitter',
        shipyard: 'shipyard',
        tradeCenter: 'tradeCenter',
        bar: 'bar',
        missionComputer: 'missionBBS',
    };

    const RETURN = { key: 'Enter' };

    function stubAssets(): DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
            data: {
                Sound: { get: async () => undefined },
                StringTable: { get: async () => ({ strings: [] }) },
            },
        } as unknown as DisplayAssetDataInterface;
    }

    async function settle(turns = 50) {
        for (let i = 0; i < turns; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    async function until(condition: () => boolean) {
        for (let i = 0; i < 2000 && !condition(); i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    function focusedIs(menu: Menu<Entity> | Spaceport) {
        return MenuControls.focused ===
            (menu as unknown as { controls: MenuControls }).controls;
    }

    async function dock() {
        const gameData = await getSyntheticGameData();
        const controlEvents = new Subject<ControlEvent>();
        const spaceport = new Spaceport(
            stubAssets(), gameData,
            SYNTHETIC.planets.port, controlEvents,
            async () => undefined);
        await spaceport.buildPromise;
        const venues = spaceport as unknown as
            Record<VenueName, Menu<Entity> | undefined>;
        await Promise.all(Object.keys(VENUE_KEYS).map(name =>
            venues[name as VenueName]?.buildPromise));
        // The synthetic port's venue-entry mission offers (AvailLoc 2,
        // 4-6) are not this spec's business: skip them.
        (spaceport as unknown as
            { presentVenueOffers: () => Promise<void> })
            .presentVenueOffers = async () => undefined;
        const bar = venues.bar as unknown as
            { presentBarOffers: () => Promise<void> } | undefined;
        if (bar) {
            bar.presentBarOffers = async () => undefined;
        }
        const { makeShip } = await import('../nova_plugin/ship/index.js');
        const entity: Entity = makeShip(
            await gameData.data.Ship.get(SYNTHETIC.ships.warden));
        let hasDeparted = false;
        const departed = spaceport.show(entity).then(result => {
            hasDeparted = true;
            return result;
        });
        await until(() => spaceport.onMainScreen);
        expect(spaceport.onMainScreen).toBeTrue();
        const press = (action: ControlAction) =>
            controlEvents.next({ action, state: 'start' });
        return {
            spaceport, venues, press, departed, controlEvents,
            hasDeparted: () => hasDeparted,
        };
    }

    it('presses Leave in the spaceport, through the click\'s leave()',
        async () => {
            const { spaceport, departed, hasDeparted } = await dock();
            const leave = spyOn(spaceport as unknown as
                { leave: () => Promise<void> }, 'leave').and.callThrough();
            // Option+Return is fullscreen, and a repeat is a held key.
            expect(MenuControls.pressDefaultButton(
                { key: 'Enter', altKey: true })).toBeFalse();
            expect(MenuControls.pressDefaultButton(
                { key: 'Enter', repeat: true })).toBeFalse();
            await settle();
            expect(leave).not.toHaveBeenCalled();
            expect(hasDeparted()).toBeFalse();
            expect(spaceport.onMainScreen).toBeTrue();

            expect(MenuControls.pressDefaultButton(RETURN)).toBeTrue();
            expect(leave).toHaveBeenCalledTimes(1);
            await departed;
            expect(hasDeparted()).toBeTrue();
            // Back in flight nothing is focused that has a default
            // button: Return is unbound there.
            expect(MenuControls.focused?.defaultButton).toBeUndefined();
            expect(MenuControls.pressDefaultButton(RETURN)).toBeFalse();
        });

    it('leaves Return to a text field that has the keyboard', async () => {
        const { spaceport, departed, hasDeparted } = await dock();
        const release = beginPixiTextEntry();
        try {
            expect(MenuControls.pressDefaultButton(RETURN)).toBeFalse();
        } finally {
            release();
        }
        await settle();
        expect(hasDeparted()).toBeFalse();
        expect(spaceport.onMainScreen).toBeTrue();
        expect(MenuControls.pressDefaultButton(RETURN)).toBeTrue();
        await departed;
    });

    for (const name of Object.keys(VENUE_KEYS) as VenueName[]) {
        it(`presses Done in the ${name}`, async () => {
            const {
                spaceport, venues, press, departed, controlEvents,
                hasDeparted,
            } = await dock();
            const venue = venues[name]!;
            expect(venue).withContext(name).toBeDefined();
            press(VENUE_KEYS[name]);
            await until(() => focusedIs(venue));
            expect(focusedIs(venue)).withContext(`${name} open`).toBeTrue();

            // Not Option+Return, not a repeat, not under a text field.
            expect(MenuControls.pressDefaultButton(
                { key: 'Enter', altKey: true })).toBeFalse();
            expect(MenuControls.pressDefaultButton(
                { key: 'Enter', repeat: true })).toBeFalse();
            const release = beginPixiTextEntry();
            expect(MenuControls.pressDefaultButton(RETURN)).toBeFalse();
            release();
            // A surface over the venue without a default button (the
            // star map, a quantity dialog, the bar's popups) swallows it.
            const overlay = new MenuControls(controlEvents);
            overlay.bind();
            expect(MenuControls.pressDefaultButton(RETURN)).toBeFalse();
            overlay.unbind();
            await settle();
            expect(focusedIs(venue)).withContext('still open').toBeTrue();
            expect(venue.container.visible).withContext('shown').toBeTrue();

            // Return: the venue's own Done, back to the spaceport, and
            // the spaceport stays (one press, one button).
            expect(MenuControls.pressDefaultButton(RETURN)).toBeTrue();
            await until(() => spaceport.onMainScreen);
            expect(spaceport.onMainScreen).withContext('back').toBeTrue();
            expect(venue.container.visible).withContext('closed').toBeFalse();
            await settle();
            expect(hasDeparted()).withContext('not left').toBeFalse();

            // And Return again leaves.
            expect(MenuControls.pressDefaultButton(RETURN)).toBeTrue();
            await departed;
        });
    }
});
