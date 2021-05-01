import { wasm } from '@rollup/plugin-wasm';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
    plugins: [
        //resolve({ browser: true }),
        resolve(),
        //commonjs(),
        wasm({
            maxFileSize: 1000000000,
            sync: ['node_modules/collisions/hello_world_wasm_bindgen_bg.wasm']
        }),
    ],
};
