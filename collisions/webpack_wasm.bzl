load("@npm//webpack-cli:index.bzl", webpack = "webpack_cli")

def webpack_wasm(name, entry_point, deps):
    es5_sources = name + "_es5"
    native.filegroup(
        name = es5_sources,
        srcs = deps,
        output_group = "es5_sources",
    )

    webpack(
        name = name,
        outs = [
            name + ".js",
            name + ".js.map",
        ],
        args = [
            #"$(location index.js)",
            "./$(execpath :{})".format(es5_sources),
            #entry_point,
            #"collisions/hello_world_wasm_test.js",
            "--config",
            "$(location :webpack_wasm.config.js)",
            #"-o",
            "--output-path",
            "./",
            "--output-filename",
            "$(execpath :{})".format(name + ".js"),
        ],
        data = deps + [
            es5_sources,
            "webpack_wasm.config.js",
            "@npm//source-map-loader",
            "//:package.json",
        ],
    )

        
