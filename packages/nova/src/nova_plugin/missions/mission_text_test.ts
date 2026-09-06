import 'jasmine';
import { expandMissionText } from './mission_text.js';

/**
 * The <SN> wildcard, per the EVN Bible's mission-wildcard table:
 * "<SN>  Special ship name (Note: Nova will screw up if you use this
 * in the initial mission description, as it doesn't pick the special
 * ship names until you actually accept the mission.)"
 *
 * The texts below are the real stock dëscs of mïsn nova:258
 * ("25000 Credit Bounty;Bounty Hunter1a"), whose ShipNameID points at
 * STR# nova:25000 "Auroran Warships" — ["Dechanik", "Blood Honor",
 * "Frunch'eck", "Talons of Integrity", "Warrior's Pride", "Doomblade",
 * "Warrior's Path", "Gjinchar", "Swordsman's Song", "Ytrack"].
 */
describe('expandMissionText <SN>', () => {
    const BRIEF = 'In the last few weeks a rogue Auroran ship, the <SN>, '
        + 'has slipped past Federation border patrols and has been '
        + 'harassing ships in this and the surrounding systems.  Track it '
        + 'down and destroy it before heading back to Sol to collect your '
        + 'bounty (less the ten percent Guild fee) from the Guild offices '
        + 'on <RST>.';
    const QUICK_BRIEF = 'Locate and destroy the <SN> and then collect your '
        + 'bounty at the Guild offices on the Kane Band.';

    it('expands the accepted mission\'s special ship name', () => {
        expect(expandMissionText(QUICK_BRIEF,
            { specialShipName: 'Doomblade' }))
            .toBe('Locate and destroy the Doomblade and then collect your '
                + 'bounty at the Guild offices on the Kane Band.');
    });

    it('expands every occurrence, alongside the other wildcards', () => {
        const text = expandMissionText(BRIEF, {
            specialShipName: 'Blood Honor',
            returnStellar: 'Earth',
        });
        expect(text).toContain('a rogue Auroran ship, the Blood Honor,');
        expect(text).toContain('the Guild offices on Earth.');
        expect(text).not.toContain('<SN>');
    });

    it('falls back to a generic phrase before the mission is accepted '
        + '(the Bible\'s documented broken case)', () => {
        // No name has been picked yet — Nova "screws up" here; NovaJS
        // degrades gracefully instead of printing a raw tag.
        const text = expandMissionText(QUICK_BRIEF, {});
        expect(text).toBe('Locate and destroy the unknown ship and then '
            + 'collect your bounty at the Guild offices on the Kane Band.');
        expect(text).not.toContain('<SN>');
    });

    it('falls back the same way for an accepted mission with no '
        + 'ShipNameID list', () => {
        // mïsn nova:685 ("Assassinate Krane") uses <SN> in its QuickBrief
        // but sets ShipNameID -1 (only a ShipSubtitle STR#, nova:25024),
        // so the original has nothing to substitute either.
        expect(expandMissionText(
            'Assassinate Krane as she flies through the Wolf 359 system '
            + 'in the <SN>.', {}))
            .toBe('Assassinate Krane as she flies through the Wolf 359 '
                + 'system in the unknown ship.');
    });
});

/**
 * The government-scoped rank tags — "<PRKnnn> Same as <PRK>, but only for
 * ranks affiliated with government ID nnn" and its <SRKnnn> sibling — and
 * "<RRK> The full name of the most recently activated rank resource"
 * (EVN Bible). Stock nova:468 "Scout Polaris Space;Fed37" is the user:
 * its BriefText grants "the diplomatic rank of '<PRK128>'".
 */
describe('expandMissionText <PRKnnn> / <SRKnnn> / <RRK> (#110)', () => {
    const BRIEF = '"In that case," smiles Frandall slightly sardonically, '
        + '"you are hereby given the diplomatic rank of \'<PRK128>\', '
        + 'with all the privileges and responsibilities inherent in that '
        + 'position.';
    const byGovt = new Map([[128, {
        convName: 'Federation Ambassador', shortName: 'Ambassador',
    }]]);
    const subs = {
        rankName: 'Rebel Colonel', rankShortName: 'Colonel',
        rankForGovt: (n: number) => byGovt.get(n),
        recentRankName: 'Federation Diplomatic Rank',
    };

    it('expands <PRKnnn> / <SRKnnn> to THAT govt\'s rank, not the '
        + 'highest-weight one', () => {
            const text = expandMissionText(BRIEF, subs);
            expect(text).toContain(
                'the diplomatic rank of \'Federation Ambassador\'');
            expect(text).not.toContain('<PRK');
            expect(expandMissionText('<SRK128> <PRK> <SRK>', subs))
                .toBe('Ambassador Rebel Colonel Colonel');
        });

    it('falls back to "captain" for a govt the player holds no rank '
        + 'with, like <PRK>', () => {
            expect(expandMissionText('<PRK141>, <SRK141>', subs))
                .toBe('captain, captain');
            expect(expandMissionText('<PRK128>', {})).toBe('captain');
        });

    it('expands <RRK> to the most recently activated rank\'s name, else '
        + '"captain"', () => {
            expect(expandMissionText('Congratulations, <RRK>.', subs))
                .toBe('Congratulations, Federation Diplomatic Rank.');
            expect(expandMissionText('Congratulations, <RRK>.', {}))
                .toBe('Congratulations, captain.');
        });
});
