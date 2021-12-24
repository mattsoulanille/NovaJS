import 'jasmine';
import { getDefaultPictImageData } from './PictImage';

describe('PictImage', () => {
    it('gets the default pict data', () => {
        expect(getDefaultPictImageData()).toBeDefined();
    });
});
