import 'jasmine';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';
import { canRequestAssistance, shipAnswersHails } from './hail.js';

/**
 * Matthew's ruling on #297, checked against the REAL Nova data: "Some ships
 * don't respond to hails at all (no hailing channel appears), like the krypt
 * pod and wraith, and some don't have a 'request assistance' button (Polaris
 * (often) and Dechtakar)."
 *
 * The flags are read through the parser, the same path the game uses, and
 * the ids are the stock data's (see hail.ts's shipAnswersHails for why the
 * krypt and the wraith are silent although only one Wraith govt carries
 * gövt 0x0400).
 */
describe('hail answer traits against real Nova data (ruling #297)', () => {
    it('silences every stock krypt and wraith düde/class pairing',
        async () => {
            const gameData = await getIntegrationGameData();
            // düde 146/190 fly the Krypt Pod (nova:176) under gövt 140/163;
            // düde 143/144/187 fly Wraiths nova:168-170 under 138/139; düde
            // 186 flies Wraith (Adult) nova:185 under 159.
            const pairings: Array<[string, string]> = [
                ['nova:140', 'nova:176'], ['nova:163', 'nova:176'],
                ['nova:138', 'nova:168'], ['nova:139', 'nova:169'],
                ['nova:139', 'nova:168'], ['nova:159', 'nova:185'],
            ];
            for (const [govtId, shipId] of pairings) {
                const govt = await gameData.data.Govt.get(govtId);
                const ship = await gameData.data.Ship.get(shipId);
                expect(shipAnswersHails(govt, ship))
                    .withContext(`${govtId} flying ${shipId} (${ship.name})`)
                    .toBeFalse();
            }
        });

    it('lets the Wraith (Adult) nova:185 inherit Can\'t-hail from gövt 159',
        async () => {
            const gameData = await getIntegrationGameData();
            const ship = await gameData.data.Ship.get('nova:185');
            expect(ship.inheritedCantBeHailed).toBeTrue();
            // Silent under ANY government a plug-in might fly it with.
            expect(shipAnswersHails(undefined, ship)).toBeFalse();
        });

    it('opens the Dechtakar channel (gövt 142, comm "Dechtakar") without '
        + 'Request Assistance', async () => {
        const gameData = await getIntegrationGameData();
        const govt = await gameData.data.Govt.get('nova:142');
        expect(govt.commName).toBe('Dechtakar');
        // The Aur Carrier of the ruling's screenshot.
        const carrier = await gameData.data.Ship.get('nova:153');
        expect(shipAnswersHails(govt, carrier)).toBeTrue();
        expect(canRequestAssistance({
            disposition: 'neutral', govt, ship: carrier,
        })).toBeFalse();
    });

    it('gives some "Polaris" no Request Assistance and some the button',
        async () => {
            const gameData = await getIntegrationGameData();
            // Both answer as "Polaris": the Nil'kemorya (147) carry gövt
            // Flags2 0x0001, the Polaris proper (130) do not.
            const nilkemorya = await gameData.data.Govt.get('nova:147');
            const polaris = await gameData.data.Govt.get('nova:130');
            expect(nilkemorya.commName).toBe('Polaris');
            expect(polaris.commName).toBe('Polaris');
            expect(shipAnswersHails(nilkemorya)).toBeTrue();
            expect(canRequestAssistance({
                disposition: 'neutral', govt: nilkemorya,
            })).toBeFalse();
            expect(canRequestAssistance({
                disposition: 'neutral', govt: polaris,
            })).toBeTrue();
        });
});
