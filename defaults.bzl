load("@npm//@bazel/concatjs:index.bzl", _ts_library = "ts_library")
load("@npm//@bazel/esbuild:index.bzl", _esbuild = "esbuild")
load("@npm//esbuild-visualizer:index.bzl", "esbuild_visualizer")

def ts_library(name, **kwargs):
    module_name = kwargs["module_name"] if "module_name" in kwargs else None
    package_name = kwargs.pop("package_name", module_name)

    _ts_library(
        name = name,
        devmode_target = kwargs.pop("devmode_target", "esnext"),
        prodmode_target = kwargs.pop("prodmode_target", "esnext"),
        package_name = package_name,
        **kwargs
    )

# Returns DefaultInfo containing only json files
def _get_json_impl(ctx):
    json_files = [f for f in ctx.files.srcs if f.extension == "json"]
    return DefaultInfo(files = depset(json_files))

_get_json = rule(
    implementation = _get_json_impl,
    attrs = {
        "srcs": attr.label_list(allow_files = True,
        doc = "List of files to extract json files from"),
    }
)

def esbuild(name, **kwargs):
    # Make sure esbuild resolves the prodmode outputs of ts_library
    args = kwargs.pop("args", {})
    args["resolveExtensions"] = [".mjs", ".js"]

    _esbuild(
        name = name,
        args = args,
        **kwargs,
    )

    json_name = name + "_json"
    _get_json(
        name = json_name,
        srcs = [":" + name],
    )

    esbuild_visualizer(
        name = name + "_vis",
        data = [json_name],
        args = [
            "--filename", "$@",
            "--template", "sunburst",
            "--metadata", "$(locations %s)" % json_name,
        ],
        outs = [
            name + "_vis.html",
        ],
    )
