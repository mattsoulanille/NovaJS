import 'jasmine';
import { PilotProfile } from '../title/client_prefs.js';
import { expandMissionText } from '../nova_plugin/missions/index.js';
import { MissionUniverse } from './mission_universe.js';
import { playerIdentitySubs } from './player_identity.js';

const PROFILE: PilotProfile = {
    name: 'Matt', nickname: 'Hawkeye', gender: 'male', strict: false,
    shipNumber: 525,
};

/**
 * A universe stub exposing what the identity subs read (structural):
 * shipTypeName, and the rank/govt lookups behind the rank tags — which
 * resolve nothing here, so <PRK>, <PRKnnn> and <RRK> take their
 * "captain" fallbacks whatever rank an earlier spec activated.
 */
function universeWith(name: string | undefined): MissionUniverse {
    return {
        shipTypeName: async () => name,
        getRank: () => undefined,
        getGovt: () => undefined,
    } as unknown as MissionUniverse;
}

describe('playerIdentitySubs', () => {
    it('builds the identity tags from profile + hull, ship name per the '
        + 'sigma reference ("Starbridge 525")', async () => {
        const subs = await playerIdentitySubs(
            universeWith('Starbridge'), 'nova:132', PROFILE);
        expect(subs.playerName).toBe('Matt');
        expect(subs.playerNickname).toBe('Hawkeye');
        expect(subs.playerShipType).toBe('Starbridge');
        expect(subs.playerShipName).toBe('Starbridge 525');
    });

    it('leaves ship tags undefined when the hull is unknown, so the '
        + 'wildcards fall back to their generic defaults', async () => {
        const subs = await playerIdentitySubs(
            universeWith(undefined), 'nova:132', PROFILE);
        expect(subs.playerShipType).toBeUndefined();
        expect(subs.playerShipName).toBeUndefined();
        expect(expandMissionText('<PSN>', subs)).toBe('your ship');
    });

    it('expands the tags in mission text, <PNN> preferring the nickname '
        + 'and falling back to the full name', async () => {
        const subs = await playerIdentitySubs(
            universeWith('Starbridge'), 'nova:132', PROFILE);
        expect(expandMissionText(
            'Are you <PN> ("<PNN>"), Captain of the <PSN>?', subs))
            .toBe('Are you Matt ("Hawkeye"), Captain of the Starbridge 525?');
        const noNick = await playerIdentitySubs(universeWith('Shuttle'),
            'nova:128', { ...PROFILE, nickname: '' });
        expect(expandMissionText('<PNN>', noNick)).toBe('Matt');
    });

    it('defaults the ship number to 1 without a profile ship number',
        async () => {
            const subs = await playerIdentitySubs(universeWith('Shuttle'),
                'nova:128', { ...PROFILE, shipNumber: undefined });
            expect(subs.playerShipName).toBe('Shuttle 1');
        });
});
