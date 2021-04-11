# Bazel workspace created by @bazel/create 0.39.1

# Declares that this directory is the root of a Bazel workspace.
# See https://docs.bazel.build/versions/master/build-ref.html#workspace
workspace(
    # How this workspace would be referenced with absolute labels from another workspace
    name = "novajs",
    # Map the @npm bazel workspace to the node_modules directory.
    # This lets Bazel use the same node_modules as other local tooling.
    managed_directories = {"@npm": ["node_modules"]},
)

# Install the nodejs "bootstrap" package
# This provides the basic tools for running and packaging nodejs programs in Bazel
load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")

http_archive(
    name = "build_bazel_rules_nodejs",
    sha256 = "f533eeefc8fe1ddfe93652ec50f82373d0c431f7faabd5e6323f6903195ef227",
    urls = ["https://github.com/bazelbuild/rules_nodejs/releases/download/3.3.0/rules_nodejs-3.3.0.tar.gz"],
)

# Use node 15
load("@build_bazel_rules_nodejs//:index.bzl", "node_repositories")
node_repositories(
    package_json = ["//:package.json"],
    node_version = "15.8.0",
    node_repositories = {
        "15.8.0-darwin_amd64": ("node-v15.8.0-darwin-x64.tar.xz", "node-v15.8.0-darwin-x64", "8b1012b7c78c27513bf1d3b1db65f505041771683d964f14f67fe1fc243fe038"),
        "15.8.0-linux_amd64": ("node-v15.8.0-linux-x64.tar.xz", "node-v15.8.0-linux-x64", "cdb80f0810e5a076eb6079297073147d2564b1c2292bb4436b3f9e9e4fe18759"),
        "15.8.0-windows_amd64": ("node-v15.8.0-win-x64.zip", "node-v15.8.0-win-x64", "edb16def1fecaecaffcccf9352e9f94a029d47203f26ae44dc1d4aa7eef35940")
    },
    node_urls = [
        "https://nodejs.org/dist/v{version}/{filename}",
    ]
)

# The yarn_install rule runs yarn anytime the package.json or yarn.lock file changes.
# It also extracts and installs any Bazel rules distributed in an npm package.
load("@build_bazel_rules_nodejs//:index.bzl", "yarn_install")

yarn_install(
    # Name this npm so that Bazel Label references look like @npm//package
    name = "npm",
    package_json = "//:package.json",
    yarn_lock = "//:yarn.lock",
)

# Install closure
# http_archive(
#     name = "io_bazel_rules_closure",
#     sha256 = "7d206c2383811f378a5ef03f4aacbcf5f47fd8650f6abbc3fa89f3a27dd8b176",
#     strip_prefix = "rules_closure-0.10.0",
#     urls = [
#         "https://mirror.bazel.build/github.com/bazelbuild/rules_closure/archive/0.10.0.tar.gz",
#         "https://github.com/bazelbuild/rules_closure/archive/0.10.0.tar.gz",
#     ],
# )

# load("@io_bazel_rules_closure//closure:repositories.bzl", "rules_closure_dependencies", "rules_closure_toolchains")

# rules_closure_dependencies()
# rules_closure_toolchains()

# load("@bazel_tools//tools/build_defs/repo:git.bzl", "git_repository")
# git_repository(
#     name = "com_google_protobuf",
#     remote = "https://github.com/protocolbuffers/protobuf",
#     #    tag = "v3.11.4",
#     commit = "d0bfd5221182da1a7cc280f3337b5e41a89539cf",
#     shallow_since = "1581711200 -0800",
# )

# load("@com_google_protobuf//:protobuf_deps.bzl", "protobuf_deps")
# protobuf_deps()

http_archive(
    name = "rules_proto",
    sha256 = "602e7161d9195e50246177e7c55b2f39950a9cf7366f74ed5f22fd45750cd208",
    strip_prefix = "rules_proto-97d8af4dc474595af3900dd85cb3a29ad28cc313",
    urls = [
        "https://mirror.bazel.build/github.com/bazelbuild/rules_proto/archive/97d8af4dc474595af3900dd85cb3a29ad28cc313.tar.gz",
        "https://github.com/bazelbuild/rules_proto/archive/97d8af4dc474595af3900dd85cb3a29ad28cc313.tar.gz",
    ],
)

load("@rules_proto//proto:repositories.bzl", "rules_proto_dependencies", "rules_proto_toolchains")

rules_proto_dependencies()
rules_proto_toolchains()

# http_archive(
#     name = "rules_typescript_proto",
#     sha256 = "56dce48f816ae5ad239b0ca5a55e7f774ca6866d3bd2306b26874445bc247eb7",
#     strip_prefix = "rules_typescript_proto-0.0.4",
#     urls = [
#         "https://github.com/Dig-Doug/rules_typescript_proto/archive/0.0.4.tar.gz",
#     ],
# )

# load("@rules_typescript_proto//:index.bzl", "rules_typescript_proto_dependencies")

# rules_typescript_proto_dependencies()

# http_archive(
#     name = "com_derivita_rules_ts_closure",
#     sha256 = "f4f53beace2e8ccace417ce851af2b7f09d2dca6dc5d8a047fc198e496ae020a",
#     strip_prefix = "rules_ts_closure-master",
#     urls = [
#         "https://github.com/derivita/rules_ts_closure/archive/master.zip",
#     ],
# )

# load("@com_derivita_rules_ts_closure//:deps.bzl", "install_rules_ts_closure_dependencies")

# install_rules_ts_closure_dependencies()

# load("@com_derivita_rules_ts_closure//:closure.bzl", "setup_rules_ts_closure_workspace")

#setup_rules_ts_closure_workspace()

# Install any Bazel rules which were extracted earlier by the yarn_install rule.

http_archive(
    name = "io_bazel_rules_webtesting",
    sha256 = "9bb461d5ef08e850025480bab185fd269242d4e533bca75bfb748001ceb343c3",
    urls = ["https://github.com/bazelbuild/rules_webtesting/releases/download/0.3.3/rules_webtesting.tar.gz"],
)

# Set up web testing, choose browsers we can test on
load("@io_bazel_rules_webtesting//web:repositories.bzl", "web_test_repositories")

web_test_repositories()

load("@io_bazel_rules_webtesting//web/versioned:browsers-0.3.2.bzl", "browser_repositories")

browser_repositories(
    chromium = True,
    firefox = True,
)

# Bazel labs. Contains the ts proto generator
load("@npm//@bazel/labs:package.bzl", "npm_bazel_labs_dependencies")

npm_bazel_labs_dependencies()

# Remote build execution
http_archive(
    name = "bazel_toolchains",
    sha256 = "1adf5db506a7e3c465a26988514cfc3971af6d5b3c2218925cd6e71ee443fc3f",
    strip_prefix = "bazel-toolchains-4.0.0",
    urls = [
        "https://github.com/bazelbuild/bazel-toolchains/releases/download/4.0.0/bazel-toolchains-4.0.0.tar.gz",
        "https://mirror.bazel.build/github.com/bazelbuild/bazel-toolchains/releases/download/4.0.0/bazel-toolchains-4.0.0.tar.gz",
    ],
)

load("@bazel_toolchains//rules:rbe_repo.bzl", "rbe_autoconfig")

# Creates a default toolchain config for RBE.
# Use this as is if you are using the rbe_ubuntu16_04 container,
# otherwise refer to RBE docs.
rbe_autoconfig(name = "rbe_default")


# esbuild binaries
_ESBUILD_VERSION = "0.11.5"

http_archive(
    name = "esbuild_darwin",
    build_file_content = """exports_files(["bin/esbuild"])""",
    sha256 = "98436890727bdb0d4beddd9c9e07d0aeff0e8dfe0169f85e568eca0dd43f665e",
    strip_prefix = "package",
    urls = [
        "https://registry.npmjs.org/esbuild-darwin-64/-/esbuild-darwin-64-%s.tgz" % _ESBUILD_VERSION,
    ],
)

http_archive(
    name = "esbuild_windows",
    build_file_content = """exports_files(["esbuild.exe"])""",
    sha256 = "589c8ff97210bd41de106e6317ce88f9e88d2cacfd8178ae1217f2b857ff6c3a",
    strip_prefix = "package",
    urls = [
        "https://registry.npmjs.org/esbuild-windows-64/-/esbuild-windows-64-%s.tgz" % _ESBUILD_VERSION,
    ],
)

http_archive(
    name = "esbuild_linux",
    build_file_content = """exports_files(["bin/esbuild"])""",
    sha256 = "113c2e84895f4422a3676db4e15d9f01b2b4fac041edab25284fdb9574ba58a0",
    strip_prefix = "package",
    urls = [
        "https://registry.npmjs.org/esbuild-linux-64/-/esbuild-linux-64-%s.tgz" % _ESBUILD_VERSION,
    ],
)

http_archive(
    name = "io_bazel_rules_docker",
    sha256 = "95d39fd84ff4474babaf190450ee034d958202043e366b9fc38f438c9e6c3334",
    strip_prefix = "rules_docker-0.16.0",
    urls = ["https://github.com/bazelbuild/rules_docker/releases/download/v0.16.0/rules_docker-v0.16.0.tar.gz"],
)

load(
    "@io_bazel_rules_docker//repositories:repositories.bzl",
    container_repositories = "repositories",
)

container_repositories()

load("@io_bazel_rules_docker//repositories:deps.bzl", container_deps = "deps")

container_deps()

load(
    "@io_bazel_rules_docker//nodejs:image.bzl",
    _nodejs_image_repos = "repositories",
)

_nodejs_image_repos()

load("@io_bazel_rules_docker//container:pull.bzl", "container_pull")

# Load base bazel container for building the CI container
container_pull(
    name = "bazel_docker",
    registry = "gcr.io",
    repository = "cloud-builders/bazel",
    # 'tag' is also supported, but digest is encouraged for reproducibility.
    #digest = "sha256:deadbeef",
    tag = "latest",
)
