load("@build_bazel_rules_nodejs//:index.bzl", "nodejs_test")

def mocha_ts_test(name, args = None, srcs = [], deps = [], data = [], **kwargs):
    if args == None:
        # `../` is a hack to get around the fact that `location`
        # returns the path including the project root directory.
        args = ["../$(location %s)" % l for l in srcs]

    args += [
        "--reporter list",
        "--require ts-node/register/transpile-only",
        "-O tsconfig.json",
    ]

    nodejs_test(
        name = name,
        entry_point = "@npm//:node_modules/mocha/bin/mocha",
        data = srcs + deps + data + [
            "//:tsconfig.json",
            "@npm//mocha",
            "@npm//ts-node",
        ],
        templated_args = args,
        expected_exit_code = 0,
        **kwargs
    )
