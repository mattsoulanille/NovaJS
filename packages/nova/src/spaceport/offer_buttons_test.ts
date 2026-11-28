import 'jasmine';
import {
    getDefaultMissionData, getDefaultMissionFlags, MissionData,
} from 'novadatainterface/mission_data';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { MissionOffer } from '../nova_plugin/missions/index.js';
import {
    OFFER_ACCEPT_DEFAULT, OFFER_REFUSE_DEFAULT, offerButtons, POPUP_OKAY,
    popupButtonBoxes,
} from './offer_popup.js';

/**
 * The labels a mission offer is asked with (offerButtons). The original
 * asks a refusable offer with blank buttons No / Yes (wave 40, wave 5) and
 * a can't-refuse one with blank buttons with a lone Okay (stock mïsn 394
 * "Rescue Raczak" at Heraan's bar, wave 13; wave 18's kit copy).
 */
function offerOf(data: Partial<MissionData>,
    cantRefuse: boolean): MissionOffer {
    return {
        data: {
            ...getDefaultMissionData(),
            ...data,
            flags: { ...getDefaultMissionFlags(), cantRefuse },
        },
    } as MissionOffer;
}

describe('offerButtons', () => {
    it('asks a refusable offer with blank labels No / Yes', () => {
        expect(offerButtons(offerOf({}, false)))
            .toEqual({ accept: 'Yes', refuse: 'No', fitTo: ['Yes', 'No'] });
        expect(OFFER_ACCEPT_DEFAULT).toBe('Yes');
        expect(OFFER_REFUSE_DEFAULT).toBe('No');
    });

    it('keeps a refusable offer\'s own labels', () => {
        expect(offerButtons(offerOf({
            acceptButton: 'Sure', refuseButton: 'Nope',
        }, false))).toEqual(
            { accept: 'Sure', refuse: 'Nope', fitTo: ['Sure', 'Nope'] });
    });

    it('asks a can\'t-refuse offer with blank labels with one "Okay"', () => {
        expect(POPUP_OKAY).toBe('Okay');
        expect(offerButtons(offerOf({}, true)))
            .toEqual({ accept: 'Okay', refuse: null, fitTo: ['Okay', 'No'] });
    });

    it('drops an authored refuse button under cantRefuse, but sizes '
        + 'by its label', () => {
        expect(offerButtons(offerOf({ refuseButton: 'Let it go' }, true)))
            .toEqual({
                accept: 'Okay', refuse: null, fitTo: ['Okay', 'Let it go'],
            });
    });

    it('keeps a can\'t-refuse offer\'s own accept label (stock 878)', () => {
        expect(offerButtons(offerOf({
            acceptButton: 'Go after them', refuseButton: 'Let it go',
        }, true))).toEqual({
            accept: 'Go after them', refuse: null,
            fitTo: ['Go after them', 'Let it go'],
        });
    });

    it('takes the default for a label that does not start with a letter',
        () => {
            expect(offerButtons(offerOf({
                acceptButton: '...Fine', refuseButton: '2 late',
            }, false))).toEqual(
                { accept: 'Yes', refuse: 'No', fitTo: ['Yes', 'No'] });
            expect(offerButtons(offerOf({ acceptButton: '"Sure"' }, true)))
                .toEqual(jasmine.objectContaining({ accept: 'Okay' }));
        });

    describe('on the stock missions', () => {
        async function stockOffer(id: string): Promise<MissionOffer> {
            const gameData = await getIntegrationGameData();
            return { data: await gameData.data.Mission.get(id) } as
                MissionOffer;
        }

        it('shows "Okay" alone for 394 "Rescue Raczak" and 680 '
            + '"Speak With Polaris"', async () => {
            for (const id of ['nova:394', 'nova:680']) {
                const offer = await stockOffer(id);
                expect(offer.data.flags.cantRefuse).withContext(id)
                    .toBeTrue();
                expect(offerButtons(offer)).withContext(id)
                    .toEqual(jasmine.objectContaining(
                        { accept: 'Okay', refuse: null }));
            }
        });

        it('shows 878 "Put Down Uprising"\'s own "Go after them" alone',
            async () => {
                const offer = await stockOffer('nova:878');
                expect(offerButtons(offer))
                    .toEqual({
                        accept: 'Go after them', refuse: null,
                        fitTo: ['Go after them', 'Let it go'],
                    });
            });
    });
});

/**
 * Where the offer's buttons go (popupButtonBoxes), against the original's
 * own boxes on the reference Mac (reference "Offer buttons fit their
 * labels, 2026-11-28"; x from the frame's left edge). The label widths
 * are the original's (each measured button's width less 40), injected so
 * the specs need no canvas.
 */
describe('popupButtonBoxes', () => {
    const widths: Record<string, number> = {
        'Yes': 20, 'No': 14, 'W': 11, 'Okay': 29,
        'Go after them': 80, 'Let it go': 50,
        'Go after them right now': 137, 'I need more time': 97,
        'Go after them and destroy them!': 190,
        'Let it go, leave it to the cops': 162,
        ['M'.repeat(32)]: 320, ['W'.repeat(31)]: 310,
    };
    const measure = (label: string) => widths[label];
    const offer = (accept: string, refuse: string | null,
        fitTo: string[]) =>
        popupButtonBoxes({ accept, refuse, fitTo }, measure);

    it('keeps short labels in the 100 px No / Yes pills (1_sigma_1_offer)',
        () => {
            for (const refuse of ['No', 'W']) {
                expect(offer('Yes', refuse, ['Yes', refuse])).toEqual({
                    refuse: { x: 116, width: 100 },
                    accept: { x: 225, width: 100 },
                });
            }
        });

    it('gives both buttons the wider label + 40, refuse growing left, '
        + 'accept right (M4: 177 px at 39 and 225)', () => {
        expect(offer('Go after them right now', 'I need more time',
            ['Go after them right now', 'I need more time'])).toEqual({
            refuse: { x: 39, width: 177 },
            accept: { x: 225, width: 177 },
        });
    });

    it('never caps the width (M6: the refuse box starts 144 px left of '
        + 'the frame)', () => {
        const boxes = offer('W'.repeat(31), 'M'.repeat(32),
            ['W'.repeat(31), 'M'.repeat(32)]);
        expect(boxes.refuse).toEqual({ x: -144, width: 360 });
        expect(boxes.accept).toEqual({ x: 225, width: 360 });
    });

    it('centres a can\'t-refuse offer\'s lone button on 222, sized by the '
        + 'hidden refuse label too (M1, M7, P2)', () => {
        expect(offer('Go after them', null, ['Go after them', 'Let it go'])
            .accept).toEqual({ x: 162, width: 120 });
        expect(offer('Go after them and destroy them!', null,
            ['Go after them and destroy them!', 'Let it go']).accept)
            .toEqual({ x: 107, width: 230 });
        expect(offer('Okay', null,
            ['Okay', 'Let it go, leave it to the cops']).accept)
            .toEqual({ x: 121, width: 202 });
    });

    it('keeps a notice\'s lone Okay the fixed 99 px briefing pill at 173 '
        + '(2_sigma_1_accept)', () => {
        expect(popupButtonBoxes({ accept: 'Okay' }, measure))
            .toEqual({ accept: { x: 173, width: 99 } });
    });
});
