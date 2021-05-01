import { double } from 'collisions/hello_world_wasm_bindgen';
import 'jasmine';

describe('double', () => {
    it('doubles number', () => {
        expect(double(123)).toEqual(246);
    });
});
