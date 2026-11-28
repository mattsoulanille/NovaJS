import 'jasmine';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';
import {
    emptyDescTextContext,
    IS_REGISTERED,
    makeDescTextContext,
    playerGender,
    resolveConditionalBlocks,
} from './desc_text.js';

/**
 * Unit specs for the dësc conditional grammar, derived from the EVN Bible
 * ("The dësc resource" section):
 *
 *   {bXXX "string one" "string two"}   — control bit selects between strings
 *   {G "male" "female"}                — gender selects between strings
 *   {P "paid" "unpaid"}              — registration selects between strings
 *   {!bXXX "if clear" "if set"}     — "!" negates any test
 *
 * A missing second string substitutes nothing when the test is false. What
 * the original does beyond that (other letters, compound tests, malformed
 * blocks) was measured in reference wave 54 and is pinned below; none of it
 * throws.
 */
describe('resolveConditionalBlocks (dësc conditional grammar)', () => {
    it('selects the first string when the bit is set', () => {
        const ctx = makeDescTextContext(new Set([1]));
        expect(resolveConditionalBlocks('a {b1 "great" "lousy"} b', ctx))
            .toBe('a great b');
    });

    it('selects the second string when the bit is clear', () => {
        const ctx = makeDescTextContext(new Set([1]));
        expect(resolveConditionalBlocks('a {b1 "great" "lousy"} b',
            makeDescTextContext(new Set([2]))))
            .toBe('a lousy b');
    });

    it('substitutes nothing when the bit is clear and there is no second '
        + 'string', () => {
        const ctx = makeDescTextContext(new Set());
        expect(resolveConditionalBlocks('a {b7 "only if set"} b', ctx))
            .toBe('a  b');
    });

    it('negative bit index is zero-padded to skip leading-zero bookkeeping', () => {
        // b001 in the Bible example denotes bit 1, not bit 0.
        const set0 = makeDescTextContext(new Set([0]));
        expect(resolveConditionalBlocks('{b001 "one" "zero"}', set0))
            .toBe('zero');
        const set1 = makeDescTextContext(new Set([1]));
        expect(resolveConditionalBlocks('{b001 "one" "zero"}', set1))
            .toBe('one');
    });

    it('negates the test with "!"', () => {
        const ctx = makeDescTextContext(new Set([5]));
        expect(resolveConditionalBlocks('{!b5 "clear" "set"}', ctx))
            .toBe('set');
        expect(resolveConditionalBlocks('{!b9 "clear" "set"}', ctx))
            .toBe('clear');
    });

    it('selects by gender from the pilot context', () => {
        const male = makeDescTextContext(new Set(), 'male');
        const female = makeDescTextContext(new Set(), 'female');
        expect(resolveConditionalBlocks('{G "man" "woman"}', male))
            .toBe('man');
        expect(resolveConditionalBlocks('{G "man" "woman"}', female))
            .toBe('woman');
        expect(resolveConditionalBlocks('{!G "male-negated" "female"}', male))
            .toBe('female');
    });

    it('defaults the pilot to male via makeDescTextContext', () => {
        // No profile / unknown gender is treated as male (ncb default).
        expect(resolveConditionalBlocks('{G "he" "she"}',
            makeDescTextContext(new Set()))).toBe('he');
    });

    it('resolves registration conditionals via the IS_REGISTERED switch', () => {
        expect(IS_REGISTERED).toBe(true);
        expect(resolveConditionalBlocks('{P "paid" "unpaid"}',
            emptyDescTextContext())).toBe('paid');
        // With no registration (if a build ever unset it) the second.
        expect(resolveConditionalBlocks('{P "paid" "unpaid"}',
            { ...emptyDescTextContext(), isRegistered: false })).toBe('unpaid');
    });

    it('handles a bare P with no day count', () => {
        expect(resolveConditionalBlocks('{P "paid" "unpaid"}',
            emptyDescTextContext())).toBe('paid');
    });

    it('handles P with a day count like the stock fighter-bay dëscs', () => {
        expect(resolveConditionalBlocks('{P30 "License" "License, REGISTER!"}',
            emptyDescTextContext())).toBe('License');
    });

    it('honours an escaped quote inside a string', () => {
        expect(resolveConditionalBlocks('{b2 "Dave \\"pipeline\\"" "no"}',
            makeDescTextContext(new Set([2]))))
            .toBe('Dave "pipeline"');
    });

    it('replaces multiple conditionals in one string', () => {
        const male = makeDescTextContext(new Set([1, 3]), 'male');
        expect(resolveConditionalBlocks(
            '{b1 "A" "a"} and {b3 "B" "b"} and {G "C" "c"}', male))
            .toBe('A and B and C');
    });

    it('leaves a nil else-branch to an empty substitution', () => {
        // {bXX "a"} with the bit clear -> "" (nothing).
        expect(resolveConditionalBlocks('x{b4 "yes"}y',
            makeDescTextContext(new Set()))).toBe('xy');
    });

    // The rest of the grammar is the ORIGINAL's, measured in reference
    // wave 54 (desc_text_reference_test.ts replays those runs whole).

    it('tests only the first term: the rest of a compound test is ignored',
        () => {
            const ctx = makeDescTextContext(new Set([1]));
            expect(resolveConditionalBlocks('{b1 & b2 "both" "other"}', ctx))
                .toBe('both');
            expect(resolveConditionalBlocks('{b2 | b1 "either" "neither"}',
                ctx)).toBe('neither');
        });

    it('takes a block\'s test from the next b / g / p, however far on', () => {
        const male = makeDescTextContext(new Set([7]), 'male');
        // o / e / x are not dësc terms: the scan runs on to the b7.
        expect(resolveConditionalBlocks(
            '1[{o188 "Y" "N"}] 2[{e136 "Y" "N"}] 3[{b7 "Y" "N"}] 4[ok]',
            male)).toBe('1[Y] 4[ok]');
        // ...or to a g / p inside a word of prose, whose strings then
        // start at the next quote (here the one closing "x get").
        expect(resolveConditionalBlocks('A{o609 "x get" "y"}B', male))
            .toBe('A B');
    });

    it('ends the text at a block that has no b / g / p after it', () => {
        const ctx = emptyDescTextContext();
        expect(resolveConditionalBlocks('set {1,2,3} of firmware', ctx))
            .toBe('set ');
        expect(resolveConditionalBlocks('a {o188 "Y" "N"} rest', ctx))
            .toBe('a ');
        expect(resolveConditionalBlocks('{', ctx)).toBe('');
        expect(resolveConditionalBlocks('{}', ctx)).toBe('');
    });

    it('makes "!" sticky for the rest of the text', () => {
        const male = makeDescTextContext(new Set(), 'male');
        expect(resolveConditionalBlocks(
            '{G "Y" "N"} {!b0 "Y" "N"} {b0 "Y" "N"} {!G "Y" "N"}', male))
            .toBe('Y Y Y N');
        // A "!" in prose between blocks is not read...
        expect(resolveConditionalBlocks('{b0 "Y" "N"} wow! {b0 "Y" "N"}',
            male)).toBe('N wow! N');
        // ...but one met while a block scans for its letter is.
        expect(resolveConditionalBlocks('{x "Y" "N"} ! {b0 "Y" "N"}', male))
            .toBe('Y');
        // Each text starts un-negated.
        expect(resolveConditionalBlocks('{b0 "Y" "N"}', male)).toBe('N');
    });

    it('reads the bit number from the digits right after the b', () => {
        const ctx = makeDescTextContext(new Set([9351]));
        expect(resolveConditionalBlocks('{b9351x "Y" "N"}', ctx)).toBe('Y');
        expect(resolveConditionalBlocks('{b 9351 "Y" "N"}', ctx)).toBe('N');
        expect(resolveConditionalBlocks('{B9351 "Y" "N"}', ctx)).toBe('Y');
        // Past the 10,000 bits: a clear bit.
        expect(resolveConditionalBlocks('{b10000 "a" "b"}', ctx)).toBe('b');
    });

    it('drops whatever follows the chosen string up to the "}"', () => {
        const male = makeDescTextContext(new Set(), 'male');
        expect(resolveConditionalBlocks('[{G "Y" "N" tail}]', male))
            .toBe('[Y]');
        expect(resolveConditionalBlocks('[{G "Y" "N" "Z"}]', male))
            .toBe('[Y]');
        // False: junk before the second string is skipped...
        expect(resolveConditionalBlocks('[{!G "Y" x "N"}]', male))
            .toBe('[N]');
        // ...but the search for it stops at the block's "}".
        expect(resolveConditionalBlocks('[{b0 "Y"}] [{G "Z" "W"}]', male))
            .toBe('[] [Z]');
    });

    it('runs an unterminated string, or a missing "}", to the end', () => {
        const male = makeDescTextContext(new Set(), 'male');
        expect(resolveConditionalBlocks('E1[{b0 "Y" "N" tail]', male))
            .toBe('E1[N');
        expect(resolveConditionalBlocks('E2[{b0 "Y" "N tail]', male))
            .toBe('E2[N tail]');
        expect(resolveConditionalBlocks('E3[{G "Y tail]', male))
            .toBe('E3[Y tail]');
        // No quote at all after the term: the text ends at the "{".
        expect(resolveConditionalBlocks('E4[{b0 noquote} tail]', male))
            .toBe('E4[');
    });

    it('does not rescan a chosen string, and keeps a stray "}"', () => {
        const male = makeDescTextContext(new Set(), 'male');
        expect(resolveConditionalBlocks('[{G "{b0 \\"Y\\" \\"N\\"}" "x"}]',
            male)).toBe('[{b0 "Y" "N"}]');
        expect(resolveConditionalBlocks('[a } b]', male)).toBe('[a } b]');
    });

    it('playerGender honours the override and defaults to male', () => {
        expect(playerGender('female')).toBe('female');
        expect(playerGender()).toBe('male');
    });
});

describe('dësc conditionals against real Nova data', () => {
    it('expands the gender conditional in stellar dësc 472', async () => {
        const gameData = await getIntegrationGameData();
        const d = await gameData.data.Description.get('nova:472');
        const male = resolveConditionalBlocks(d.text,
            makeDescTextContext(new Set(), 'male'));
        const female = resolveConditionalBlocks(d.text,
            makeDescTextContext(new Set(), 'female'));
        // "Ar'Za ... as a memorial to the {G "man" "woman"} who guided
        // them toward their destiny."
        expect(male).toContain('memorial to the man who guided');
        expect(female).toContain('memorial to the woman who guided');
        expect(male).toContain('he was the one that suggested');
        expect(male).not.toContain('{G');
    });

    it('expands the registered-status conditional in fighter-bay dësc 3029 '
        + '(P30)', async () => {
        const gameData = await getIntegrationGameData();
        const d = await gameData.data.Description.get('nova:3029');
        // NovaJS is "registered": {P30"License" "License, REQUIRES YOU TO
        // REGISTER EV NOVA"} resolves to its first, polite string.
        const out = resolveConditionalBlocks(d.text, emptyDescTextContext());
        expect(out).toBe('A few days is all it takes to convert sections of '
            + 'your ship into a launchbay for Viper fighters.  The '
            + 'conversion comes complete with everything you\'ll need to refuel, '
            + 're-arm and service a maximum force of four Vipers.\n\n'
            + 'Requires: Fighter Bay License');
        // And with registration disabled, the second, nag string is chosen.
        const unregistered = resolveConditionalBlocks(d.text,
            { ...emptyDescTextContext(), isRegistered: false });
        expect(unregistered)
            .toContain('Requires: Fighter Bay License, REQUIRES YOU TO REGISTER');
    });

    it('expands the control-bit conditional in outfit dësc 3070 (b424)',
        async () => {
        const gameData = await getIntegrationGameData();
        const d = await gameData.data.Description.get('nova:3070');
        // {b424 "\n\nYou stare at this item..." ""}: chosen when the bit is
        // set; empty (the unregistered "you can no longer buy" nag) when not.
        const withBit = resolveConditionalBlocks(d.text,
            makeDescTextContext(new Set([424])));
        expect(withBit).toContain(
            'You stare at this item, and the others around it');
        const withoutBit = resolveConditionalBlocks(d.text,
            makeDescTextContext(new Set()));
        expect(withoutBit).not.toContain('You stare at this item');
        expect(withoutBit).not.toContain('{b424');
    });

    it('expands the gender conditional in outfit dësc 3232', async () => {
        const gameData = await getIntegrationGameData();
        const d = await gameData.data.Description.get('nova:3232');
        const male = resolveConditionalBlocks(d.text,
            makeDescTextContext(new Set(), 'male'));
        // The '{G"mate" "ma\'am"}' block resolves to its first string.
        expect(male).toContain('will degrade over time, mate,');
        expect(male).not.toContain('{G');
    });
});
