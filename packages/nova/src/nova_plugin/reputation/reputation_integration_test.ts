import 'jasmine';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';
import {
    applyCrime,
    availRatingOk,
    availRecordOk,
    crimePenalty,
    decodePayVal,
    DEFAULT_BOARD_PENALTY,
    DEFAULT_DISABLE_PENALTY,
    DEFAULT_KILL_PENALTY,
    LEGAL_STATUS_EVIL_TIERS,
    LEGAL_STATUS_GOOD_TIERS,
    LEGAL_STATUS_NO_RECORD,
    legalStatusInSystem,
    legalStatusName,
    LegalRecords,
    recordHostile,
} from './reputation.js';
import { GovtData } from 'novadatainterface/govt_data';
import { MissionSession } from '../../spaceport/mission_session.js';
import { MissionUniverse } from '../../spaceport/mission_universe.js';
import { acceptOffer } from '../missions/mission_logic.js';
import { makeShip } from '../ship/make_ship.js';
import { dayNumber } from '../player/calendar.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from '../player/player_state_plugin.js';
import { ControlBitsComponent } from '../ncb/ncb_plugin.js';

/**
 * Reputation against the REAL Nova game data: pins the stock govts'
 * penalty landscape, the ally/enemy propagation across the real
 * political map, and real missions' AvailRecord/AvailRating/PayVal
 * encodings.
 *
 * NOTE: these tests parse base "Nova Files" only. An earlier version
 * of this suite claimed stock gövts leave every penalty field zero —
 * that was an artifact of a plug-in overwriting the stock gövts. Real
 * stock data sets them: 57 of the 68 stock gövts carry a non-zero
 * KillPenalty. The DEFAULT_* engine fallbacks still matter for the 11
 * that leave them at zero (pinned below).
 */
describe('reputation against real Nova data', () => {
    async function allGovts():
        Promise<(readonly [string, GovtData])[]> {
        const gameData = await getIntegrationGameData();
        const ids = [...(await gameData.ids).Govt]
            .filter(id => id.startsWith('nova:')).sort();
        return Promise.all(ids.map(async id =>
            [id, await gameData.data.Govt.get(id)] as const));
    }

    it('pins the stock Federation gövt penalty fields', async () => {
        const gameData = await getIntegrationGameData();
        const fed = await gameData.data.Govt.get('nova:128');
        expect(fed.killPenalty).toBe(5);
        expect(fed.disablePenalty).toBe(1);
        expect(fed.boardPenalty).toBe(2);
        expect(fed.crimeTol).toBe(6);
        // Set fields are used as written, not replaced by defaults.
        expect(crimePenalty(fed, 'kill')).toBe(5);
        expect(crimePenalty(fed, 'disable')).toBe(1);
        expect(crimePenalty(fed, 'board')).toBe(2);
    });

    it('most stock govts set their own penalties', async () => {
        const govts = await allGovts();
        expect(govts.length).toBe(68);
        const withKillPenalty =
            govts.filter(([, g]) => g.killPenalty !== 0);
        expect(withKillPenalty.length).toBe(57);
        // The Vell-os are the harshest in stock data.
        const vellos = govts.find(([id]) => id === 'nova:136')![1];
        expect(vellos.killPenalty).toBe(40);
    });

    it('falls back to the engine defaults for the govts that leave '
        + 'their fields zero', async () => {
            const gameData = await getIntegrationGameData();
            // nova:171 (Spanner) is one of the 11 stock govts with no
            // penalties of its own, so the DEFAULT_* constants apply.
            const spanner = await gameData.data.Govt.get('nova:171');
            expect(spanner.name).toBe('Spanner');
            expect(spanner.killPenalty).toBe(0);
            expect(spanner.disablePenalty).toBe(0);
            expect(spanner.boardPenalty).toBe(0);
            expect(crimePenalty(spanner, 'kill')).toBe(DEFAULT_KILL_PENALTY);
            expect(crimePenalty(spanner, 'disable'))
                .toBe(DEFAULT_DISABLE_PENALTY);
            expect(crimePenalty(spanner, 'board'))
                .toBe(DEFAULT_BOARD_PENALTY);
        });

    it('charges nothing for the derelict Wraiths, whose fields are -1 (#108)',
        async () => {
            const gameData = await getIntegrationGameData();
            const wraith = await gameData.data.Govt.get('nova:159');
            expect(wraith.name).toBe('Wraith');
            expect(wraith.flags.startsDisabled).toBe(true);
            expect(wraith.killPenalty).toBe(-1);
            expect(wraith.disablePenalty).toBe(-1);
            expect(wraith.boardPenalty).toBe(-1);
            expect(crimePenalty(wraith, 'kill')).toBe(0);
            // ...while the living Wraiths charge as written.
            const living = await gameData.data.Govt.get('nova:138');
            expect(living.name).toBe('Wraith');
            expect(crimePenalty(living, 'kill')).toBe(16);
        });

    it('names legal statuses with the stock STR# 134 strings (#119)',
        async () => {
            const gameData = await getIntegrationGameData();
            const { strings } = await gameData.data.StringTable.get('nova:134');
            // Appendix II's two ladders, laid out in the resource as
            // "No Record" x2, the eight evil steps, the six good steps,
            // then the two domination titles.
            expect(strings[0]).toBe(LEGAL_STATUS_NO_RECORD);
            expect(strings.slice(2, 10))
                .toEqual(LEGAL_STATUS_EVIL_TIERS.map(([, name]) => name));
            expect(strings.slice(10, 16))
                .toEqual(LEGAL_STATUS_GOOD_TIERS.map(([, name]) => name));
            // And the scale is the govt's own CrimeTol: a record of -15
            // is 2.5 tolerances against the Federation's 6 (a Minor
            // Offender) but 5 against the Wild Geese's 3 (an Offender).
            const fed = await gameData.data.Govt.get('nova:128');
            expect(fed.crimeTol).toBe(6);
            expect(legalStatusName(-15, fed.crimeTol)).toBe('Minor Offender');
            const wildGeese = await gameData.data.Govt.get('nova:144');
            expect(wildGeese.crimeTol).toBe(3);
            expect(legalStatusName(-15, wildGeese.crimeTol)).toBe('Offender');
        });

    it('shows a FRESH pilot the same standing on the map and in the p '
        + 'dialog where a stock govt starts them with a record', async () => {
            const gameData = await getIntegrationGameData();
            // Eight stock govts seed a nonzero InitialRec; the Rebellion
            // (nova:147) starts every pilot at -5. The map used to read
            // its missing entry as 0 ("No Record") while the dialog read
            // the InitialRec — one record, two names.
            const rebels = await gameData.data.Govt.get('nova:147');
            expect(rebels.initialRecord).toBe(-5);
            const fed = await gameData.data.Govt.get('nova:128');
            expect(fed.initialRecord).toBe(0);
            const getGovt = (id: string) => gameData.data.Govt.getCached(id);
            const fresh = new Map<string, number>();
            expect(legalStatusInSystem(fresh, 'nova:147', getGovt))
                .toBe(legalStatusName(-5, rebels.crimeTol));
            expect(legalStatusInSystem(fresh, 'nova:147', getGovt))
                .not.toBe(LEGAL_STATUS_NO_RECORD);
            // An independent system is judged by the Federation, with
            // whom a fresh pilot really has no record...
            expect(legalStatusInSystem(fresh, null, getGovt))
                .toBe(LEGAL_STATUS_NO_RECORD);
            // ...and by the Federation's tolerance once they have one.
            expect(legalStatusInSystem(new Map([['nova:128', -15]]), null,
                getGovt)).toBe('Minor Offender');
        });

    it('killing a Federation ship propagates across the real map',
        async () => {
            const govts = await allGovts();
            const fed = govts.find(([id]) => id === 'nova:128')![1];
            const records: LegalRecords = new Map();
            applyCrime(records, fed, 'kill', govts);

            // The Federation's OWN KillPenalty (5), not the engine
            // default — the two happen to be the same number, so pin
            // the source explicitly.
            expect(fed.killPenalty).toBe(5);
            expect(records.get('nova:128')).toBe(-fed.killPenalty);
            // The Bureau (allies include class 1, the Federation's):
            // hates you half as much.
            expect(records.get('nova:153'))
                .toBe(-Math.trunc(fed.killPenalty / 2));
            // The Auroran Empire (enemies include class 1): approves.
            expect(records.get('nova:129'))
                .toBe(Math.trunc(fed.killPenalty / 2));
            // The Polaris have no relation to class 1: indifferent.
            expect(records.has('nova:130')).toBe(false);
        });

    it('two Federation kills cross CrimeTol 6 and turn them hostile',
        async () => {
            const govts = await allGovts();
            const fed = govts.find(([id]) => id === 'nova:128')![1];
            // Stock: KillPenalty 5 against CrimeTol 6, so one kill
            // (-5) is tolerated and the second (-10) is not.
            expect(fed.killPenalty).toBe(5);
            expect(fed.crimeTol).toBe(6);

            const records: LegalRecords = new Map();
            applyCrime(records, fed, 'kill', govts);
            expect(records.get('nova:128')).toBe(-5);
            expect(recordHostile(records.get('nova:128')!, fed.crimeTol))
                .toBe(false);

            applyCrime(records, fed, 'kill', govts);
            expect(records.get('nova:128')).toBe(-10);
            expect(recordHostile(records.get('nova:128')!, fed.crimeTol))
                .toBe(true);
        });

    it('the Vell-os turn hostile on the very first kill (KillPenalty 40 '
        + 'vs CrimeTol 9)', async () => {
            const govts = await allGovts();
            const vellos = govts.find(([id]) => id === 'nova:136')![1];
            expect(vellos.killPenalty).toBe(40);
            expect(vellos.crimeTol).toBe(9);

            const records: LegalRecords = new Map();
            applyCrime(records, vellos, 'kill', govts);
            expect(records.get('nova:136')).toBe(-40);
            expect(recordHostile(records.get('nova:136')!, vellos.crimeTol))
                .toBe(true);
        });

    it("pins 'Transport Mu'Randa' (nova:150): AvailRating 200, "
        + 'CompGovt Polaris', async () => {
        const gameData = await getIntegrationGameData();
        const mission = await gameData.data.Mission.get('nova:150');
        expect(mission.availRating).toBe(200);
        expect(availRatingOk(mission.availRating, 199)).toBe(false);
        expect(availRatingOk(mission.availRating, 200)).toBe(true);
        // Completion rewards standing with the Polaris (govt 130).
        expect(mission.compGovt).toBe(130);
        expect(mission.compReward).toBe(1);
    });

    it("pins 'Take Mu'Hari to Port Kane' (nova:163): AvailRecord 30",
        async () => {
            const gameData = await getIntegrationGameData();
            const mission = await gameData.data.Mission.get('nova:163');
            expect(mission.availRecord).toBe(30);
            expect(availRecordOk(mission.availRecord, 29)).toBe(false);
            expect(availRecordOk(mission.availRecord, 30)).toBe(true);
        });

    it("pins 'Infiltrate the Rebels' (nova:131): PayVal cleans govt 141",
        async () => {
            const gameData = await getIntegrationGameData();
            const mission = await gameData.data.Mission.get('nova:131');
            expect(mission.payVal).toBe(-10141);
            expect(decodePayVal(mission.payVal)).toEqual({
                type: 'cleanRecord', govtResourceId: 141, scope: 'govt',
            });
        });

    it("pins 'Distract Moash House' (nova:196): PayVal cleans allies",
        async () => {
            const gameData = await getIntegrationGameData();
            const mission = await gameData.data.Mission.get('nova:196');
            expect(mission.payVal).toBe(-20131);
            expect(decodePayVal(mission.payVal)).toEqual({
                type: 'cleanRecord', govtResourceId: 131, scope: 'allies',
            });
        });

    /**
     * The "Drop Bear" trap, and the reason auto-abort had to stop testing
     * `payVal > 0`: EVERY stock mission that sets mïsn Flags2 0x0002
     * ("Apply mission Pay on auto-abort") uses it to TAKE, not to pay.
     * There are exactly four, all AvailLoc 3 (main spaceport), all
     * ShipCount 0 so all of them the IMMEDIATE auto-abort:
     *
     *   nova:609/610  "GOTCHA!! Auroran Drop Bear scores again..."
     *                 PayVal -40002 / -40005 — 2% and 5% of your cash,
     *                 plus DatePostInc 14 in hospital.
     *   nova:731      "Exotic Licence Forgery"      PayVal -40050 (50%)
     *   nova:896      "Clean Fed Record"            PayVal -10128
     *
     * Under the old `payVal > 0` test all four took nothing whatsoever.
     */
    it("pins the 'Drop Bear' trap (nova:609): auto-abort takes 2% of cash",
        async () => {
            const gameData = await getIntegrationGameData();
            const mission = await gameData.data.Mission.get('nova:609');
            expect(mission.payVal).toBe(-40002);
            expect(mission.flags.autoAbort).toBe(true);
            expect(mission.flags.applyPayOnAutoAbort).toBe(true);
            // ShipCount 0, so it is the IMMEDIATE auto-abort: everything
            // it does happens the moment it is accepted.
            expect(mission.shipCount).toBe(0);
            expect(mission.datePostInc).toBe(14);
            expect(decodePayVal(mission.payVal))
                .toEqual({ type: 'takePercent', percent: 2 });

            const bigger = await gameData.data.Mission.get('nova:610');
            expect(bigger.payVal).toBe(-40005);
            expect(decodePayVal(bigger.payVal))
                .toEqual({ type: 'takePercent', percent: 5 });
        });

    it('accepting nova:609 really costs the pilot 2% of their credits',
        async () => {
            const gameData = await getIntegrationGameData();
            const universe = MissionUniverse.shared(gameData);
            await universe.load();

            const start = await gameData.data.PlayerStart.get('nova:128');
            const shipData = await gameData.data.Ship.get(start.ship);
            const entity = makeShip(shipData);
            entity.components.set(GameDateComponent, { ...start.date });
            entity.components.set(CreditsComponent, { credits: 25000 });
            entity.components.set(ControlBitsComponent, new Set());

            const session = await MissionSession.create(
                entity, gameData, universe, 'nova:128');
            const mission = universe.getMission('nova:609')!;
            const result = acceptOffer(session.machinery, {
                data: mission, travelPlanet: null, returnPlanet: null,
                cargoType: -1, cargoQty: 0, acceptable: true,
            }, session.outfits);
            expect(result.accepted).toBe(true);
            const events = session.commit();

            // 2% of 25000, and the mission never joins the list.
            expect(entity.components.get(CreditsComponent)!.credits)
                .toBe(24500);
            expect(entity.components.get(MissionsComponent)!.size).toBe(0);
            // Nothing was PAID, so the notice carries no payment...
            const notice = events.find(e => e.type === 'autoAborted');
            expect(notice).toBeDefined();
            expect(notice!.payment).toBeUndefined();
            // ...and DatePostInc 14 still put the pilot in hospital.
            expect(dayNumber(entity.components.get(GameDateComponent)!)
                - dayNumber(start.date)).toBe(14);
        });
});
