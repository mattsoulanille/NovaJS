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
    sha256 = "e79c08a488cc5ac40981987d862c7320cee8741122a2649e9b08e850b6f20442",
    urls = ["https://github.com/bazelbuild/rules_nodejs/releases/download/3.8.0/rules_nodejs-3.8.0.tar.gz"],
)

# Use node 16
load("@build_bazel_rules_nodejs//:index.bzl", "node_repositories")
node_repositories(
    package_json = ["//:package.json"],
    node_version = "16.0.0",
    node_repositories = {
        "16.0.0-darwin_amd64": ("node-v16.0.0-darwin-x64.tar.xz", "node-v16.0.0-darwin-x64", "66ecffa48b98cf1ca4d038b42b74f05bfc4d31681e2aa43a1ba50919ea23823b"),
        "16.0.0-linux_amd64": ("node-v16.0.0-linux-x64.tar.xz", "node-v16.0.0-linux-x64", "1736446bb102e19942addce29f6a12b157ca71f38b9159d0446f51ba69618b8d"),
        "16.0.0-windows_amd64": ("node-v16.0.0-win-x64.zip", "node-v16.0.0-win-x64", "99c2b01afb8d966fc876ec30ac7dfdbd9da9b17a3daeda92c19ce657ab9bea61")
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
load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")

http_archive(
    name = "bazel_toolchains",
    sha256 = "179ec02f809e86abf56356d8898c8bd74069f1bd7c56044050c2cd3d79d0e024",
    strip_prefix = "bazel-toolchains-4.1.0",
    urls = [
        "https://mirror.bazel.build/github.com/bazelbuild/bazel-toolchains/releases/download/4.1.0/bazel-toolchains-4.1.0.tar.gz",
        "https://github.com/bazelbuild/bazel-toolchains/releases/download/4.1.0/bazel-toolchains-4.1.0.tar.gz",
    ],
)

load("@bazel_toolchains//rules:rbe_repo.bzl", "rbe_autoconfig")

# Creates a default toolchain config for RBE.
# Use this as is if you are using the rbe_ubuntu16_04 container,
# otherwise refer to RBE docs.
rbe_autoconfig(name = "rbe_default")

_ESBUILD_VERSION = "0.12.1"
# Setup esbuild dependencies
http_archive(
    name = "esbuild_darwin",
    urls = [
        "https://registry.npmjs.org/esbuild-darwin-64/-/esbuild-darwin-64-%s.tgz" % _ESBUILD_VERSION,
    ],
    strip_prefix = "package",
    build_file_content = """exports_files(["bin/esbuild"])""",
    sha256 = "efb34692bfa34db61139eb8e46cd6cf767a42048f41c8108267279aaf58a948f",
)
http_archive(
    name = "esbuild_windows",
    urls = [
        "https://registry.npmjs.org/esbuild-windows-64/-/esbuild-windows-64-%s.tgz" % _ESBUILD_VERSION,
    ],
    strip_prefix = "package",
    build_file_content = """exports_files(["esbuild.exe"])""",
    sha256 = "10439647b11c7fd1d9647fd98d022fe2188b4877d2d0b4acbe857f4e764b17a9",
)
http_archive(
    name = "esbuild_linux",
    urls = [
        "https://registry.npmjs.org/esbuild-linux-64/-/esbuild-linux-64-%s.tgz" % _ESBUILD_VERSION,
    ],
    strip_prefix = "package",
    build_file_content = """exports_files(["bin/esbuild"])""",
    sha256 = "de8409b90ec3c018ffd899b49ed5fc462c61b8c702ea0f9da013e0e1cd71549a",
)

load("@bazel_tools//tools/build_defs/repo:git.bzl", "git_repository")
git_repository(
    name = "io_bazel_rules_docker",
    remote = "https://github.com/bazelbuild/rules_docker.git",
    commit = "0adf8b2ff23e8d7a14562be0f5707cd4dbb32998",
    shallow_since = "1619278302 -0700",
)

# TODO: Use the next release once the go issue is fixed.
# http_archive(
#     name = "io_bazel_rules_docker",
#     sha256 = "95d39fd84ff4474babaf190450ee034d958202043e366b9fc38f438c9e6c3334",
#     strip_prefix = "rules_docker-0.16.0",
#     urls = ["https://github.com/bazelbuild/rules_docker/releases/download/v0.16.0/rules_docker-v0.16.0.tar.gz"],
# )

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
    name = "bazel_image",
    registry = "gcr.io",
    repository = "cloud-builders/bazel",
    digest = "sha256:9faaccc351f9b172ab74b8607b3afe0f057e95b2975cfb5146be51fbc78603fd"
)
