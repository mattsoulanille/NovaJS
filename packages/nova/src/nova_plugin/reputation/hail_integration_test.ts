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

    it('silences the Hyperioid (ruling #297, 2026-10-03: "Hyperioid, too"), '
        + 'and leaves Vell-os ships and shuttles talking', async () => {
            const gameData = await getIntegrationGameData();
            // düde 147 flies the Hyperioid (nova:171) under gövt 148, which
            // carries Flags 0x0400 "Can't hail ships of this govt"; the class
            // inherits it too, through its attributes govt.
            const hyperioidGovt = await gameData.data.Govt.get('nova:148');
            const hyperioid = await gameData.data.Ship.get('nova:171');
            const dude = await gameData.data.Dude.get('nova:147');
            expect(dude.govt).toBe('nova:148');
            expect(dude.ships.map(choice => choice.id))
                .toContain('nova:171');
            expect(hyperioidGovt.flags.cantBeHailed).toBeTrue();
            expect(hyperioid.inheritedCantBeHailed).toBeTrue();
            expect(shipAnswersHails(hyperioidGovt, hyperioid)).toBeFalse();
            expect(shipAnswersHails(undefined, hyperioid)).toBeFalse();
            // Crew 0 is NOT the rule: the Vell-os Dart/Arrow/Javelin fly
            // crewless under gövt 136/165 (Roadside Assistance) and answer,
            // with the button.
            for (const govtId of ['nova:136', 'nova:165']) {
                const vellos = await gameData.data.Govt.get(govtId);
                for (const shipId of ['nova:173', 'nova:174', 'nova:175']) {
                    const ship = await gameData.data.Ship.get(shipId);
                    expect(ship.crew).toBe(0);
                    expect(shipAnswersHails(vellos, ship))
                        .withContext(`${govtId} flying ${shipId}`).toBeTrue();
                    expect(canRequestAssistance({ govt: vellos, ship }))
                        .toBeTrue();
                }
            }
            // A Shuttle answers under a trader govt (157) or none at all.
            const shuttle = await gameData.data.Ship.get('nova:128');
            const civvies = await gameData.data.Govt.get('nova:157');
            expect(shipAnswersHails(civvies, shuttle)).toBeTrue();
            expect(shipAnswersHails(undefined, shuttle)).toBeTrue();
        });

    it('shows the shïp CommName in the comm box ("Aur Carrier", ruling #297 '
        + '"Let\'s match the original")', async () => {
            const gameData = await getIntegrationGameData();
            const carrier = await gameData.data.Ship.get('nova:153');
            expect(carrier.name).toBe('Aurora Carrier');
            expect(carrier.commName).toBe('Aur Carrier');
            const viper = await gameData.data.Ship.get('nova:144');
            expect(viper.commName).toBe('Fed Viper');
        });

    it('lets the Wraith (Adult) nova:185 inherit Can\'t-hail from gövt 159',
        async () => {
            const gameData = await getIntegrationGameData();
            const ship = await gameData.data.Ship.get('nova:185');
            expect(ship.inheritedCantBeHailed).toBeTrue();
            // Silent under ANY government a plug-in might fly it with.
            expect(shipAnswersHails(undefined, ship)).toBeFalse();
        });

    it('opens the Dechtakar channel (gövt 142/189, comm "Dechtakar") without '
        + 'Request Assistance', async () => {
        const gameData = await getIntegrationGameData();
        // The Aur Carrier of the ruling's screenshot.
        const carrier = await gameData.data.Ship.get('nova:153');
        // Both Rimerta govts: Flags2 0x0027 = 0x0001 (no assist / mercy
        // button) + 0x0002 + 0x0004 + 0x0020 — no 0x0008, no Flags 0x0400.
        // So the channel opens and has no button: "not Dechtakar" in the
        // 2026-10-03 ruling, "some don't have a 'request assistance' button
        // (Polaris (often) and Dechtakar)" in the first.
        for (const govtId of ['nova:142', 'nova:189']) {
            const govt = await gameData.data.Govt.get(govtId);
            expect(govt.commName).toBe('Dechtakar');
            expect(govt.flags.cantBeHailed).toBeFalse();
            expect(govt.flags2.noAssistOrMercy).toBeTrue();
            expect(govt.flags2.noDistressMessages).toBeFalse();
            expect(shipAnswersHails(govt, carrier)).toBeTrue();
            expect(canRequestAssistance({ govt, ship: carrier })).toBeFalse();
        }
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
                govt: nilkemorya,
            })).toBeFalse();
            expect(canRequestAssistance({
                govt: polaris,
            })).toBeTrue();
        });
});
