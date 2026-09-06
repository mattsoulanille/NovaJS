import 'jasmine';
import { RankData } from 'novadatainterface/rank_data';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';
import { novaDataInstalled, requireNovaData } from '../../test_support/nova_data_gate.js';
import { parseNCBSet } from './ncb.js';
import {
    ranksSuppressAggression, suppressAggressionGovts,
} from './rank_logic.js';

/**
 * The ränk resources against the REAL Nova game data — the mechanism behind
 * the locked hypergate network, pinned to what the shipped game contains.
 *
 * The whole chain, in stock data:
 *   mïsn nova:898 "Deliver New Hypergate Code;Sigma4" OnAccept `k147 S899
 *   S900`  ->  ränk nova:147 "Have Access to Hypergate System" (affilGovt
 *   nova:183, Flags 0x0208)  ->  0x0200 "All planets of the affiliated
 *   government will let the player land ... regardless of their MinStatus
 *   field"  ->  the 19 spöbs HG-V01..HG-Koria (gövt nova:183, MinStatus
 *   32767) open.
 * The alternate grant is mïsn nova:608 "Steal Hypergate Codes;Rebel
 * Sideline" OnSuccess `b149 k147`.
 */
describe('ränk resources against real Nova data', () => {
    let ranks: RankData[];
    let byId: Map<string, RankData>;
    beforeEach(requireNovaData);
    beforeAll(async () => {
        if (!novaDataInstalled()) return; // each spec pends instead
        const gameData = await getIntegrationGameData();
        const ids = await gameData.ids;
        ranks = await Promise.all(
            ids.Rank.map(id => gameData.data.Rank.get(id)));
        byId = new Map(ranks.map(r => [r.id, r]));
    }, 120_000);

    it('parses all 31 stock ränks', () => {
        expect(ranks.length).toBe(31);
        // Contiguous, nova:128 .. nova:158.
        expect(ranks.map(r => r.id).sort()).toContain('nova:128');
        expect(byId.has('nova:158')).toBeTrue();
    });

    it('parses ränk nova:147 "Have Access to Hypergate System" exactly',
        () => {
            const rank = byId.get('nova:147')!;
            expect(rank.name).toBe('Have Access to Hypergate System');
            expect(rank.affilGovt).toBe('nova:183');
            expect(rank.flags).toBe(0x0208);
            expect(rank.rankFlags.canAlwaysLandOnGovtStellars).toBeTrue();
            expect(rank.rankFlags.permanent).toBeTrue();
            // 0x0208 and nothing else.
            expect(rank.rankFlags.govtShipsWontAttack).toBeFalse();
            expect(rank.rankFlags.canRequestBattleAssistance).toBeFalse();
            expect(rank.rankFlags.freeRefuelAndRepair).toBeFalse();
            expect(rank.rankFlags.dropOtherRanksWhenActivated).toBeFalse();
            expect(rank.weight).toBe(1);
            expect(rank.shortName).toBe('Hypergate Access');
        });

    it('finds the hypergate rank granted by the Sigma4 mission and by the '
        + 'rebel sideline', async () => {
            const gameData = await getIntegrationGameData();
            const sigma4 = await gameData.data.Mission.get('nova:898');
            expect(sigma4.name).toBe('Deliver New Hypergate Code;Sigma4');
            expect(sigma4.onAccept).toBe('k147 S899 S900');
            expect(parseNCBSet(sigma4.onAccept)).toContain(
                { type: 'activateRank', id: 147 } as never);

            const steal = await gameData.data.Mission.get('nova:608');
            expect(steal.name).toBe('Steal Hypergate Codes;Rebel Sideline');
            expect(steal.onSuccess).toBe('b149 k147');
            expect(parseNCBSet(steal.onSuccess)).toContain(
                { type: 'activateRank', id: 147 } as never);
        });

    it('is the ONLY stock rank affiliated with gövt nova:183, so nothing '
        + 'else can open the network', () => {
            const hypergateRanks =
                ranks.filter(r => r.affilGovt === 'nova:183');
            expect(hypergateRanks.map(r => r.id)).toEqual(['nova:147']);
        });

    it('never sends a stock mission to a MinStatus-32767 gate, so the rank '
        + 'is the only stock way in', async () => {
            // The mission-destination override would also open a gate. No
            // stock mission uses it: Sigma4 itself has travelStel -1 and
            // returnStel nova:421, and grants the rank on ACCEPT, before the
            // player ever needs a gate.
            const gameData = await getIntegrationGameData();
            const ids = await gameData.ids;
            const gateIds = new Set<string>();
            for (const id of ids.Planet) {
                const planet = await gameData.data.Planet.get(id);
                if (planet.minStatus === 32767) {
                    gateIds.add(id);
                }
            }
            expect(gateIds.size).toBe(19);
            const offenders: string[] = [];
            for (const id of ids.Mission) {
                const mission = await gameData.data.Mission.get(id);
                for (const stel of
                    [mission.travelStelId, mission.returnStelId]) {
                    if (stel && gateIds.has(stel)) {
                        offenders.push(`${id} -> ${stel}`);
                    }
                }
            }
            expect(offenders).toEqual([]);

            const sigma4 = await gameData.data.Mission.get('nova:898');
            expect(sigma4.travelStelId).toBeNull();
            expect(sigma4.returnStelId).toBe('nova:421');
        }, 120_000);

    it('reads the stock Flags the way the Bible describes them', () => {
        // Nearly every stock rank is PERMANENT (0x0008) — 0xb08, 0xd08 and
        // 0xf08 all contain it — which is why the cascades almost never fire
        // in stock play and why dropping one needs an explicit Lxxx.
        const permanent = ranks.filter(r => r.rankFlags.permanent);
        expect(permanent.length).toBeGreaterThan(15);

        // The Wild Geese knighthood: the richest stock rank.
        const knight = byId.get('nova:138')!;
        expect(knight.name).toBe('Knight of Red Branch; Wild Geese 1');
        expect(knight.affilGovt).toBe('nova:144');
        expect(knight.weight).toBe(20);
        expect(knight.salary).toBe(750);
        expect(knight.priceMod).toBe(50);
        expect(knight.convName).toBe('Sir Knight');
        expect(knight.shortName).toBe('Sir');
        expect(knight.rankFlags.canAlwaysLandOnGovtStellars).toBeTrue();
        expect(knight.rankFlags.freeRefuelAndRepair).toBeTrue();
        expect(knight.rankFlags.canRequestBattleAssistance).toBeTrue();

        // The capped salary the Bible's SalaryCap describes: the second
        // pirate guild-master pays 350/day until you hold 350,000 credits.
        const pirate = byId.get('nova:144')!;
        expect(pirate.salary).toBe(350);
        expect(pirate.salaryCap).toBe(350_000);

        // Two stock ranks are pure honours with NO affiliated government.
        const unaffiliated = ranks.filter(r => r.affilGovt === null);
        expect(unaffiliated.map(r => r.id).sort())
            .toEqual(['nova:151', 'nova:152']);
    });

    it('pins the stock 0x0100 ranks the simulation bakes into synced state',
        () => {
            // ränk Flags 0x0100: "Ships of the affiliated government will
            // not automatically attack the player when he has this rank."
            // This is the ONE rank privilege the simulation itself reads,
            // and it cannot read ränk data (the sim worker's cache is never
            // warmed with Rank), so it is resolved at grant time into
            // AggressionSuppressGovtsComponent — see rank_logic.ts's
            // suppressAggressionGovts, which is exercised here against the
            // real resources.
            const suppressing = ranks
                .filter(r => r.rankFlags.govtShipsWontAttack)
                .map(r => r.id).sort();
            // Twenty-eight of the thirty-one stock ranks carry it: the six
            // duel protectors, the two pirate guild-masterships, and every
            // faction-string rank that makes its government stop shooting.
            // The three that do NOT are nova:147 (hypergate access, landing
            // rights only) and the two unaffiliated honours nova:151/152.
            expect(suppressing.length).toBe(28);
            expect(ranks.filter(r => !r.rankFlags.govtShipsWontAttack)
                .map(r => r.id).sort())
                .toEqual(['nova:147', 'nova:151', 'nova:152']);

            // The six "Duel protector" ranks are the purest case — Flags
            // 0x0140 is 0x0100 plus 0x0040, and nothing else.
            const auroranDuel = byId.get('nova:153')!;
            expect(auroranDuel.name).toBe('; Auroran Duel protector');
            expect(auroranDuel.flags).toBe(0x0140);
            expect(auroranDuel.affilGovt).toBe('nova:129');
            expect(auroranDuel.rankFlags.govtShipsWontAttack).toBeTrue();
            expect(auroranDuel.rankFlags.canAlwaysLandOnGovtStellars)
                .toBeFalse();

            // The classic: hold the Pirate Guild-Mastership and the pirates
            // leave you alone (gövt nova:176).
            const guildMaster = byId.get('nova:143')!;
            expect(guildMaster.name).toBe('Pirate Guild-Master; Pirate 1');
            expect(guildMaster.affilGovt).toBe('nova:176');
            expect(guildMaster.rankFlags.govtShipsWontAttack).toBeTrue();

            // The bake, end to end, over the real table: holding both gives
            // exactly those two governments and nothing else.
            const get = (id: string) => byId.get(id);
            const govts = suppressAggressionGovts(
                new Set(['nova:143', 'nova:153']), get);
            expect([...govts].sort()).toEqual(['nova:129', 'nova:176']);
            expect(ranksSuppressAggression(govts, 'nova:176')).toBeTrue();
            expect(ranksSuppressAggression(govts, 'nova:128')).toBeFalse();

            // nova:147, the hypergate rank, is landing rights only: holding
            // it must not stop anybody's warships.
            expect([...suppressAggressionGovts(new Set(['nova:147']), get)])
                .toEqual([]);
        });

    it('carries the rank Contribute the Bible describes, as a decimal '
        + 'string', () => {
            // The two Federation ranks are the only stock ranks that
            // contribute anything.
            const contributing =
                ranks.filter(r => BigInt(r.contribute) !== 0n);
            expect(contributing.map(r => r.id).sort())
                .toEqual(['nova:128', 'nova:129', 'nova:149']);
            expect(byId.get('nova:128')!.contribute)
                .toBe('528280977408');
        });
});
