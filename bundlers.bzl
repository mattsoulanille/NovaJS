load("@npm//@bazel/rollup:index.bzl", "rollup_bundle")

def web_bundle(name, deps, entry_point, **kwargs):
    rollup_bundle(
        name = name,
        deps = deps + [
            "@npm//@rollup/plugin-node-resolve",
            "@npm//@rollup/plugin-commonjs",
            "@npm//rollup-plugin-sourcemaps",
            "@npm//@rollup/plugin-json",
            "@npm//rollup-plugin-node-globals",
            "@npm//@rollup/plugin-alias",
            "@npm//url-shim",
            "@npm//path-browserify",
        ],
        link_workspace_root = True,
        entry_point = entry_point,
        config_file = "//:rollup_browser.config.ts",
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
            "@npm//rollup-plugin-typescript-paths",
        ],
        # data = [
        #"//:tsconfig.json",
        # ],
        link_workspace_root = True,
        entry_point = entry_point,
        config_file = "//:rollup.config.js",
        sourcemap = "inline",
        format = "cjs",
        **kwargs,
        #format = "iife",
    )
