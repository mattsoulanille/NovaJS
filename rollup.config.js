//import tscc from '@tscc/rollup-plugin-tscc';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import sourcemaps from 'rollup-plugin-sourcemaps';
//import compiler from 'rollup-plugin-closure-compiler';
//import typescript from '@rollup/plugin-typescript';
import nodeGlobals from 'rollup-plugin-node-globals';
import builtins from 'rollup-plugin-node-builtins';
//import replace from '@rollup/plugin-replace';

export default {
	// input: "TestProject/main.ts",
	// output: {
	// 	//file: "bundle.js",
	// 	format: "cjs",
	// 	dir: "./rollup-out",
	// },
    plugins: [
	    //typescript(),
	    commonjs({
		    // NOTE: This plugin has to be before resolve or else
		    // all the commonjs imports it rewrites don't work!
			include: 'node_modules/**',
//			include: /node_modules/,
			// namedExports: {
			// 	"pngjs": ["PNG"]
			// }
			// 	"node_modules/pngjs/lib/png.js": ["PNG"]
			// }
		}),
		nodeGlobals(),
		builtins(),

        resolve({
	        mainFields: ['module', 'main'],
	        preferBuiltins: true
		}),
		// replace({
		//  	exclude: "node_modules/**",
		// 	replaces: {
		// 		//'import \* as UUID from "uuid/v4";': 'import UUID from "uuid/v4";',
		// 		'import \* as UUID from "uuid/v4";': 'error()";',
		// 		//				'import \* as filenamify from "filenamify";': 'import filenamify from "filenamify";',
		// 	}
		// }),

//		tscc(),
//		typescript(),
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





