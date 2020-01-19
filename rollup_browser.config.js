//import tscc from '@tscc/rollup-plugin-tscc';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import sourcemaps from 'rollup-plugin-sourcemaps';
import json from '@rollup/plugin-json';
//import compiler from 'rollup-plugin-closure-compiler';
import nodeGlobals from 'rollup-plugin-node-globals';
import builtins from 'rollup-plugin-node-builtins';
//import replace from '@rollup/plugin-replace';
//import typescript from '@rollup/plugin-typescript';

export default {
    plugins: [
		// replace({
		//  	exclude: "node_modules/**",
		// 	replaces: {
		// 		'import \* as UUID from "uuid/v4";': 'import UUID from "uuid/v4";',
		// 		//'import \* as UUID from "uuid/v4";': 'error()";',
		// 		//				'import \* as filenamify from "filenamify";': 'import filenamify from "filenamify";',
		// 	}
		// }),
	    json(),
//	    typescript(),
	    commonjs({
		    // NOTE: This plugin has to be before resolve or else
		    // all the commonjs imports it rewrites don't work!
			// Actually, if it comes before resolve, you get a bunch of hidden failures,
			// of modules not being resolved, so don't do that.
			include: 'node_modules/**',
//			include: /node_modules/,
			namedExports: {
				//				"es6-promise-polyfill": ["Polyfill"]
				//"node_modules/pixi.js/lib/pixi.es.js": ["default"]
			}
		}),

	    nodeGlobals(),
	    builtins(),
        resolve({
			mainFields: ['module', 'main', 'name'],
			browser: true,
			preferBuiltins: false
		}),

		sourcemaps(),
// 		compiler({
// 			language_in: "ECMASCRIPT_2015",
// 			module_resolution: "NODE",
// 			process_common_js_modules: true,
// //			debug: true,
// //			create_source_map: true
// 		}),
    ]
}
