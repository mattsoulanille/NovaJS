import 'jasmine';
import { World } from 'nova_ecs/world';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { DEBUG_CREDITS_GRANT } from './debug_cheat_plugin.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import { CreditsComponent } from '../player/player_state_plugin.js';
import { LegalRecordsComponent } from '../reputation/reputation_plugin.js';
import { recordHostile, recordWith } from '../reputation/reputation.js';
import { ShipControlEvent, ShipControlStateComponent } from '../player/ship_control.js';

/**
 * The debug cheats in a LIVE world (real game data, the full simulation
 * stack): a synthetic control edge on the player's ship — exactly the
 * input record browser.ts forwards when a debug button is clicked —
 * grants credits or clears the legal record, deterministically.
 */
describe('debug cheats in a live world', () => {
    const PLAYER = 'player ship';
    // Federation govt (CrimeTol 10 in stock data).
    const FED = 'nova:128';

    async function makeWorld() {
        const gameData = await getIntegrationGameData();
        // nova:226: asteroid-free plugin system; NPCs off for control.
        const world = await makeSystem('nova:226', gameData, 'worker',
            { npcs: false });
        return { gameData, world };
    }

    async function addPlayer(world: World,
        gameData: Awaited<ReturnType<typeof makeWorld>>['gameData'],
        records = new Map<string, number>()) {
        const player = makeShip(await gameData.data.Ship.get('nova:128'));
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
            // Deep in criminal Federation territory (record < -CrimeTol).
            const player = await addPlayer(world, gameData,
                new Map([[FED, -100]]));
            world.step();

            const fedGovt = await gameData.data.Govt.get(FED);
            const records = player.components.get(LegalRecordsComponent)!;
            expect(recordHostile(records.get(FED)!, fedGovt.crimeTol))
                .toBeTrue();

            press(world, 'debugClearRecord');

            // Every stored record is gone, so the govt reads as its
            // neutral default and is no longer hostile.
            expect(records.size).toBe(0);
            expect(recordHostile(recordWith(records, FED, fedGovt),
                fedGovt.crimeTol)).toBeFalse();
        });
});
