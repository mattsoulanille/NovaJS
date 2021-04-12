load("@npm//@bazel/concatjs:index.bzl", "karma_web_test_suite")


def web_test(**kwargs):
    karma_web_test_suite(
        browsers = ["@//webtesting:chrome"],
        tags = ["native"],
        **kwargs
    )
