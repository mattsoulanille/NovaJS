import 'jasmine';
import { getDefaultMissionData, MissionData } from 'novadatainterface/mission_data';
import { MissionContext } from '../nova_plugin/mission_logic.js';
import {
    OfferRolls, offerRollsForSystem, resetOfferRolls, rollOffers,
} from './mission_offers.js';
import { MissionSession } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';

/**
 * ============================================================================
 * AvailRandom is rolled once per SYSTEM VISIT
 * ============================================================================
 *
 * EVN Bible: "Mission randomizing values are recalculated each time you
 * warp into a system." rollOffers used to roll on every call — every
 * board opening, every bar entry — so a player could close and reopen the
 * BBS until a 10% mission turned up. With an OfferRolls map the roll is
 * made once per mission per visit and reused.
 */
describe('rollOffers and the visit\'s AvailRandom rolls', () => {
    function mission(id: string, availRandom: number): MissionData {
        return { ...getDefaultMissionData(), id, name: id, availRandom };
    }

    /** A session stand-in: rollOffers only reads offerContext(). */
    function fakeSession(): MissionSession {
        const ctx: MissionContext = {
            stellar: { id: 'nova:128', govt: null, uninhabited: false,
                canLand: true },
            stellarCandidates: [],
            bits: new Set(),
            shipId: 'nova:128',
            activeMissions: new Map(),
            freeCargoSpace: 10,
            random: () => 0.5,
            getGovt: () => undefined,
            currentDay: 0,
        };
        const session: unknown = { machinery: { offerContext: () => ctx } };
        return session as MissionSession;
    }

    function fakeUniverse(missions: MissionData[]): MissionUniverse {
        return { missions } as unknown as MissionUniverse;
    }

    afterEach(() => resetOfferRolls());

    it('reuses a mission\'s roll for the rest of the visit', () => {
        const universe = fakeUniverse([mission('nova:1', 40)]);
        const session = fakeSession();
        const rolls: OfferRolls = new Map();
        // First call: the roll is made (0.1 -> 10, under 40: offered).
        let draws = [0.1];
        const random = () => draws.shift() ?? 0.99;
        expect(rollOffers(session, universe, 0, rolls, random).length).toBe(1);
        expect(rolls.get('nova:1')).toBeCloseTo(10);
        // Every later call answers from the map, whatever random says.
        draws = [0.99];
        expect(rollOffers(session, universe, 0, rolls, random).length).toBe(1);
        expect(rollOffers(session, universe, 0, rolls, random).length).toBe(1);
    });

    it('never offers a mission whose visit roll missed', () => {
        const universe = fakeUniverse([mission('nova:1', 40)]);
        const rolls: OfferRolls = new Map([['nova:1', 75]]);
        for (let i = 0; i < 5; i++) {
            expect(rollOffers(fakeSession(), universe, 0, rolls, () => 0)
                .length).toBe(0);
        }
    });

    it('does not roll (or record) an always-available mission', () => {
        const universe = fakeUniverse([mission('nova:1', 100)]);
        const rolls: OfferRolls = new Map();
        expect(rollOffers(fakeSession(), universe, 0, rolls, () => 0.99)
            .length).toBe(1);
        expect(rolls.size).toBe(0);
    });

    it('rolls afresh on every call without a map (the përs offer path)',
        () => {
            const universe = fakeUniverse([mission('nova:1', 40)]);
            const draws = [0.1, 0.9];
            const random = () => draws.shift() ?? 0;
            expect(rollOffers(fakeSession(), universe, 0, undefined, random)
                .length).toBe(1);
            expect(rollOffers(fakeSession(), universe, 0, undefined, random)
                .length).toBe(0);
        });

    describe('offerRollsForSystem', () => {
        it('hands out one map per system visit', () => {
            const sol = offerRollsForSystem('nova:128');
            sol.set('nova:1', 5);
            expect(offerRollsForSystem('nova:128')).toBe(sol);
            // Another system: a fresh map; and coming back is a fresh
            // visit again (the rolls are recalculated on warp-in).
            const kane = offerRollsForSystem('nova:129');
            expect(kane).not.toBe(sol);
            expect(kane.size).toBe(0);
            expect(offerRollsForSystem('nova:128').has('nova:1')).toBe(false);
        });

        it('forgets everything on reset', () => {
            offerRollsForSystem('nova:128').set('nova:1', 5);
            resetOfferRolls();
            expect(offerRollsForSystem('nova:128').size).toBe(0);
        });
    });
});
