load("@npm_bazel_rollup//:index.bzl", "rollup_bundle")

def web_bundle(name, deps, entry_point, **kwargs):
    rollup_bundle(
        name = name,
        deps = deps + [
            "@npm//@rollup/plugin-node-resolve",
            "@npm//@rollup/plugin-commonjs",
            "@npm//rollup-plugin-sourcemaps",
            "@npm//@rollup/plugin-json",
            "@npm//rollup-plugin-node-globals",
            "@npm//rollup-plugin-node-builtins",
        ],
        entry_point = entry_point,
        config_file = "//:rollup_browser.config.js",
        sourcemap = "inline",
        format = "iife",
        **kwargs,
        #format = "cjs",
    )

def node_bundle(name, deps, entry_point, **kwargs):
    rollup_bundle(
        name = name,
        deps = deps + [
            "@npm//@rollup/plugin-node-resolve",
            "@npm//@rollup/plugin-commonjs",
            "@npm//rollup-plugin-sourcemaps",
            "@npm//@rollup/plugin-json",
            "@npm//rollup-plugin-node-globals",
            "@npm//rollup-plugin-node-builtins",
            "@npm//rollup-plugin-typescript-paths",
        ],
        # data = [
        #"//:tsconfig.json",
        # ],
        entry_point = entry_point,
        config_file = "//:rollup.config.js",
        sourcemap = "inline",
        format = "cjs",
        **kwargs,
        #format = "iife",
    )
