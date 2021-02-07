import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import sourcemaps from 'rollup-plugin-sourcemaps';
import json from '@rollup/plugin-json';
import alias from '@rollup/plugin-alias';
import nodeGlobals from 'rollup-plugin-node-globals';
import compiler from '@ampproject/rollup-plugin-closure-compiler';

export default {
    plugins: [
        alias({
            entries: {
                url: require.resolve('url-shim'),
                path: require.resolve('path-browserify'),
            }
        }),
        json(),
        resolve({ browser: true }),
        commonjs(),
        nodeGlobals(),
        sourcemaps({
            exclude: /.*pixi.*/,
        }),
        compiler(),
    ],
}
