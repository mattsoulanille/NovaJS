import 'jasmine';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';
import { MissionSession } from '../../spaceport/mission_session.js';
import { MissionUniverse } from '../../spaceport/mission_universe.js';
import { GameDateComponent, CreditsComponent } from '../player/index.js';
import { ControlBitsComponent } from '../ncb/index.js';
import { makeShip } from '../ship/index.js';
import { applyOutcomeReputation } from './mission_payval.js';

/**
 * A mission's CompReward against the stock scenario, through the real
 * MissionSession wiring (its machinery's legal geography is what reaches
 * the allies' and enemies' systems).
 *
 * Ground truth: the original, completing stock "Rescue Raczak" (mïsn
 * nova:394, CompGovt 144 Wild Geese, CompReward 10), changed the record
 * +10 in the 4 systems Wild Geese owns, +5 in 173 others and -5 in 121
 * (docs/reference_experiments.md, "Boarding a rescue ship: stock "Rescue
 * Raczak" (nova:394), wave 13", finding 4; the rule is "A14 spread, wave
 * 14", finding 5). Records are per system (ruling #380), so the spec
 * counts each stock system's change over what it read before.
 */
describe('CompReward against stock data (Rescue Raczak)', () => {
    async function sessionAndRaczak() {
        const gameData = await getIntegrationGameData();
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        const start = await gameData.data.PlayerStart.get('nova:128');
        const entity = makeShip(await gameData.data.Ship.get(start.ship));
        entity.components.set(GameDateComponent, { ...start.date });
        entity.components.set(CreditsComponent, { credits: start.credits });
        entity.components.set(ControlBitsComponent, new Set());
        const dockedAt = universe.stellarCandidates.find(
            s => !s.uninhabited && s.canLand)!;
        const session = await MissionSession.create(
            entity, gameData, universe, dockedAt.id);
        const raczak = universe.getMission('nova:394')!;
        const geography = universe.legalGeography();
        /** Every system's change, over what an absent entry reads. */
        const changes = (records: ReadonlyMap<string, number>) =>
            new Map(geography.systemIds.flatMap(id => {
                const change = geography.recordIn(records, id)
                    - geography.recordIn(new Map(), id);
                return change === 0 ? [] : [[id, change] as const];
            }));
        /** The systems a govt owns. */
        const ownedBy = (govt: string) => geography.systemIds.filter(
            id => geography.system(id)!.govt === govt);
        return { gameData, session, raczak, changes, ownedBy };
    }

    it('reads Rescue Raczak as CompGovt 144, CompReward 10', async () => {
        const { raczak } = await sessionAndRaczak();
        expect(raczak.name).toContain('Rescue Raczak');
        expect(raczak.compGovt).toBe(144);
        expect(raczak.compReward).toBe(10);
        expect(raczak.flags.lose5xCompRewardOnAbort).toBe(false);
    });

    it('changes the records the original changed on completion: '
        + '4 systems +10, 173 +5, 121 -5', async () => {
            const { session, raczak, changes, ownedBy } =
                await sessionAndRaczak();
            const records = session.state.records!;
            expect(records.size).toBe(0);
            applyOutcomeReputation(session.machinery, raczak, 'complete');
            const changed = changes(records);

            const ofGovt = (govt: string) => new Set(
                ownedBy(govt).map(id => changed.get(id)));
            expect(ofGovt('nova:144')).toEqual(new Set([10]));
            // A one-way ally each way (Wild Geese lists the Federation's
            // class; Polaris lists Wild Geese's), a one-way enemy each way
            // (Wild Geese lists the Aurorans'; Family Vella lists Wild
            // Geese's), and the xenophobic Pirates.
            expect(ofGovt('nova:128')).toEqual(new Set([5]));
            expect(ofGovt('nova:130')).toEqual(new Set([5]));
            expect(ofGovt('nova:129')).toEqual(new Set([-5]));
            expect(ofGovt('nova:133')).toEqual(new Set([-5]));
            expect(ofGovt('nova:137')).toEqual(new Set([-5]));

            const counts = new Map<number, number>();
            for (const change of changed.values()) {
                counts.set(change, (counts.get(change) ?? 0) + 1);
            }
            expect(Object.fromEntries(counts))
                .toEqual({ 10: 4, 5: 173, [-5]: 121 });
        });

    it('keeps a failure\'s -R/2 with the CompGovt', async () => {
        const { session, raczak, changes, ownedBy } = await sessionAndRaczak();
        applyOutcomeReputation(session.machinery, raczak, 'fail');
        expect(changes(session.state.records!)).toEqual(new Map(
            ownedBy('nova:144').map(id => [id, -5] as const)));
    });

    it('keeps the 0x0040 abort\'s -5R with the CompGovt', async () => {
        const { session, raczak, changes, ownedBy } = await sessionAndRaczak();
        const flagged = {
            ...raczak,
            flags: { ...raczak.flags, lose5xCompRewardOnAbort: true },
        };
        applyOutcomeReputation(session.machinery, flagged, 'abort');
        expect(changes(session.state.records!)).toEqual(new Map(
            ownedBy('nova:144').map(id => [id, -50] as const)));
    });
});
