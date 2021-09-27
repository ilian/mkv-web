var path = require("path");

module.exports = {
  resolve: {
    extensions: ['.ts', '.js']
  },
  entry: "./src/index.ts",
  output: {
    filename: "bundle.js",
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
        exclude: /node_modules/,
      }
    ]
  },
  devtool: "source-map",
  devServer: {
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
