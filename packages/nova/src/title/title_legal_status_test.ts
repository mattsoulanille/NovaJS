import 'jasmine';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import {
    LEGAL_STATUS_NO_RECORD, LEGAL_STATUS_NOT_APPLICABLE, legalStatusName,
} from '../nova_plugin/reputation/index.js';
import { titleLegalStatus } from './title_legal_status.js';

function makeGovt(id: string, partial: Partial<GovtData> = {}): GovtData {
    return { ...getDefaultGovtData(), id, ...partial };
}

/**
 * The title screen's "Legal status in current system:" line (reference
 * "Combat-rating tiers (R5), wave 41", side finding): the real word for
 * the pilot's record in the saved system, not a hard-coded "Citizen".
 */
describe('title screen legal status (R5 side finding, wave 41)', () => {
    const fed = makeGovt('nova:128', { crimeTol: 6 });
    const rebels = makeGovt('nova:147', { crimeTol: 3, initialRecord: -5 });
    const xeno = makeGovt('nova:200', {
        flags: { ...getDefaultGovtData().flags, xenophobic: true },
    });
    const getGovt = (id: string) => [fed, rebels, xeno].find(g => g.id === id);

    it('reads "No Record" for a record of 0 in the saved system', () => {
        expect(titleLegalStatus({ system: 'sys:fed', legalRecords: [] },
            'nova:128', getGovt)).toBe(LEGAL_STATUS_NO_RECORD);
        expect(titleLegalStatus(
            { system: 'sys:fed', legalRecords: [['sys:fed', 0]] },
            'nova:128', getGovt)).toBe('No Record');
    });

    it('reads the saved system\'s record, not another system\'s', () => {
        const save = {
            system: 'sys:fed',
            legalRecords: [['sys:fed', 10], ['sys:other', -100]] as
                [string, number][],
        };
        expect(titleLegalStatus(save, 'nova:128', getGovt)).toBe('Citizen');
        expect(titleLegalStatus({ ...save, system: 'sys:other' },
            'nova:128', getGovt)).toBe(legalStatusName(-100, 6));
    });

    it('reads an absent record as the status govt\'s InitialRec', () => {
        expect(titleLegalStatus({ system: 'sys:rebel', legalRecords: [] },
            'nova:147', getGovt)).toBe(legalStatusName(-5, 3));
    });

    it('judges an independent system by gövt 128', () => {
        expect(titleLegalStatus(
            { system: 'sys:indep', legalRecords: [['sys:indep', -30]] },
            null, getGovt)).toBe(legalStatusName(-30, 6));
    });

    it('says N/A under a xenophobic govt', () => {
        expect(titleLegalStatus(
            { system: 'sys:xeno', legalRecords: [['sys:xeno', 50]] },
            'nova:200', getGovt)).toBe(LEGAL_STATUS_NOT_APPLICABLE);
    });

    it('places an older save\'s per-govt record in the saved system', () => {
        expect(titleLegalStatus({
            system: 'sys:fed', legalRecords: [],
            govtRecords: [['nova:128', 400]],
        }, 'nova:128', getGovt)).toBe(legalStatusName(400, 6));
        // A per-system record already there wins.
        expect(titleLegalStatus({
            system: 'sys:fed', legalRecords: [['sys:fed', 0]],
            govtRecords: [['nova:128', 400]],
        }, 'nova:128', getGovt)).toBe(LEGAL_STATUS_NO_RECORD);
    });

    it('is undefined when the status govt is unknown', () => {
        expect(titleLegalStatus({ system: 'sys:x', legalRecords: [] },
            'nova:999', getGovt)).toBeUndefined();
    });
});
