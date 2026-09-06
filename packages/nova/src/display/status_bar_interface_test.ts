import 'jasmine';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { DEFAULT_STATUS_BAR_ID, statusBarIdForShip } from './status_bar_interface.js';

/**
 * Which ïntf resource the in-flight status bar is drawn from, per the EVN
 * Bible's gövt Interface rule ("ID of an ïntf resource to use when the player
 * is flying a ship whose inherent attributes govt or inherent combat govt is
 * equal to this govt type. Values less than 128 will be interpreted as 128").
 * The parser side — folding the shïp InherentGovt encodings 128-383 /
 * 1128-1383 / 2128-2383 into one government — is covered by novaparse's
 * interfaceGovtId spec; these cover the display's lookup and its fallbacks.
 */
function fakeGameData(options: {
    ships?: Record<string, { interfaceGovt: string | null }>,
    govts?: Record<string, { statusBar: string | null }>,
}): SimulationGameDataInterface {
    return {
        data: {
            Ship: { getCached: (id: string) => options.ships?.[id] },
            Govt: { getCached: (id: string) => options.govts?.[id] },
        },
    } as unknown as SimulationGameDataInterface;
}

describe('statusBarIdForShip', () => {
    it('uses the interface named by the ship’s government', () => {
        const gameData = fakeGameData({
            ships: { 'nova:144': { interfaceGovt: 'nova:128' } },
            govts: { 'nova:128': { statusBar: 'nova:130' } },
        });
        expect(statusBarIdForShip('nova:144', gameData)).toBe('nova:130');
    });

    it('falls back to the default bar for a ship with no inherent govt', () => {
        const gameData = fakeGameData({
            ships: { 'nova:133': { interfaceGovt: null } },
        });
        expect(statusBarIdForShip('nova:133', gameData))
            .toBe(DEFAULT_STATUS_BAR_ID);
    });

    it('falls back to the default bar when the govt names no interface', () => {
        // gövt Interface below 128 parses to null ("interpreted as 128").
        const gameData = fakeGameData({
            ships: { 'nova:176': { interfaceGovt: 'nova:140' } },
            govts: { 'nova:140': { statusBar: null } },
        });
        expect(statusBarIdForShip('nova:176', gameData))
            .toBe(DEFAULT_STATUS_BAR_ID);
    });

    it('is undefined until the ship data is cached', () => {
        expect(statusBarIdForShip('nova:144', fakeGameData({})))
            .toBeUndefined();
    });

    it('is undefined until the government data is cached', () => {
        const gameData = fakeGameData({
            ships: { 'nova:144': { interfaceGovt: 'nova:128' } },
        });
        // Caching is in flight: keep the current bar rather than flashing the
        // default one for a frame.
        expect(statusBarIdForShip('nova:144', gameData)).toBeUndefined();
    });
});
