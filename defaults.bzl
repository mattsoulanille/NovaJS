load("@npm//@bazel/typescript:index.bzl", _ts_library = "ts_library")
load("@npm//@bazel/esbuild:index.bzl", _esbuild = "esbuild")

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

def esbuild(name, **kwargs):
    # Make sure esbuild resolves the prodmode outputs of ts_library
    args = kwargs.pop("args", {})
    args["resolveExtensions"] = [".mjs", ".js"]

    _esbuild(
        name = name,
        args = args,
        **kwargs,
    )
