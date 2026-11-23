import 'jasmine';
import { getDefaultPictData } from 'novadatainterface/pict_data';
import { isNoPict } from './no_pict.js';

describe('isNoPict', () => {
    it('recognises the parser\'s placeholder pict id', () => {
        // nova_parse / outfit_parse give a shïp or oütf without a PICT
        // this id; the server answers 404 for it.
        expect(isNoPict(getDefaultPictData().id)).toBeTrue();
        expect(isNoPict('default')).toBeTrue();
    });

    it('passes real PICT ids', () => {
        expect(isNoPict('nova:6000')).toBeFalse();
        expect(isNoPict('Advanced Vell-os Beams:6397')).toBeFalse();
    });
});
