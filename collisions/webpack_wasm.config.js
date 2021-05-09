module.exports = {
    //mode: "production",
    mode: "development",
    experiments: {
        asyncWebAssembly: true,
        //outputModule: true,
    },
    devtool: "source-map",
    target: "web",
    // output: {
    //     library: {type: "module"}
    // },
    module: {
        rules: [
            {
                test: /\.js$/,
                enforce: "pre",
                use: [
                    {
                        loader: "source-map-loader",
                        options: {
                            filterSourceMappingUrl: (url, resourcePath) => {
                                if (/broker-source-map-url\.js$/i.test(url)) {
                                    return false;
                                }

                                if (/keep-source-mapping-url\.js$/i.test(resourcePath)) {
                                    return "skip";
                                }

                                return true;
                            },
                        },
                    },
                ],
            },
        ],
    },
};
