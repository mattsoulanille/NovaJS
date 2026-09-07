import 'jasmine';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { DEBUG_CREDITS_GRANT } from './debug_cheat_plugin.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import { CreditsComponent } from '../player/player_state_plugin.js';
import { LegalRecordsComponent } from '../reputation/reputation_plugin.js';
import { recordHostile, recordWith } from '../reputation/reputation.js';
import { ShipControlEvent, ShipControlStateComponent } from '../player/ship_control.js';

/**
 * The debug cheats in a LIVE world (parsed game data, the full simulation
 * stack): a control edge on the player's ship — exactly the input record
 * browser.ts forwards when a debug button is clicked — grants credits or
 * clears the legal record, deterministically.
 */
describe('debug cheats in a live world', () => {
    const PLAYER = 'player ship';
    // The Concord of Meridian (CrimeTol 20).
    const MERIDIAN = SYNTHETIC.govts.meridian;

    async function makeWorld() {
        const gameData = await getSyntheticGameData();
        // Thessaly Reach: asteroid-free; NPCs off for control.
        const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            'worker', { npcs: false });
        return { gameData, world };
    }

    async function addPlayer(world: World,
        gameData: Awaited<ReturnType<typeof makeWorld>>['gameData'],
        records = new Map<string, number>()) {
        const player = makeShip(
            await gameData.data.Ship.get(SYNTHETIC.ships.skiff));
        player.components.set(CreditsComponent, { credits: 0 });
        player.components.set(LegalRecordsComponent, records);
        await completeEntity(world, player);
        world.entities.set(PLAYER, player);
        return player;
    }

    /** Drive one control edge on the player's ship (the input path). */
    function press(world: World, action: string) {
        world.entities.get(PLAYER)!.components.set(ShipControlStateComponent,
            new Map([[action, 'start']]) as any);
        world.emit(ShipControlEvent, undefined, [PLAYER]);
        world.step();
    }

    it('Give 1M Credits adds 1,000,000 to the acting player', async () => {
        const { gameData, world } = await makeWorld();
        const player = await addPlayer(world, gameData);
        world.step();

        press(world, 'debugGiveCredits');
        expect(player.components.get(CreditsComponent)!.credits)
            .toBe(DEBUG_CREDITS_GRANT);

        // The edge decays to a held control on the next input, so the
        // cheat does not re-apply on later ship-control events.
        press(world, 'accelerate');
        expect(player.components.get(CreditsComponent)!.credits)
            .toBe(DEBUG_CREDITS_GRANT);
    });

    it('Clear Legal Record restores a hostile record to neutral',
        async () => {
            const { gameData, world } = await makeWorld();
            // Deep in criminal Meridian territory (record < -CrimeTol).
            const player = await addPlayer(world, gameData,
                new Map([[MERIDIAN, -100]]));
            world.step();

            const govt = await gameData.data.Govt.get(MERIDIAN);
            const records = player.components.get(LegalRecordsComponent)!;
            expect(recordHostile(records.get(MERIDIAN)!, govt.crimeTol))
                .toBeTrue();

            press(world, 'debugClearRecord');

            // Every stored record is gone, so the govt reads as its
            // neutral default and is no longer hostile.
            expect(records.size).toBe(0);
            expect(recordHostile(recordWith(records, MERIDIAN, govt),
                govt.crimeTol)).toBeFalse();
        });
});
