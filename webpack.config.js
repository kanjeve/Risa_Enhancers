'use strict';

const path = require('path');

/** @type {import('webpack').Configuration} */
const config = {
  // VSCode拡張機能はNode.js環境で実行されるため、ターゲットを'node'に設定
  target: 'node', 
  
  // 拡張機能のエントリーポイント（起点となるファイル）
  entry: './src/extension.ts', 
  
  // バンドルされたファイルの出力設定
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]',
  },
  
  // ソースマップを有効にして、デバッグしやすくする
  devtool: 'source-map',
  
  // VSCodeの実行環境で提供される'vscode'モジュールはバンドルに含めない
  externals: {
    vscode: 'commonjs vscode', 
  },
  
  // モジュール解決の設定
  resolve: {
    extensions: ['.ts', '.js'], // .tsと.jsファイルをモジュールとして解決
  },
  
  // モジュールのルール設定
  module: {
    rules: [
      {
        test: /\.ts$/,
        // node_modulesを除外しつつ、ローカルのパーサーパッケージは除外しない（以前の修正を流用）
        exclude: /node_modules[\\\/](?!pasirser)/, // ★ 'pasirser' はご自身のパッケージ名に！
        use: [
          {
            loader: 'ts-loader',
          },
        ],
      },
    ],
  },
};
module.exports = config;