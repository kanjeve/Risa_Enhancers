# Risa-Enhancers 

これはVScodeでRisa/Asirのコードを書くための拡張機能 "risa-enhancers"です。

## 機能

「Risa_Enhancers」には、現在次の機能があります。

- コード補完
- シンタックス・ハイライト
- 非常に弱いコード診断
- コード実行


## 使い方
VScodeはインストールされているものとします。
VSCode上で`~.rr`の名前でファイルを作り、それにAsir言語で書き込みます。

コードを書きあげたら、`Shift + Enter`。
右上にある三角のアイコン`Risa/Asir: Execute Code`、または右下の`Run Risa/Asir`をクリックでも実行できます。
コードの一部分だけ実行したい場合は、その部分を範囲選択して実行することでできます。

もし、自作のファイルを`load("~.rr")`を使って読み込ませたい場合は、VScodeで開いているディレクトリではなく、Asirのあるディレクトリに~.rrはおいてください。
![alt](https://github.com/kanjeve/Risa_Enhancers/blob/main/images/nopathwin.png)
![alt](https://github.com/kanjeve/Risa_Enhancers/blob/main/images/pathwin.png)


WindowsユーザーはWSLを入れている場合は左下にある`Risa/Asir: WSL`または`Risa/Asir: Windows`をクリックすることで、計算を実行する場所を、Open XMを介した推奨版か、Asir GUI版かを選ぶことができます。
個人的な所感ですが、Windowsモードの方が仮想環境を介さず、またOpen XMを介さない分、出力が表示されるまでの時間が早いです。
WSLにおけるRisa/Asirの諸環境の構築はhowtowsl.txtに記載してありますので、参考にしてください。

計算の実行中に右上のコーヒーカップ`Risa/Asir: Cancel Current Execution`、または右下の`Cancel Risa/Asir`をクリックすることで、計算を強制的に停止できます。計算時間が許容できないくらい長くなってしまった時や、無限ループした場合にお試しください。

また、Jupyter Notebookを使ってAsirを起動できる（ように環境構築した）場合は、そこでもシンタックスハイライトやコード補完の機能が利用できます。なお、この拡張機能をインストールすることでJupyter Notebookを使ってAsirが計算できるようになる訳ではありません。カーネルの設定などはhowtowsl.txtに記載していますので、参考にしてください。

## 動作環境

不明

## 未修整の部分

- エラー出ない文もエラーとして出力されることがあります。現在修整中ですが、時間がかかりそうです。

## 将来

2025/06/02
今後実装したいことを次に示します。
- コード補完の改善（実際に使用してみて改良していく）
- コード診断（括弧が閉じていない、型があっていないなど）（滅茶苦茶難しい）
- ~~VScode上でAsirの起動、実行（野望）~~ （実装済み）
- ~~Webviewでの結果の出力~~ (実装済み)
- その他色々盛る
  
ほとんど完成形になったため、今後は、改善をメインに、新機能などは趣味の範囲でやっていきます。


## Release Notes


### 0.0.1

初期版。
コード補完とシンタックスハイライトを実装。

### 0.1.1

- 括弧が閉じていないときにエラーが出るようになりました。
- VScode上でRisa/Asirを実行できるようになりました。
- Jupyter NotebookでもAsir言語のコード補完とシンタックスハイライトが使えるようになりました。

### 0.1.2

- shiftキーとenterキーの同時押しで実行できるようにしました。
- 実行中に計算を止める機能を追加しました。
- コーヒーを入れました。

### 0.2.0

- 出力がWebviewで表示されるようになりました。
- 括弧の構文診断をより強固にしました。

### 0.2.1

- エラーメッセージが出力されるように修正しました。

### 0.2.2

※このバージョンはとりあえず版です。理由あって利用するとVSCodeに「警告文」が頻繁に表示されますが、実行には問題はありませんので、警告文が気にならない場合にご利用ください。Macユーザーはこのバージョン以降で「Execute」コマンドが利用できるようになるかと思います。

- Macでの実行におけるパスを`usr/local/bin/asir`に変更しました。
- ユーザー定義の変数や関数の間違った使い方に対して「警告文」が表示されるようになりました。... が、正しい文脈に対してもエラーメッセージがでるようです。現在、鋭意修整中です。

## 参考
主にGeminiとの対話によって作られました。
Gemini以外に参考にしたサイトを挙げます。
- https://code.visualstudio.com/api/
- https://docs.npmjs.com/cli/v7/configuring-npm/package-json
- https://www.math.kobe-u.ac.jp/OpenXM/Current/doc/asir2000/html-ja/man/man.html
- https://www.math.kobe-u.ac.jp/Asir/asir-ja.html
- https://nodejs.org/docs/latest/api/
- http://www.math.sci.kobe-u.ac.jp/OpenXM/Current/doc/asir-contrib/ja/cman-ja.pdf
- https://yeoman.io/
