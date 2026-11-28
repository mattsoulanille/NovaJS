import 'jasmine';
import {
    getDefaultMissionData, getDefaultMissionFlags, MissionData,
} from 'novadatainterface/mission_data';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { MissionOffer } from '../nova_plugin/missions/index.js';
import {
    OFFER_ACCEPT_DEFAULT, OFFER_REFUSE_DEFAULT, offerButtons, POPUP_OKAY,
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
            .toEqual({ accept: 'Yes', refuse: 'No' });
        expect(OFFER_ACCEPT_DEFAULT).toBe('Yes');
        expect(OFFER_REFUSE_DEFAULT).toBe('No');
    });

    it('keeps a refusable offer\'s own labels', () => {
        expect(offerButtons(offerOf({
            acceptButton: 'Sure', refuseButton: 'Nope',
        }, false))).toEqual({ accept: 'Sure', refuse: 'Nope' });
    });

    it('asks a can\'t-refuse offer with blank labels with one "Okay"', () => {
        expect(POPUP_OKAY).toBe('Okay');
        expect(offerButtons(offerOf({}, true)))
            .toEqual({ accept: 'Okay', refuse: null });
    });

    it('drops even an authored refuse label under cantRefuse', () => {
        expect(offerButtons(offerOf({ refuseButton: 'Let it go' }, true)))
            .toEqual({ accept: 'Okay', refuse: null });
    });

    it('keeps a can\'t-refuse offer\'s own accept label (GUESS)', () => {
        expect(offerButtons(offerOf({
            acceptButton: 'Go after them', refuseButton: 'Let it go',
        }, true))).toEqual({ accept: 'Go after them', refuse: null });
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
                    .toEqual({ accept: 'Okay', refuse: null });
            }
        });

        it('shows 878 "Put Down Uprising"\'s own "Go after them" alone',
            async () => {
                const offer = await stockOffer('nova:878');
                expect(offerButtons(offer))
                    .toEqual({ accept: 'Go after them', refuse: null });
            });
    });
});
