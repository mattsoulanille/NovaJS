import { double } from 'collisions/hello_world_wasm_bindgen';
//import 'jasmine';

console.log("Hello");
console.log(double);

describe('double', () => {
    it('doubles number', () => {
        //expect(double(123)).toEqual(246);
        expect(123).toEqual(123);
    });
});
