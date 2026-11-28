import 'jasmine';
import { makeDescTextContext, resolveConditionalBlocks } from './desc_text.js';

/**
 * Reference "dësc test operators, wave 54", replayed whole: every dësc of
 * the three run-only plug-ins (evidence tools/w54_desc_ops*.mjs), and what
 * the ORIGINAL showed for it, read off the outfitter's description pane and
 * Snowmelt's landing text. Pilots:
 *
 *   o: holds an Escape Pod (oütf 188), bit 9351 clear, male;
 *   b: no Escape Pod, bit 9351 SET, male;
 *   f: as o, but female.
 *
 * Outfits are deliberately absent from the contexts: the original has no
 * outfit term in a dësc (o's Escape Pod changed nothing anywhere).
 */
const R = '\r';
const lines = (...l: string[]) => l.join(R);

const PILOTS = {
    o: makeDescTextContext(new Set<number>(), 'male'),
    b: makeDescTextContext(new Set<number>([9351]), 'male'),
    f: makeDescTextContext(new Set<number>(), 'female'),
};
type Pilot = keyof typeof PILOTS;

interface Case {
    /** "<run>/<dësc id>" as in the evidence. */
    name: string;
    text: string;
    shown: Partial<Record<Pilot, string>>;
}

const DAMPER = 'Requires: Exotic Technologies License{o609 "' + R + R
    + 'You can`t get this outfit since your ship is already inertialess." ""}';

const CASES: Case[] = [
    // ---- run 1 (ops_o, ops_b) ----
    {
        name: 'ops/3056 o terms', text: lines(
            '1[{o188 "Y" "N"}]', '2[{o300 "Y" "N"}]', '3[{!o188 "Y" "N"}]',
            '4[{O188 "Y" "N"}]', '5[{o188 "Y"}]', '6[{o300 "Y"}]',
            '7[{o188"Y""N"}]', '8[{ o188 "Y" "N"}]', '9[{! o188 "Y" "N"}]',
            '10[{o188 "Y" "N" "Z"}]'),
        shown: { o: '1[', b: '1[' },
    },
    {
        name: 'ops/3057 other letters', text: lines(
            '11[{e136 "Y" "N"}]', '12[{e300 "Y" "N"}]', '13[{E136 "Y" "N"}]',
            '14[{b9351 "Y" "N"}]', '15[{G "Y" "N"}]', '16[{P "Y" "N"}]',
            '17[{x188 "Y" "N"}]', '18[{q "Y" "N"}]', '19[{o "Y" "N"}]',
            '20[{b "Y" "N"}]'),
        shown: {
            o: lines('11[N]', '15[Y]', '16[Y]', '17[N]'),
            b: lines('11[Y]', '15[Y]', '16[Y]', '17[N]'),
        },
    },
    {
        name: 'ops/3058 compound', text: lines(
            '21[{o188 & b9351 "Y" "N"}]', '22[{o188 | b9351 "Y" "N"}]',
            '23[{(o188) "Y" "N"}]', '24[{[o188 b9351] = 1 "Y" "N"}]',
            '25[{o188&b9351 "Y" "N"}]', '26[{!(o300) "Y" "N"}]',
            '27[{b9351 o188 "Y" "N"}]', '28[{1 "Y" "N"}]',
            '29[{b9351 | o188 "Y" "N"}]'),
        shown: {
            o: lines('21[N]', '22[N]', '23[N]', '25[N]', '26[Y]', '28[Y]'),
            b: lines('21[Y]', '22[Y]', '23[Y]', '25[Y]', '26[N]', '28[N]'),
        },
    },
    {
        name: 'ops/3059 malformed', text: lines(
            '30[{o188 Y N}]', '31[{}]', '32[{o188}]', '33[a { b]',
            '34[{o188 "Y" "N"}{o300 "Y" "N"}]',
            '35[License{o188 "' + R + R + 'You can`t get this." ""}]',
            '36[{o188 "Y" "N" end'),
        shown: { o: '30[N ]' + R + '36[', b: '30[N ]' + R + '36[' },
    },
    {
        name: 'ops/3060 unterminated quote', text: lines(
            '39[{o128 "Y" "N"}]', '37[{o188 "Y" "N}]', '38[after]'),
        shown: { o: '39[', b: '39[' },
    },
    {
        name: 'ops/164 landing',
        text: 'L1[{o188 "Y" "N"}] L2[{e300 "Y" "N"}] L3[{x188 "Y" "N"}] '
            + 'L4[{o188 & b9351 "Y" "N"}] L5[{b9351 "Y" "N"}]',
        shown: { o: 'L1[N] L5[N]', b: 'L1[Y] L5[Y]' },
    },
    // ---- run 2 (ops2_o, ops2_b, ops2_f) ----
    {
        name: 'ops2/3056 terms after a b', text: lines(
            '1[{b0 | o188 "Y" "N"}]', '2[{b0 | o300 "Y" "N"}]',
            '3[{b0 | e136 "Y" "N"}]', '4[{b0 | e300 "Y" "N"}]',
            '5[{b9351 & o188 "Y" "N"}]', '6[{b0 | !o188 "Y" "N"}]',
            '7[{b0 | O188 "Y" "N"}]', '8[{b0 | (o188) "Y" "N"}]',
            '9[{b0 | [o188 b9351] = 1 "Y" "N"}]', '10[{b0 | g "Y" "N"}]',
            '11[{b0|o188 "Y" "N"}]'),
        shown: {
            o: lines('1[N]', '2[N]', '3[N]', '4[N]', '5[N]', '6[N]', '7[N]',
                '8[N]', '9[N]', '10[N]', '11[N]'),
            b: lines('1[N]', '2[N]', '3[N]', '4[N]', '5[Y]', '6[N]', '7[N]',
                '8[N]', '9[N]', '10[N]', '11[N]'),
            f: lines('1[N]', '2[N]', '3[N]', '4[N]', '5[N]', '6[N]', '7[N]',
                '8[N]', '9[N]', '10[N]', '11[N]'),
        },
    },
    {
        name: 'ops2/3057 uppercase targets', text: lines(
            '12[{x "Y" "N"}]', '13[{G "M" "F"}]', '14[{x "Y" "N"}]',
            '15[{B9351 "Y" "N"}]', '16[{x "Y" "N"}]', '17[{P "R" "U"}]',
            '18[done]'),
        shown: {
            o: lines('12[M]', '14[N]', '16[R]', '18[done]'),
            b: lines('12[M]', '14[Y]', '16[R]', '18[done]'),
            f: lines('12[F]', '14[N]', '16[R]', '18[done]'),
        },
    },
    {
        name: 'ops2/3058 prose stops and a skipped "!"', text: lines(
            '20[{x "Y" "N"} ! {b0 "Y" "N"}]',
            '21[{x "Y" "N"} a p {b0 "Y" "N"}]',
            '22[{x "Y" "N"} a g {b0 "Y" "N"}]',
            '23[{x "Y" "N"} a o188 {b0 "Y" "N"}]', '24[done]'),
        shown: {
            o: lines('20[Y]', '21[N]', '22[N]', '23[Y]', '24[done]'),
            b: lines('20[Y]', '21[N]', '22[N]', '23[Y]', '24[done]'),
            f: lines('20[Y]', '21[N]', '22[Y]', '23[Y]', '24[done]'),
        },
    },
    {
        name: 'ops2/3059 strings (and the sticky "!")', text: lines(
            '25[{G "Y" "N" tail}]', '26[{!G "Y" "N" tail}]', '27[{b0 "Y"}]',
            '28[{G "Y"}]', '29[{G "a\\"c" "N"}]', '30[{!G "Y" "a\\"c"}]',
            '31[{G"Y""N"}]', '32[{G "Y" "N" "Z"}]', '33[{!G "Y" "N" "Z"}]',
            '34[{!G "Y" x "N"}]', '35[done]'),
        shown: {
            o: lines('25[Y]', '26[N]', '27[Y]', '28[]', '29[N]', '30[a"c]',
                '31[N]', '32[N]', '33[N]', '34[N]', '35[done]'),
            b: lines('25[Y]', '26[N]', '27[Y]', '28[]', '29[N]', '30[a"c]',
                '31[N]', '32[N]', '33[N]', '34[N]', '35[done]'),
            f: lines('25[N]', '26[Y]', '27[Y]', '28[Y]', '29[a"c]', '30[Y]',
                '31[Y]', '32[Y]', '33[Y]', '34[Y]', '35[done]'),
        },
    },
    {
        name: 'ops2/3060 the b term', text: lines(
            '36[{b0 "Y" "N"}{G "Y" "N"}]', '37[{ b0 "Y" "N"}]',
            '38[{b 9351 "Y" "N"}]', '39[{b9351x "Y" "N"}]',
            '40[{b9351 "Y" "N"}]', '41[{!b9351 "Y" "N"}]', '42[done]'),
        shown: {
            o: lines('36[NY]', '37[N]', '38[N]', '39[N]', '40[N]', '41[Y]',
                '42[done]'),
            b: lines('36[NY]', '37[N]', '38[N]', '39[Y]', '40[Y]', '41[N]',
                '42[done]'),
            f: lines('36[NN]', '37[N]', '38[N]', '39[N]', '40[N]', '41[Y]',
                '42[done]'),
        },
    },
    {
        name: 'ops2/3305 the Inertial Damper text', text: DAMPER,
        shown: {
            o: 'Requires: Exotic Technologies License ',
            b: 'Requires: Exotic Technologies License ',
            f: 'Requires: Exotic Technologies License}',
        },
    },
    {
        name: 'ops2/164 landing', text: 'L1[{b0 | o188 "Y" "N"}] L2[{o188 "Y" "N"}] L3[after]',
        shown: { o: 'L1[N] L2[', b: 'L1[N] L2[', f: 'L1[N] L2[' },
    },
    // ---- run 3 (ops3_o) ----
    { name: 'ops3/3056', text: 'E1[{b0 "Y" "N" tail]', shown: { o: 'E1[N' } },
    { name: 'ops3/3057', text: 'E2[{b0 "Y" "N tail]', shown: { o: 'E2[N tail]' } },
    { name: 'ops3/3058', text: 'E3[{G "Y tail]', shown: { o: 'E3[Y tail]' } },
    { name: 'ops3/3059', text: 'E4[{b0 noquote} tail]', shown: { o: 'E4[' } },
    { name: 'ops3/3060', text: 'E5[{} big "Y" "N"} tail]', shown: { o: 'E5[N tail]' } },
    {
        name: 'ops3/3305', text: lines(
            'E6[{b0 "Y" "N"} wow! {b0 "Y" "N"}]',
            'E7[{G "{b0 \\"Y\\" \\"N\\"}" "x"}]', 'E8[a } b]',
            'E9[{G "Y" "N"} {!b0 "Y" "N"} {b0 "Y" "N"}]'),
        shown: {
            o: lines('E6[N wow! N]', 'E7[{b0 "Y" "N"}]', 'E8[a } b]',
                'E9[Y Y Y]'),
        },
    },
    {
        name: 'ops3/164', text: 'L1[{G "Y" "N"}{b0 "Y" "N"}] L2[ok]',
        shown: { o: 'L1[YN] L2[ok]' },
    },
];

describe('dësc conditionals: the original\'s wave-54 reference runs', () => {
    for (const c of CASES) {
        for (const [pilot, shown] of Object.entries(c.shown)) {
            it(`${c.name}, pilot ${pilot}`, () => {
                expect(resolveConditionalBlocks(c.text, PILOTS[pilot as Pilot]))
                    .toBe(shown);
            });
        }
    }
});
