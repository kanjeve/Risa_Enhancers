"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path")); // pathモジュールをインポート
const fs = __importStar(require("fs")); // fsモジュールをインポート
const child_process_1 = require("child_process");
let loadedPackages = []; // パッケージリストを保持する変数
let ctrlPackages = []; // ctrl 用のパッケージリスト
// このメソッドは、拡張機能がアクティブ化されたときに呼び出されます。
// activationEvents に定義されたイベントが発生したときに実行されます。
function activate(context) {
    // コンソールにメッセージを出力して、拡張機能がアクティブ化されたことを確認できます。
    console.log('Congratulations, your extension "risa-enhancers" is now active!');
    // --- Risa/Asir CLI 実行結果用の出力チャンネルを作成 ---
    // 拡張機能がアクティブ化されたときに一度だけ作成します
    const asirOutputChannel = vscode.window.createOutputChannel('Risa/Asir CLI Output');
    // 後で登録するコマンドで使用するため、context.subscriptions に追加します
    context.subscriptions.push(asirOutputChannel);
    // --- パッケージリストの読み込み ---
    const packagesFilePath = path.join(context.extensionPath, 'data', 'packages.json');
    try {
        const data = fs.readFileSync(packagesFilePath, 'utf8');
        loadedPackages = JSON.parse(data);
        console.log(`Loaded ${loadedPackages.length} packages from ${packagesFilePath}`);
    }
    catch (error) {
        console.error(`Failed to load packages.json: ${error}`);
    }
    // --- ctrl 用パッケージリストの読み込み ---
    const ctrlPackagesFilePath = path.join(context.extensionPath, 'data', 'ctrl_packages.json');
    try {
        const ctrlData = fs.readFileSync(ctrlPackagesFilePath, 'utf8');
        ctrlPackages = JSON.parse(ctrlData);
        console.log(`Loaded ${ctrlPackages.length} ctrl packages from ${ctrlPackagesFilePath}`);
    }
    catch (error) {
        console.error(`Failed to load ctrl_packages.json: ${error}`);
    }
    // --- Completion Provider の登録 ---
    // load(" の後に補完をトリガー
    const provider = vscode.languages.registerCompletionItemProvider('rr', {
        provideCompletionItems(document, position) {
            const linePrefix = document.lineAt(position).text.substring(0, position.character);
            console.log(`Current linePrefix: '${linePrefix}'`);
            // load(" のパターンに一致するかどうかをチェック
            // ここでは、"load(\"" または "load( \"" のパターンに一致する文字列を探します
            // 正規表現で、末尾の " の後の部分も考慮します
            const match = linePrefix.match(/(load|import|ctrl)\(\s*\"([^"]*)$/);
            if (!match) {
                console.log('Regex did not match.');
                // load(" のパターンに一致しない場合は補完しない
                return undefined;
            }
            const functionName = match[1]; // "load", "import", または "ctrl"
            // ダブルクォートの内部で入力されたテキスト（元は[1]だった）
            const typedText = match[2];
            console.log(`Regex matched! functionName: '${functionName}', typedText: '${typedText}'`);
            let targetPackages = [];
            // どの関数がトリガーされたかによって、使用するパッケージリストを切り替える
            if (functionName === 'load' || functionName === 'import') {
                targetPackages = loadedPackages;
            }
            else if (functionName === 'ctrl') {
                targetPackages = ctrlPackages;
            }
            else {
                // 想定外の関数名がマッチした場合のログ
                console.warn(`Unexpected function name matched: ${functionName}`);
                return undefined;
            }
            const completionItems = [];
            targetPackages.forEach(pkg => {
                // 入力されたテキストでパッケージ名をフィルタリング
                if (pkg.name.startsWith(typedText)) {
                    const item = new vscode.CompletionItem(pkg.name, vscode.CompletionItemKind.Module); // Moduleはアイコンの種類
                    item.detail = pkg.description; // 補完候補の右側に表示される詳細
                    item.insertText = pkg.name; // 実際に挿入されるテキスト
                    // ここで、挿入されるテキストが "bfct" のように
                    // 引用符の中に入るように調整できます。
                    // insertText は `name` そのものでOKです。
                    // VS Codeが自動的にカーソルを移動させる場合は $0 は不要。
                    console.log(`Adding completion item: ${pkg.name}`);
                    completionItems.push(item);
                }
            });
            console.log(`Returning ${completionItems.length} completion items.`);
            return completionItems;
        }
    }, 
    // トリガー文字を指定。
    // load(" のダブルクォートの後ろで補完がトリガーされるように '\"' を指定。
    // これにより、ユーザーが `load("` と入力した直後に補完がトリガーされます。
    // 必要に応じて、さらに ',' (カンマ) やスペースも追加できます。
    '"');
    context.subscriptions.push(provider);
    // --- Risa/Asir CLI 実行コマンドの登録 ---
    // 'risa-enhancers.executeCode' コマンドを登録します
    let disposableAsirExecute = vscode.commands.registerCommand('risa_enhancers.executeCode', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const document = editor.document;
            const selection = editor.selection;
            // 選択範囲がある場合はそのテキスト、ない場合はドキュメント全体のテキストを取得
            const textToExecute = document.getText(selection.isEmpty ? undefined : selection);
            // WSL上のRisa/Asir実行ファイルのパス。必要に応じて変更してください
            const asirPath = '/usr/local/bin/asir';
            // 出力チャンネルをクリアし、表示
            asirOutputChannel.clear();
            asirOutputChannel.show(true);
            asirOutputChannel.appendLine(`--- Executing Risa/Asir code ---`);
            asirOutputChannel.appendLine(`Input:\n${textToExecute}\n---`);
            // Risa/Asir プロセスを起動
            // WSL上のコマンドを実行する場合、シェルを指定して実行することが推奨されます。
            // `bash -c "asir"` の形式でWSLコマンドを実行し、テキストを標準入力に渡します。
            const process = (0, child_process_1.spawn)('bash', ['-c', `${asirPath}`]);
            // Risa/Asir プロセスの標準入力にコードを書き込む
            process.stdin.write(textToExecute + '\n'); // 最後の改行でコマンド入力を確定させる
            process.stdin.end(); // 入力ストリームを閉じる
            // 標準出力からのデータを受け取り、出力チャンネルに表示
            process.stdout.on('data', (data) => {
                asirOutputChannel.append(data.toString()); // appendLineではなくappendで、改行はRisa/Asirの出力に任せる
            });
            // 標準エラー出力からのデータを受け取り、出力チャンネルに表示（エラーがあった場合）
            process.stderr.on('data', (data) => {
                asirOutputChannel.appendLine(`Error from Risa/Asir: ${data.toString()}`);
            });
            // プロセス終了時の処理
            process.on('close', (code) => {
                if (code !== 0) {
                    // 終了コードが0以外は異常終了
                    asirOutputChannel.appendLine(`--- Risa/Asir process exited with code ${code} (Error) ---`);
                    vscode.window.showErrorMessage(`Risa/Asir execution failed with code ${code}. Check 'Risa/Asir CLI Output' for details.`);
                }
                else {
                    // 正常終了
                    asirOutputChannel.appendLine(`--- Risa/Asir execution finished successfully ---`);
                }
            });
            // プロセス起動エラー（Risa/Asirが見つからないなど）
            process.on('error', (err) => {
                asirOutputChannel.appendLine(`Failed to start Risa/Asir process: ${err.message}`);
                vscode.window.showErrorMessage(`Failed to start Risa/Asir: ${err.message}. Check if Risa/Asir is installed correctly at ${asirPath} in WSL.`);
            });
        }
        else {
            // アクティブなエディタがない場合
            vscode.window.showInformationMessage('No active text editor to execute Risa/Asir code.');
        }
    });
    // 登録したコマンドを拡張機能のサブスクリプションに追加
    context.subscriptions.push(disposableAsirExecute);
    // --- ステータスバーアイテムの作成と登録 ---
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'risa_enhancers.executeCode'; // クリック時に実行されるコマンド
    statusBarItem.text = '$(play) Run Risa/Asir'; // ボタンに表示されるテキスト (アイコンも含む)
    statusBarItem.tooltip = 'Execute Risa/Asir code'; // ホバー時に表示されるツールチップ
    statusBarItem.show(); // ステータスバーアイテムを表示
    context.subscriptions.push(statusBarItem); // 拡張機能終了時にアイテムが非表示になるように登録
    // コード診断の登録
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('risa-enhancers');
    context.subscriptions.push(diagnosticCollection);
    // ドキュメントが開かれたとき、または内容が変更されたときに診断を実行
    vscode.workspace.onDidOpenTextDocument(document => {
        if (document.languageId === 'rr') {
            updateDiagnostics(document, diagnosticCollection);
        }
    }, null, context.subscriptions);
    vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.languageId === 'rr') {
            updateDiagnostics(event.document, diagnosticCollection);
        }
    }, null, context.subscriptions);
}
// コード診断の関数
function updateDiagnostics(document, diagnosticCollection) {
    if (document.languageId !== 'rr') {
        return;
    }
    const text = document.getText();
    const diagnostics = [];
    const openBrackets = { '(': 0, '[': 0, '{': 0 };
    const closeBrackets = { ')': 0, ']': 0, '}': 0 };
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (openBrackets.hasOwnProperty(char)) {
            openBrackets[char]++;
        }
        else if (closeBrackets.hasOwnProperty(char)) {
            closeBrackets[char]++;
        }
    }
    // 簡単な不一致チェック
    if (openBrackets['('] !== closeBrackets[')']) {
        const diagnostic = new vscode.Diagnostic(new vscode.Range(document.positionAt(text.length), document.positionAt(text.length)), '開き括弧と閉じ括弧の数が一致しません', vscode.DiagnosticSeverity.Warning);
        diagnostics.push(diagnostic);
    }
    if (openBrackets['['] !== closeBrackets[']']) {
        const diagnostic = new vscode.Diagnostic(new vscode.Range(document.positionAt(text.length), document.positionAt(text.length)), '開き角括弧と閉じ角括弧の数が一致しません', vscode.DiagnosticSeverity.Warning);
        diagnostics.push(diagnostic);
    }
    if (openBrackets['{'] !== closeBrackets['}']) {
        const diagnostic = new vscode.Diagnostic(new vscode.Range(document.positionAt(text.length), document.positionAt(text.length)), '開き中括弧と閉じ中括弧の数が一致しません', vscode.DiagnosticSeverity.Warning);
        diagnostics.push(diagnostic);
    }
    diagnosticCollection.set(document.uri, diagnostics);
}
// このメソッドは、拡張機能が無効化されたときに呼び出されます。
function deactivate() {
    // クリーンアップ処理などが必要な場合に記述します。
}
//# sourceMappingURL=extension.js.map