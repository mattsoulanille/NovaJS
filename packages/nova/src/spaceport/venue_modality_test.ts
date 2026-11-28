import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { ControlAction, ControlEvent } from '../nova_plugin/core/index.js';
import { Button } from './button.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { Menu } from './menu.js';
import { MenuControls } from './menu_controls.js';
import { addShieldPassThrough, removeShieldPassThrough } from './modal_shield.js';
import { Spaceport } from './spaceport.js';

/**
 * The spaceport's venues are modal, as in the original: while one is open
 * nothing behind it reacts — not the spaceport's buttons (pointer: the
 * venue's full-screen shield; logic: Spaceport.onMainScreenClick), not its
 * keys (the MenuControls focus stack) — until its Done. Matthew's
 * 2026-11-27 playtest: with the Outfitter open, the Trade Center button
 * below the outfitter's frame opened the trade center on top; 'd' closed
 * the trade center and handed the keys to the spaceport UNDER the
 * outfitter, a second 'd' left the planet with the outfitter still bound,
 * and the ship would not fly until a third 'd'.
 */
describe('Spaceport venues are modal', () => {
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
    type SpaceportButton = 'bar' | 'missions' | 'tradeCenter' | 'shipyard'
        | 'outfitter' | 'refuel' | 'leave';
    const SPACEPORT_BUTTONS: SpaceportButton[] = ['bar', 'missions',
        'tradeCenter', 'shipyard', 'outfitter', 'refuel', 'leave'];

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

    function controlsOf(surface: object): MenuControls {
        return (surface as { controls: MenuControls }).controls;
    }

    function focusedIs(surface: object) {
        return MenuControls.focused === controlsOf(surface);
    }

    async function dock() {
        // Whatever an earlier spec left focused: a departure must give the
        // keyboard back to exactly this.
        const focusedBefore = MenuControls.focused;
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
        // The venue-entry offers are not this spec's business.
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
        const buttons = (spaceport as unknown as
            { buttons: Record<SpaceportButton, Button> }).buttons;
        // Every button live, so a gate is what stops it (the refuel
        // button is hidden on a full tank).
        buttons.refuel.container.visible = true;
        buttons.refuel.state = 'normal';
        const stage = new PIXI.Container();
        stage.addChild(spaceport.container);
        return {
            spaceport, venues, press, departed, controlEvents, buttons,
            stage, focusedBefore, hasDeparted: () => hasDeparted,
        };
    }

    /** What a click at the centre of `button` would hit on `stage`. */
    function hitOnButton(stage: PIXI.Container, button: Button) {
        // getBounds refreshes the world transforms the hit test reads.
        stage.getBounds();
        const bounds = button.container.getBounds();
        return new PIXI.EventBoundary(stage).hitTest(
            bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    }

    function isWithin(object: PIXI.DisplayObject | null,
        ancestor: PIXI.DisplayObject): boolean {
        for (let at = object; at; at = at.parent) {
            if (at === ancestor) {
                return true;
            }
        }
        return false;
    }

    it('lets the pointer reach the spaceport buttons on the main screen',
        async () => {
            const { buttons, stage, press, departed } = await dock();
            for (const name of SPACEPORT_BUTTONS) {
                expect(isWithin(hitOnButton(stage, buttons[name]),
                    buttons[name].container)).withContext(name).toBeTrue();
            }
            press('depart');
            await departed;
        });

    for (const name of Object.keys(VENUE_KEYS) as VenueName[]) {
        it(`keeps every spaceport button dead under the ${name}`,
            async () => {
                const {
                    spaceport, venues, press, departed, buttons, stage,
                    hasDeparted, focusedBefore,
                } = await dock();
                const venue = venues[name]!;
                expect(venue).withContext(name).toBeDefined();
                press(VENUE_KEYS[name]);
                await until(() => focusedIs(venue));
                expect(focusedIs(venue)).withContext('open').toBeTrue();

                for (const button of SPACEPORT_BUTTONS) {
                    // The pointer lands on the venue, not the button...
                    const hit = hitOnButton(stage, buttons[button]);
                    expect(isWithin(hit, buttons[button].container))
                        .withContext(`${button} hit`).toBeFalse();
                    expect(isWithin(hit, venue.container))
                        .withContext(`${button} hit the venue`).toBeTrue();
                    // ...and a click that got there anyway does nothing.
                    buttons[button].click.next({ option: false, shift: false });
                }
                await settle();
                expect(focusedIs(venue)).withContext('still on top')
                    .toBeTrue();
                for (const other of Object.keys(VENUE_KEYS) as VenueName[]) {
                    if (other !== name) {
                        expect(venues[other]?.container.visible ?? false)
                            .withContext(`${other} opened`).toBeFalse();
                    }
                }
                expect(hasDeparted()).withContext('departed').toBeFalse();

                // The spaceport's own keys stay quiet under it too: the
                // other venues' keys open nothing.
                for (const other of Object.keys(VENUE_KEYS) as VenueName[]) {
                    if (other !== name) {
                        press(VENUE_KEYS[other]);
                    }
                }
                await settle();
                expect(focusedIs(venue)).withContext('keys').toBeTrue();
                for (const other of Object.keys(VENUE_KEYS) as VenueName[]) {
                    if (other !== name) {
                        expect(venues[other]?.container.visible ?? false)
                            .withContext(`${other} opened by key`)
                            .toBeFalse();
                    }
                }

                // Closing it gives the main screen back, buttons and all.
                expect(MenuControls.pressDefaultButton({ key: 'Enter' }))
                    .toBeTrue();
                await until(() => spaceport.onMainScreen);
                expect(isWithin(hitOnButton(stage, buttons.leave),
                    buttons.leave.container)).withContext('Leave back')
                    .toBeTrue();
                buttons.leave.click.next({ option: false, shift: false });
                await departed;
                expect(MenuControls.focused).toBe(focusedBefore);
            });
    }

    it('Outfitter, click Trade Center, d, d: closes the outfitter, then '
        + 'leaves with the keyboard free', async () => {
        const {
            spaceport, venues, press, departed, buttons, hasDeparted,
            focusedBefore,
        } = await dock();
        press('outfitter');
        await until(() => focusedIs(venues.outfitter!));
        buttons.tradeCenter.click.next({ option: false, shift: false });
        await settle();
        expect(venues.tradeCenter!.container.visible)
            .withContext('trade center over the outfitter').toBeFalse();
        expect(focusedIs(venues.outfitter!)).toBeTrue();

        // The first 'd' is the outfitter's Done, the second the Leave.
        press('depart');
        await until(() => spaceport.onMainScreen);
        expect(venues.outfitter!.container.visible).toBeFalse();
        await settle();
        expect(hasDeparted()).withContext('one d left').toBeFalse();
        press('depart');
        await departed;
        // Back in flight nothing of the visit holds the keyboard: the
        // flight controls answer the very next key.
        expect(MenuControls.focused).toBe(focusedBefore);
        for (const surface of [spaceport, ...(Object.keys(VENUE_KEYS) as
            VenueName[]).map(name => venues[name])]) {
            if (surface) {
                expect(MenuControls.focused === controlsOf(surface))
                    .toBeFalse();
            }
        }
    });

    it('opens no venue while a Leave is settling, and leaves nothing bound',
        async () => {
            const {
                spaceport, venues, press, departed, buttons, focusedBefore,
            } = await dock();
            // Hold the lift-off settlement (it loads ship data) open.
            let finish!: () => void;
            const held = new Promise<undefined>(resolve => {
                finish = () => resolve(undefined);
            });
            (spaceport as unknown as {
                settleEscortDealsAtLiftOff: () => Promise<undefined>,
            }).settleEscortDealsAtLiftOff = () => held;
            press('depart');
            await settle();
            press('outfitter');
            buttons.tradeCenter.click.next({ option: false, shift: false });
            press('depart');
            await settle();
            expect(venues.outfitter!.container.visible).toBeFalse();
            expect(venues.tradeCenter!.container.visible).toBeFalse();
            finish();
            await departed;
            expect(MenuControls.focused).toBe(focusedBefore);
        });

    it('closes a venue somehow still open when the spaceport departs',
        async () => {
            const { spaceport, venues, press, departed, focusedBefore } =
                await dock();
            press('tradeCenter');
            await until(() => focusedIs(venues.tradeCenter!));
            // Reach the Leave past every gate: the departure must still
            // take the venue (and its keys) with it.
            await (spaceport as unknown as { leave: () => Promise<void> })
                .leave();
            await departed;
            await settle();
            expect(venues.tradeCenter!.container.visible).toBeFalse();
            expect(MenuControls.focused).toBe(focusedBefore);
        });

    it('keeps the venue behind a venue sub-dialog dead to the pointer',
        async () => {
            const { venues, press, departed, stage } = await dock();
            const cases: [VenueName, string, string][] = [
                ['bar', 'hireEscort', 'leave'],
                ['bar', 'news', 'leave'],
                ['bar', 'gamble', 'leave'],
                ['shipyard', 'hangar', 'done'],
                ['outfitter', 'quantityDialog', 'done'],
                ['tradeCenter', 'quantityDialog', 'done'],
            ];
            for (const [venueName, dialogName, buttonName] of cases) {
                const venue = venues[venueName]!;
                press(VENUE_KEYS[venueName]);
                await until(() => focusedIs(venue));
                const dialog = (venue as unknown as Record<string,
                    { container: PIXI.Container }>)[dialogName];
                const behind = (venue as unknown as
                    { buttons: Record<string, Button> }).buttons[buttonName];
                const label = `${venueName} ${dialogName}`;
                expect(dialog).withContext(label).toBeDefined();
                expect(behind).withContext(label).toBeDefined();
                expect(isWithin(hitOnButton(stage, behind), behind.container))
                    .withContext(`${label}: closed`).toBeTrue();
                dialog.container.visible = true;
                const hit = hitOnButton(stage, behind);
                expect(isWithin(hit, behind.container))
                    .withContext(label).toBeFalse();
                expect(isWithin(hit, dialog.container))
                    .withContext(`${label} took it`).toBeTrue();
                dialog.container.visible = false;
                expect(MenuControls.pressDefaultButton({ key: 'Enter' }))
                    .withContext(label).toBeTrue();
                await until(() => !venue.container.visible);
            }
            press('depart');
            await departed;
        });

    it('lets the status bar\'s debug buttons through a venue\'s shield',
        async () => {
            const { venues, press, departed, stage } = await dock();
            // A stand-in debug button, under the spaceport as the status
            // bar is (it joins the stage first), somewhere the venue's
            // frame does not reach.
            const debug = new PIXI.Graphics().beginFill(0xffffff)
                .drawRect(0, 0, 100, 25).endFill();
            debug.eventMode = 'static';
            debug.position.set(3000, 20);
            const other = new PIXI.Graphics().beginFill(0xffffff)
                .drawRect(0, 0, 100, 25).endFill();
            other.eventMode = 'static';
            other.position.set(3000, 60);
            stage.addChildAt(debug, 0);
            stage.addChildAt(other, 0);
            addShieldPassThrough(debug);
            try {
                press('outfitter');
                await until(() => focusedIs(venues.outfitter!));
                stage.getBounds();
                const boundary = new PIXI.EventBoundary(stage);
                expect(boundary.hitTest(3050, 32)).toBe(debug);
                // The rest of the bar is behind the shield.
                expect(boundary.hitTest(3050, 72)).not.toBe(other);
                expect(isWithin(boundary.hitTest(3050, 72),
                    venues.outfitter!.container)).toBeTrue();
            } finally {
                removeShieldPassThrough(debug);
            }
            expect(MenuControls.pressDefaultButton({ key: 'Enter' }))
                .toBeTrue();
            await until(() => !venues.outfitter!.container.visible);
            press('depart');
            await departed;
        });
});
