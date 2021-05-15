load("@build_bazel_rules_nodejs//:providers.bzl", "run_node")
load("//:defaults.bzl", "ts_library")

EXT = ".png"

def _pack_png(ctx):
    src_file = ctx.file.src
    output_file_path = ctx.label.name + ".ts"
    #output_file_path = src_file.basename[:-len(EXT)] + ".ts"
    output_file = ctx.actions.declare_file(output_file_path)

    run_node(
        ctx,
        executable = "pack_png_bin",
        inputs = [src_file],
        outputs = [output_file],
        arguments = [src_file.path, output_file.path]
    )

    return [DefaultInfo(files = depset([output_file]))]

pack_png = rule(
    implementation = _pack_png,
    attrs = {
        "src": attr.label(mandatory = True, allow_single_file = [".png"]),
        "pack_png_bin": attr.label(
            executable = True,
            cfg = "host",
            default = Label("//novadatainterface/scripts:pack_png_bin"),
        )
    },
)

# def pack_png(name, src, **kwargs):
#     packed_png_name = name + "__png"
#     _pack_png_only_png(
#         name = packed_png_name,
#         src = src
#     )
#     ts_library(
#         name = name,
#         srcs = [packed_png_name],
#         **kwargs
#     )
