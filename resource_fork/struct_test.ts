import { unpack } from './struct';

describe('unpack', () => {
    it('unpacks a dataview', () => {
        const array = new Uint8Array([0, 49, 2, 3, 1, 5, 0, 6, 0, 7, 0, 0, 0, 8,
                                      0, 0, 0, 9, 0, 0, 0, 10, 0, 0, 0, 11, 0, 0, 0, 0, 0, 0, 0, 12, 0, 0,
                                      0, 0, 0, 0, 0, 0, 0, 80, 65, 0, 0, 0, 0, 0, 0, 44, 64]);
        const dataView = new DataView(array.buffer);
        const [res, position] = unpack('<xcbB?hHiIlLqQfd', dataView);
        expect(res).toEqual(['1', 2, 3, true, 5, 6, 7, 8, 9, 10, 11n, 12n, 13, 14]);
        expect(position).toEqual(53);
    });
});
