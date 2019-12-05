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
    sha256 = "3d7296d834208792fa3b2ded8ec04e75068e3de172fae79db217615bd75a6ff7",
    urls = ["https://github.com/bazelbuild/rules_nodejs/releases/download/0.39.1/rules_nodejs-0.39.1.tar.gz"],
)

# The yarn_install rule runs yarn anytime the package.json or yarn.lock file changes.
# It also extracts and installs any Bazel rules distributed in an npm package.
load("@build_bazel_rules_nodejs//:index.bzl", "yarn_install")

yarn_install(
    # Name this npm so that Bazel Label references look like @npm//package
    name = "npm",
    package_json = "//:package.json",
    #    yarn_lock = "//:yarn.lock",
    yarn_lock = "//:package-lock.json",
)

# Install any Bazel rules which were extracted earlier by the yarn_install rule.
load("@npm//:install_bazel_dependencies.bzl", "install_bazel_dependencies")

install_bazel_dependencies()

# Karma
# Fetch transitive Bazel dependencies of npm_bazel_karma
#load("@npm_bazel_karma//:package.bzl", "npm_bazel_karma_dependencies")

#npm_bazel_karma_dependencies()

# More Karma
# Set up web testing, choose browsers we can test on
# rules_webtesting_vers = "0.3.1"
# http_archive(
#     name = "io_bazel_rules_webtesting",
#     sha256 = "d71b9dc5fef03cc0c0974305b1c9a3c36f4df1b52ed3d5898f8fa4c5d9d4edb1",
#     strip_prefix = "rules_webtesting-{v}".format(v = rules_webtesting_vers),
#     urls = [
#         "https://github.com/bazelbuild/rules_webtesting/archive/{v}.tar.gz".format(v = rules_webtesting_vers),
#     ],
# )

# load("@io_bazel_rules_webtesting//web:repositories.bzl", "web_test_repositories")
# load("@io_bazel_rules_webtesting//web/versioned:browsers-0.3.1.bzl", "browser_repositories")

# web_test_repositories()
# browser_repositories(
#     chromium = True,
# )

# Setup TypeScript toolchain
load("@npm_bazel_typescript//:index.bzl", "ts_setup_workspace")

ts_setup_workspace()
