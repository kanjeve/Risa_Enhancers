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
let loadedPackages = []; // パッケージリストを保持する変数
let ctrlPackages = []; // ctrl 用のパッケージリスト
// このメソッドは、拡張機能がアクティブ化されたときに呼び出されます。
// activationEvents に定義されたイベントが発生したときに実行されます。
function activate(context) {
    // コンソールにメッセージを出力して、拡張機能がアクティブ化されたことを確認できます。
    console.log('Congratulations, your extension "risa-enhancers" is now active!');
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
    // ここからコード診断を登録する。
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
    // 例: コマンドを登録する（テスト用）
    let disposable = vscode.commands.registerCommand('risa-enhancers.helloWorld', () => {
        vscode.window.showInformationMessage('Hello VS Code from Risa Enhancers!');
    });
    context.subscriptions.push(provider);
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