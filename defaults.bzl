load("@npm//@bazel/typescript:index.bzl", _ts_library = "ts_library")

def ts_library(**kwargs):
    # Use the latest es version
    _ts_library(
        devmode_target = kwargs.pop("devmode_target", "esnext"),
        prodmode_target = kwargs.pop("prodmode_target", "esnext"),
        **kwargs
    )
