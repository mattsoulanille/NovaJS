import 'jasmine';
import {
    COMM_HOSTILE_COLOR, COMM_LABEL_COLOR, COMM_VALUE_COLOR, identityRuns,
} from './hail_dialog.js';

/**
 * The comm dialog's identity block is not one colour. Sampled off the
 * original-hardware captures (1920x1080, frames blitted 1:1, so these are the
 * game's own pixels):
 *
 *  - hail/hail_hostile.png, the ship comm's lower well at screen x 786..890:
 *    "Class:" / "Status:" are 0x808080 grey, "Fed Destroyer" and
 *    "(Federation)" are 0xffffff white, and "Hostile" is 0xdd0806 RED.
 *  - hail/hail.png: the same grey "Class:" with a white "Terrapin".
 *  - hail/hail_escort.png: the bare label "Hired Escort:" is grey, with the
 *    white ship name and class beneath it.
 */
describe('identityRuns (the comm identity block\'s coloured runs)', () => {
    it('greys the label and whitens the value', () => {
        expect(identityRuns('Class: Terrapin')).toEqual([[
            { text: 'Class: ', color: COMM_LABEL_COLOR },
            { text: 'Terrapin', color: COMM_VALUE_COLOR },
        ]]);
    });

    it('paints the Status VALUE red and leaves its label dim', () => {
        const [line] = identityRuns('Status: Hostile');
        expect(line).toEqual([
            { text: 'Status: ', color: COMM_LABEL_COLOR },
            { text: 'Hostile', color: COMM_HOSTILE_COLOR },
        ]);
        // The red is the sampled 0xdd0806, not a generic full red.
        expect(COMM_HOSTILE_COLOR).toBe(0xdd0806);
        expect(COMM_LABEL_COLOR).toBe(0x808080);
    });

    it('splits the hostile block the way hail_hostile.png reads', () => {
        expect(identityRuns(
            'Class: Fed Destroyer\n(Federation)\nStatus: Hostile'))
            .toEqual([
                [
                    { text: 'Class: ', color: COMM_LABEL_COLOR },
                    { text: 'Fed Destroyer', color: COMM_VALUE_COLOR },
                ],
                // The government line has no label: all white.
                [{ text: '(Federation)', color: COMM_VALUE_COLOR }],
                [
                    { text: 'Status: ', color: COMM_LABEL_COLOR },
                    { text: 'Hostile', color: COMM_HOSTILE_COLOR },
                ],
            ]);
    });

    it('greys a bare label line and whitens what hangs under it', () => {
        // hail_escort.png: grey "Hired Escort:", white " Terrapin" / " Standard".
        expect(identityRuns('Hired Escort:\n Terrapin\n Standard')).toEqual([
            [{ text: 'Hired Escort:', color: COMM_LABEL_COLOR }],
            [{ text: ' Terrapin', color: COMM_VALUE_COLOR }],
            [{ text: ' Standard', color: COMM_VALUE_COLOR }],
        ]);
    });

    it('leaves a plain name (a pers) white and whole', () => {
        expect(identityRuns('Captain Hector')).toEqual([
            [{ text: 'Captain Hector', color: COMM_VALUE_COLOR }],
        ]);
    });

    it('greys a stellar\'s class caption whole, under a white name', () => {
        // hail/hail_planet.png: "Earth" 0xffffff, "[Earth/Luna System]"
        // 0x808080 — and a caption with a colon is not split on it.
        expect(identityRuns('Earth\n[Earth/Luna System]\n[Class: odd]'))
            .toEqual([
                [{ text: 'Earth', color: COMM_VALUE_COLOR }],
                [{ text: '[Earth/Luna System]', color: COMM_LABEL_COLOR }],
                [{ text: '[Class: odd]', color: COMM_LABEL_COLOR }],
            ]);
    });

    it('never drops or reorders a character of the block', () => {
        for (const block of ['Class: Fed Destroyer\n(Federation)\n'
            + 'Status: Hostile', 'Hired Escort:\n Terrapin', 'Captain Hector',
            'Rauther\n[Rocky Moon - metallic]\nStatus: Hostile',
            'Class: Unidentified ship', '']) {
            const rebuilt = identityRuns(block)
                .map(runs => runs.map(run => run.text).join(''))
                .join('\n');
            expect(rebuilt).withContext(block).toBe(block);
        }
    });
});
