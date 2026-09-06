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
 * A missing second string substitutes nothing when the test is false. The Bible
 * documents no nesting or compound tests; malformed input must degrade (leave the
 * block literal) rather than throw.
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

    it('does not support compound tests; those degrade to literal text', () => {
        const ctx = makeDescTextContext(new Set([1, 2]));
        // b1 & b2 is not a legal single-term dësc test; leave literal.
        expect(resolveConditionalBlocks('{b1 & b2 "both" "other"}', ctx))
            .toBe('{b1 & b2 "both" "other"}');
    });

    it('degrades gracefully on malformed input (no throw)', () => {
        const ctx = emptyDescTextContext();
        // Unterminated closing brace / string stays literal.
        expect(resolveConditionalBlocks('{b1 "unterminated', ctx))
            .toBe('{b1 "unterminated');
        expect(resolveConditionalBlocks('{b1 "a" "b"', ctx))
            .toBe('{b1 "a" "b"');
        // Missing quoted string after the test.
        expect(resolveConditionalBlocks('{b1 noquote}', ctx))
            .toBe('{b1 noquote}');
        // An empty/blank body.
        expect(resolveConditionalBlocks('{}', ctx)).toBe('{}');
        expect(resolveConditionalBlocks('{   }', ctx)).toBe('{   }');
        // Out-of-range bit (b10000) is not a valid term.
        expect(resolveConditionalBlocks('{b10000 "a" "b"}', ctx))
            .toBe('{b10000 "a" "b"}');
        // No literal text and a bare "{" with trailing garbage.
        expect(resolveConditionalBlocks('{', ctx)).toBe('{');
    });

    it('passes through ordinary braces that are not conditionals', () => {
        const ctx = emptyDescTextContext();
        expect(resolveConditionalBlocks('set {1,2,3} of firmware', ctx))
            .toBe('set {1,2,3} of firmware');
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
