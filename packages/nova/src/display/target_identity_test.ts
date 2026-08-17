import 'jasmine';
import { targetIdentity } from './target_identity.js';

/**
 * The rule the target pane and the hail dialog share for deciding what
 * to call the ship you are pointed at. The bug this pins: a mission's
 * special ship carried its mïsn-given name only on Entity.name, which
 * is a debugging label and never crosses the serializer, so the panels
 * showed the bare ship class and a bounty briefing that said "destroy
 * the Doomblade" left you staring at a "Thunderhead".
 */
describe('targetIdentity', () => {
    const CLASS = {
        shipClass: 'Thunderhead',
        shipSubtitle: 'Auroran Fighter',
    };

    it('falls back to the ship class and its subtitle', () => {
        expect(targetIdentity(CLASS)).toEqual({
            name: 'Thunderhead',
            subtitle: 'Auroran Fighter',
            named: false,
        });
    });

    it("shows a mission special ship's mïsn-given name and subtitle in "
        + 'place of the ship class', () => {
            expect(targetIdentity({
                ...CLASS,
                missionName: 'Doomblade',
                missionSubtitle: 'Bounty Target',
            })).toEqual({
                name: 'Doomblade',
                subtitle: 'Bounty Target',
                named: true,
            });
        });

    it('takes name and subtitle from their lists independently', () => {
        // The stock bounties (mïsn nova:140/257-261) set ShipNameID and
        // no ShipSubtitle, so the class's own subtitle stays.
        expect(targetIdentity({ ...CLASS, missionName: 'Doomblade' }))
            .toEqual({
                name: 'Doomblade',
                subtitle: 'Auroran Fighter',
                named: true,
            });
        // mïsn nova:685 ("Assassinate Krane") is the mirror image:
        // ShipNameID -1, ShipSubtitle naming the target "Krane".
        expect(targetIdentity({ ...CLASS, missionSubtitle: 'Krane' }))
            .toEqual({
                name: 'Thunderhead',
                subtitle: 'Krane',
                named: false,
            });
    });

    it('lets a përs outrank the mission that replaced it', () => {
        // përs Flags 0x0040 replaces the offering hull with the
        // mission's special ship, so both components can sit on one
        // entity. The person is still the person.
        expect(targetIdentity({
            ...CLASS,
            persName: 'Krane',
            persSubtitle: 'Auroran Renegade',
            missionName: 'Doomblade',
            missionSubtitle: 'Bounty Target',
        })).toEqual({
            name: 'Krane',
            subtitle: 'Auroran Renegade',
            named: true,
        });
    });

    it('ignores an empty përs subtitle (the "no subtitle" encoding)',
        () => {
            expect(targetIdentity({
                ...CLASS, persName: 'Krane', persSubtitle: '',
                missionSubtitle: 'Bounty Target',
            }).subtitle).toBe('Bounty Target');
        });
});
