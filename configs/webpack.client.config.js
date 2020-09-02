const baseConfig = require("./webpack.config");
const ReactRefreshWebpackPlugin = require("@pmmmwh/react-refresh-webpack-plugin");
const path = require("path");
const { stringify } = require("querystring");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const { flareactConfig } = require("./utils");
const defaultLoaders = require("./loaders");
const webpack = require("webpack");
const TerserJSPlugin = require("terser-webpack-plugin");
const OptimizeCSSAssetsPlugin = require("optimize-css-assets-webpack-plugin");
const glob = require("glob");
const BuildManifestPlugin = require("./webpack/plugins/build-manifest-plugin");
const crypto = require("crypto");

const projectDir = process.cwd();
const flareact = flareactConfig(projectDir);
const dev = process.env.NODE_ENV === "development";
const isServer = false;

const pageManifest = glob.sync("./pages/**/*.js");

let entry = {
  main: "flareact/src/client/index.js",
};

pageManifest.forEach((page) => {
  if (/pages\/api\//.test(page)) return;

  const pageName = page.match(/\/(.+)\.js$/)[1];

  const pageLoaderOpts = {
    page: pageName,
    absolutePagePath: path.resolve(projectDir, page),
  };

  const pageLoader = `flareact-client-pages-loader?${stringify(
    pageLoaderOpts
  )}!`;

  entry[pageName] = pageLoader;
});

// Inject default _app unless user has a custom one
if (!entry["pages/_app"]) {
  const pageLoaderOpts = {
    page: "pages/_app",
    absolutePagePath: "flareact/src/components/_app.js",
  };

  const pageLoader = `flareact-client-pages-loader?${stringify(
    pageLoaderOpts
  )}!`;

  entry["pages/_app"] = pageLoader;
}

const totalPages = Object.keys(entry).filter(
  (key) => key.includes("pages") && !/pages\/api\//.test(key)
).length;

// TODO: Revisit
const isModuleCSS = (module) => {
  return (
    // mini-css-extract-plugin
    module.type === `css/mini-extract` ||
    // extract-css-chunks-webpack-plugin (old)
    module.type === `css/extract-chunks` ||
    // extract-css-chunks-webpack-plugin (new)
    module.type === `css/extract-css-chunks`
  );
};

module.exports = (env, argv) => {
  const config = {
    ...baseConfig({ dev, isServer }),
    entry,
    optimization: {
      minimizer: [
        new TerserJSPlugin({
          terserOptions: {
            output: {
              comments: false,
            },
          },
          extractComments: false,
        }),
        new OptimizeCSSAssetsPlugin(),
      ],
      // Split out webpack runtime so it's not included in every single page
      runtimeChunk: {
        name: "webpack",
      },
      splitChunks: dev
        ? {
            cacheGroups: {
              default: false,
              vendors: false,
            },
          }
        : {
            chunks: "all",
            cacheGroups: {
              default: false,
              vendors: false,
              framework: {
                chunks: "all",
                name: "framework",
                test: /[\\/]node_modules[\\/](react|react-dom|scheduler|prop-types)[\\/]/,
                priority: 40,
                // Don't let webpack eliminate this chunk (prevents this chunk from
                // becoming a part of the commons chunk)
                enforce: true,
              },
              // TODO: Write comments for what each chunk does
              lib: {
                test(module) {
                  return (
                    module.size() > 160000 &&
                    /node_modules[/\\]/.test(module.identifier())
                  );
                },
                name(module) {
                  const hash = crypto.createHash("sha1");
                  if (isModuleCSS(module)) {
                    module.updateHash(hash);
                  } else {
                    if (!module.libIdent) {
                      throw new Error(
                        `Encountered unknown module type: ${module.type}. Please open an issue.`
                      );
                    }

                    hash.update(module.libIdent({ context: dir }));
                  }

                  return hash.digest("hex").substring(0, 8);
                },
                priority: 30,
                minChunks: 1,
                reuseExistingChunk: true,
              },
              commons: {
                name: "commons",
                minChunks: totalPages,
                priority: 20,
              },
              shared: {
                name(module, chunks) {
                  return (
                    crypto
                      .createHash("sha1")
                      .update(
                        chunks.reduce((acc, chunk) => {
                          return acc + chunk.name;
                        }, "")
                      )
                      .digest("hex") + (isModuleCSS(module) ? "_CSS" : "")
                  );
                },
                priority: 10,
                minChunks: 2,
                reuseExistingChunk: true,
              },
            },
            maxInitialRequests: 25,
            minSize: 20000,
          },
    },
    context: projectDir,
    target: "web",
    resolveLoader: {
      alias: {
        "flareact-client-pages-loader": path.join(
          __dirname,
          "webpack",
          "loaders",
          "flareact-client-pages-loader"
        ),
      },
    },
    output: {
      path: path.resolve(projectDir, "out/_flareact/static"),
    },
    plugins: [new MiniCssExtractPlugin(), new BuildManifestPlugin()],
    devServer: {
      contentBase: path.resolve(projectDir, "out"),
      hot: true,
      hotOnly: true,
      stats: "errors-warnings",
      noInfo: true,
      headers: {
        "access-control-allow-origin": "*",
      },
    },
    devtool: dev ? "source-map" : false,
  };

  if (dev) {
    config.plugins.push(new ReactRefreshWebpackPlugin());

    config.output.publicPath = "http://localhost:8080/";
  }

  if (flareact.webpack) {
    return flareact.webpack(config, {
      dev,
      isServer,
      isWorker: isServer,
      defaultLoaders: defaultLoaders({ dev, isServer }),
      webpack,
    });
  }

  return config;
};
