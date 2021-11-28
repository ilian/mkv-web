const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = {
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: {
      "path": require.resolve("path-browserify")
    }
  },
  entry: {
    bundle: "./src/index.ts",
    //worker: "./src/chunked-remuxer-worker.ts"
  },
  output: {
    filename: "[name].js",
    path: path.resolve(__dirname, "dist"),
    publicPath: "/dist/"
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [{
          loader: "ts-loader"
        }],
        exclude: /node_modules/
      },
      {
        test: /src\/worker\/ffmpeg-core\//,
        type: 'asset/resource'
      }
    ]
  },
  devtool: "source-map",
  devServer: {
    hot: false,
    liveReload: false,
    // Allow use of SharedArrayBuffer, needed by emscripten threads
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    },
    static: {
      directory: path.join(__dirname, "public"),
    },
    compress: true,
    client: {
      overlay: {
        errors: true,
        warnings: false
      }
    },
    port: 9000
  }
};
