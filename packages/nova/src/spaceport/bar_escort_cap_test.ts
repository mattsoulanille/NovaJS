import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultPlanetData } from 'novadatainterface/planet_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { BayFighterComponent } from '../nova_plugin/escorts/index.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent, NO_DEAL,
    PlayerEscortComponent,
} from '../nova_plugin/player/index.js';
import { CargoComponent, OutfitsStateComponent, ShipComponent } from '../nova_plugin/ship/index.js';
import { Bar } from './bar.js';
import { Button } from './button.js';
import { FleetEscortEntry } from './fleet_cargo.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
import { MissionUniverse } from './mission_universe.js';
import { PendingEscortsComponent } from './pending_escorts.js';

/**
 * ============================================================================
 * THE BAR GREYS HIRE ESCORT AT THE ESCORT CAP
 * ============================================================================
 *
 * Reference "Escort cap, wave 23": the original's bar greys its Hire
 * Escort button once the player has six escorts, hired or captured, with
 * no message (the hire dialog is never reached); nine bay fighters and no
 * escorts leave it enabled. NovaJS used to keep the button live and print
 * STR# 2002 #123 inside the hire dialog. The count is the hire dialog's
 * own (hire_escort.ts escortsHeld), so the two cannot disagree.
 */
describe('the bar\'s Hire Escort at the escort cap', () => {
    beforeAll(() => installHeadlessPixi());

    const PLANET_ID = 'nova:128';
    const SHIP_ID = 'nova:128';
    const PLAYER = 'player-uuid';

    function displayAssets(): DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
            data: {
                Sound: { get: async () => undefined },
                StringTable: { get: async () => { throw new Error('none'); } },
            },
        } as unknown as DisplayAssetDataInterface;
    }

    /** One stellar with a bar (TechLevel 1) and one pilot always for hire
     * there (TechLevel 1, HireRandom 100), as the reference's Kit Hire
     * Disc at Kit Port. */
    function gameData(): MockGameData {
        const data = new MockGameData();
        data.data.Planet.map.set(PLANET_ID, {
            ...getDefaultPlanetData(), id: PLANET_ID, name: 'Kit Port',
            techLevel: 1,
            flags: { ...getDefaultPlanetData().flags, hasBar: true },
        });
        data.data.Ship.map.set(SHIP_ID, {
            ...getDefaultShipData(), id: SHIP_ID, name: 'Kit Hire Disc',
            pict: '', techLevel: 1, hireRandom: 100, price: 10_000,
        });
        return data;
    }

    function landedPilot(pending: string[] = []): Entity {
        const pilot = new Entity('pilot')
            .addComponent(ShipComponent, { id: SHIP_ID })
            .addComponent(CreditsComponent, { credits: 10_000_000 })
            .addComponent(OutfitsStateComponent, new Map())
            .addComponent(CargoComponent, new Map())
            .addComponent(MissionsComponent, new Map())
            .addComponent(ControlBitsComponent, new Set<number>())
            .addComponent(GameDateComponent, { day: 1, month: 1, year: 1177 });
        if (pending.length > 0) {
            pilot.components.set(PendingEscortsComponent, pending);
        }
        return pilot;
    }

    let n = 0;
    function escort(kind: 'hired' | 'captured' | 'fighter'): FleetEscortEntry {
        const entity = new Entity();
        entity.components.set(PlayerEscortComponent, {
            player: PLAYER, deal: NO_DEAL,
            ...(kind === 'captured' ? { provenance: 'captured' } : {}),
        } as any);
        if (kind === 'fighter') {
            entity.components.set(BayFighterComponent,
                { bayWeaponId: 'nova:150', slot: 0 } as any);
        }
        return { player: PLAYER, uuid: `escort ${n++}`, entity };
    }
    const many = (count: number, kind: 'hired' | 'captured' | 'fighter') =>
        Array.from({ length: count }, () => escort(kind));

    async function waitFor(ready: () => boolean) {
        for (let i = 0; i < 2000 && !ready(); i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(ready()).toBe(true);
    }

    function internals(bar: Bar) {
        return bar as unknown as {
            controls: MenuControls,
            buttons: { hireEscort: Button, leave: Button },
            hireEscort: {
                container: PIXI.Container,
                buttons: { hire: Button, done: Button },
            },
        };
    }

    /** Enters the bar with `roster` landed and `world` still flying. */
    async function enter(options: {
        roster?: FleetEscortEntry[], world?: FleetEscortEntry[],
        pending?: string[],
    } = {}) {
        const controlEvents = new Subject<ControlEvent>();
        const data = gameData() as unknown as SimulationGameDataInterface;
        const bar = new Bar(displayAssets(), data, controlEvents,
            MissionUniverse.shared(data), PLANET_ID);
        await bar.buildPromise;
        bar.setLandedEscorts(() => options.roster ?? [], PLAYER,
            (options.world ?? []).map(({ uuid, entity }) =>
                [uuid, entity] as [string, Entity]));
        const left = bar.show(landedPilot(options.pending));
        const parts = internals(bar);
        await waitFor(() => MenuControls.focused === parts.controls);
        return { bar, controlEvents, left, ...parts };
    }

    afterEach(() => {
        while (MenuControls.focused) {
            MenuControls.focused.unbind();
        }
    });

    async function leave(bar: Bar, left: Promise<Entity>, leaveButton: Button) {
        leaveButton.click.next({ shift: false, option: false });
        await waitFor(() => !bar.container.visible);
        await left;
    }

    it('is enabled with no escorts', async () => {
        const { bar, left, buttons } = await enter();
        expect(buttons.hireEscort.state).toBe('normal');
        await leave(bar, left, buttons.leave);
    });

    it('is greyed on arrival with six hired escorts, and neither its click '
        + 'nor the hotkey opens the hire dialog (no message)', async () => {
            const { bar, left, buttons, controlEvents, hireEscort } =
                await enter({ roster: many(6, 'hired') });
            expect(buttons.hireEscort.state).toBe('grey');
            buttons.hireEscort.click.next({ shift: false, option: false });
            controlEvents.next({ action: 'hire', state: 'start' });
            for (let i = 0; i < 50; i++) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            expect(hireEscort.container.visible).toBeFalse();
            await leave(bar, left, buttons.leave);
        });

    it('is greyed with six CAPTURED escorts (some still flying down)',
        async () => {
            const captured = many(6, 'captured');
            const { bar, left, buttons } = await enter(
                { roster: captured.slice(0, 2), world: captured.slice(2) });
            expect(buttons.hireEscort.state).toBe('grey');
            await leave(bar, left, buttons.leave);
        });

    it('stays enabled with nine bay fighters and no escorts', async () => {
        const { bar, left, buttons } = await enter(
            { roster: many(9, 'fighter') });
        expect(buttons.hireEscort.state).toBe('normal');
        await leave(bar, left, buttons.leave);
    });

    it('counts this landing\'s earlier hires (five escorts and one pending)',
        async () => {
            const { bar, left, buttons } = await enter(
                { roster: many(5, 'hired'), pending: [SHIP_ID] });
            expect(buttons.hireEscort.state).toBe('grey');
            await leave(bar, left, buttons.leave);
        });

    it('greys as the dialog closes after the sixth hire', async () => {
        const { bar, left, buttons, hireEscort } =
            await enter({ roster: many(5, 'hired') });
        expect(buttons.hireEscort.state).toBe('normal');
        buttons.hireEscort.click.next({ shift: false, option: false });
        await waitFor(() => hireEscort.container.visible);
        // The grid opens on the only pilot; hire him (the sixth).
        const grid = (hireEscort as unknown as {
            itemGrid: { selection?: unknown },
        }).itemGrid;
        await waitFor(() => grid !== undefined);
        if (!grid.selection) {
            // Select the first tile through the dialog's own keys.
            (hireEscort as unknown as { controls: MenuControls }).controls
                .controls.right?.();
        }
        await waitFor(() => grid.selection !== undefined);
        hireEscort.buttons.hire.click.next({ shift: false, option: false });
        // The dialog's own Hire greys at the cap too.
        expect(hireEscort.buttons.hire.state).toBe('grey');
        hireEscort.buttons.done.click.next({ shift: false, option: false });
        await waitFor(() => !hireEscort.container.visible);
        await waitFor(() => buttons.hireEscort.state === 'grey');
        await leave(bar, left, buttons.leave);
    });
});
