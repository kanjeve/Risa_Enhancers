import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
// import * as os from 'os'; 
import { TextDecoder } from 'util';

// パッケージリストの型定義 
interface PackageInfo {
    name: string;
    description: string;
}

interface BracketInfo {
    type: string;
    position: vscode.Position
}

let loadedPackages: PackageInfo[] = []; // パッケージリストを保持する変数 
let ctrlPackages: PackageInfo[] = [];   // ctrl 用のパッケージリスト

// ステータスバーにWSL変更ボタンの追加
let asirModeStatusBarItem: vscode.StatusBarItem;

// 実行中のRisa/Asirプロセスを保持する変数
let currentAsirProcess: ChildProcessWithoutNullStreams | null = null;
// 中断ボタン用のステータスバーアイテム
let asirCancelStatusBarItem: vscode.StatusBarItem;

// ステータスバーアイテムの表示を更新する関数
async function updateStatusBarMode(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('risaasirExecutor');
    const useWsl = config.get<boolean>('useWslFromWindows', false);

    if (process.platform === 'win32') {
        // Windowsの場合のみ、モード切り替えボタンを表示
        if (!asirModeStatusBarItem) {
            asirModeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
            asirModeStatusBarItem.command = 'risa_enhancers.switchExecutionMode'; // クリック時のコマンド
            context.subscriptions.push(asirModeStatusBarItem);
        }

        asirModeStatusBarItem.text = `$(sync) Risa/Asir: ${useWsl ? 'WSL' : 'Windows'}`;
        asirModeStatusBarItem.tooltip = `Click to switch Risa/Asir execution mode to ${useWsl ? 'Windows Native' : 'WSL'}`;
        asirModeStatusBarItem.show();
    } else {
        // Windows以外のOSでは、このモード切り替えボタンは非表示
        if (asirModeStatusBarItem) {
            asirModeStatusBarItem.hide();
        }
    }
}

// 権利表記の非表示
const ASIR_BOOT_MESSAGE_REGEX = /^This is Risa\/Asir,.*?GC \d+\.\d+\.\d+ copyright.*?[\r\n]+/s;

// メインの関数
export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "risa-enhancers" is now active!');

    const asirOutputChannel = vscode.window.createOutputChannel('Risa/Asir CLI Output');
    context.subscriptions.push(asirOutputChannel);

    // --- パッケージリストの読み込み ---
    const packagesFilePath = path.join(context.extensionPath, 'data', 'packages.json');
    try {
        const data = fs.readFileSync(packagesFilePath, 'utf8');
        loadedPackages = JSON.parse(data);
        console.log(`Loaded ${loadedPackages.length} packages from ${packagesFilePath}`);
    } catch (error) {
        console.error(`Failed to load packages.json: ${error}`);
    }

    // --- ctrl 用パッケージリストの読み込み ---
    const ctrlPackagesFilePath = path.join(context.extensionPath, 'data', 'ctrl_packages.json');
    try {
        const ctrlData = fs.readFileSync(ctrlPackagesFilePath, 'utf8');
        ctrlPackages = JSON.parse(ctrlData);
        console.log(`Loaded ${ctrlPackages.length} ctrl packages from ${ctrlPackagesFilePath}`);
    } catch (error) {
        console.error(`Failed to load ctrl_packages.json: ${error}`);
    }

    // --- Completion Provider の登録 ---
    const provider = vscode.languages.registerCompletionItemProvider('rr', {
        provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
            const linePrefix = document.lineAt(position).text.substring(0, position.character);
            const match = linePrefix.match(/(load|import|ctrl)\(\s*\"([^"]*)$/);

            if (!match) {
                return undefined;
            }

            const functionName = match[1];
            const typedText = match[2];
            let targetPackages: PackageInfo[] = [];

            if (functionName === 'load' || functionName === 'import') {
                targetPackages = loadedPackages;
            } else if (functionName === 'ctrl') {
                targetPackages = ctrlPackages;
            } else { 
                return undefined;
            }

            const completionItems: vscode.CompletionItem[] = [];
            targetPackages.forEach(pkg => {
                if (pkg.name.startsWith(typedText)) {
                    const item = new vscode.CompletionItem(pkg.name, vscode.CompletionItemKind.Module);
                    item.detail = pkg.description;
                    item.insertText = pkg.name;
                    completionItems.push(item);
                }
            });
            return completionItems;
        }
    }, '"');
    context.subscriptions.push(provider);

    // --- Risa/Asir CLI 実行コマンドの登録 ---
    let disposableAsirExecute = vscode.commands.registerCommand('risa_enhancers.executeCode', async () => { 
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const document = editor.document;
            const selection = editor.selection;
            const textToExecute = document.getText(selection.isEmpty ? undefined : selection);

            // 拡張機能の設定からRisa/Asirのパスを取得
            let command: string;
            let args: string[] = [];
            let displayMessage: string;
            let spawnOptions: { shell?: boolean; maxBuffer?: number } = {};

            // VS Codeの設定から、WSL経由実行の希望とディストリビューション名を取得
            const config = vscode.workspace.getConfiguration('risaasirExecutor');

            // OSを判定
            const currentOsPlatform = process.platform;

            // 実行中のプロセスがある場合は、新しい実行を開始する前にキャンセルを促す。
            if (currentAsirProcess) {
                vscode.window.showWarningMessage('Risa/Asir is already running. Please cancel the current execution first.', 'Cancel' )
                    .then(selection => {
                        if (selection === 'Cancel') {
                            vscode.commands.executeCommand('risa_enhancers.cancelExecution');
                        }
                    });
                return;
            }

            if (currentOsPlatform === 'win32') {
                // Windowsの場合 
                const useWslFromWindows = config.get<boolean>('useWslFromWindows',false);
                if (useWslFromWindows) {
                    // Windows上でWSL経由で実行する場合
                    const wslDistribution = config.get<string>('wslDistribution', 'Ubuntu');
                    const asirPathLinux = config.get<string>('asirPathLinux');

                    command = 'wsl'; // wsl を直接呼び出す
                    const asirCommandWithQuiet = `${asirPathLinux || 'asir'} -quiet`;
                    const wslCommand = `${asirCommandWithQuiet} <<'EOF'\n${textToExecute}\nquit$\nEOF`; // WSL内のパスを取得
                    // WSLコマンド: wsl -d <distro_name> <command_to_run_in_wsl>
                    args = ['-d', wslDistribution, `bash`, '-c', wslCommand];
                    displayMessage = `Executing Risa/Asir WSL (${wslDistribution})...`;
                } else {
                    // Windows上でWindowsネイティブのRisa/Asirを実行する場合
                    const asirPathWindows = config.get<string>('asirPathWindows');
                    command =`"${ asirPathWindows || 'asir.exe'}"`;
                    args = [];
                    displayMessage = 'Executing Risa/Asir on Windows natively...';
                    spawnOptions.shell = true;
                }
            } else if (currentOsPlatform === 'darwin') {
                // macOSの場合
                const asirPathMac = config.get<string>('asirPathMac');
                command = asirPathMac || 'asir'; // 設定がなければデフォルトのasirを試す
                args = []; // コマンドライン引数は基本的に不要
                displayMessage = 'Executing Risa/Asir on macOS...';
                spawnOptions.shell = true;
            } else if (currentOsPlatform === 'linux') {
                // Linuxの場合 (WSLを含む)
                const asirPathLinux = config.get<string>('asirPathLinux');
                // WSLで実行する場合は、bash -c "asirPath" の形式を使う
                command = 'bash';
                const linuxCommand = `${asirPathLinux || 'asir'} <<'EOF'\n${textToExecute}\nquit$\nEOF`;
                args = ['-c', linuxCommand]; // 設定がなければデフォルトのasirを試す
                displayMessage = 'Executing Risa/Asir on Linux...';
            } else {
                vscode.window.showErrorMessage(`Unsupported OS platform: ${currentOsPlatform}`);
                return;
            }

            spawnOptions.maxBuffer = 1024*1024*100;

            asirOutputChannel.clear();
            asirOutputChannel.show(true);
            asirOutputChannel.appendLine(`---${displayMessage} ---`);
            // asirOutputChannel.appendLine(`Command: ${command} ${args.join(' ')}`);
            // asirOutputChannel.appendLine(`Input:\n${textToExecute}\n---`);

            // Risa/Asirの出力を蓄積する変数
            let outputAccumulator = ''; // 標準出力
            let errorAccumulator = ''; // エラー出力

            try {
                // WindwsとmacOSの場合はstdinにコマンドを流し込む
                const asirProcess = spawn(command, args, spawnOptions);

                currentAsirProcess = asirProcess;
                asirCancelStatusBarItem.show();

                if ((currentOsPlatform === 'win32' && !config.get<boolean>('useWslFromWindows')) || currentOsPlatform === 'darwin') {
                    const fullCommand = textToExecute + '\nquit$\n';
                    asirProcess.stdin.write(fullCommand);
                    asirProcess.stdin.end();
                }

                asirProcess.stdout.on('data', (data: Buffer) => {
                    let decodedString: string;
                    if (currentOsPlatform === 'win32') {
                        decodedString = new TextDecoder('shift-jis').decode(data);
                        // asirOutputChannel.append(decodedString);
                    } else {
                        decodedString = data.toString();
                    }

                    outputAccumulator += decodedString;
                    // asirOutputChannel.append(decodedString);
                });

                asirProcess.stderr.on('data', (data: Buffer) => {
                    let errorString: string;
                    if (currentOsPlatform === 'win32') {
                        errorString = new TextDecoder('shift-jis').decode(data);
                    } else {
                        errorString = data.toString();
                    }

                    errorAccumulator += errorString; // ここでエラー蓄積

                    // if (!errorString.includes('Calling the registered quit callbacks...done.')) {
                        asirOutputChannel.appendLine(`Error from Risa/Asir: ${errorString}`);
                    // }
                });

                let finalErrorMessage = errorAccumulator;

                // 特定の終了メッセージをフィルタリング
                const quitMessage = "Calling the registered quit callbacks...done.\r\n"; // 末尾の改行も含む
                if (finalErrorMessage.includes(quitMessage)) {
                    finalErrorMessage = finalErrorMessage.replace(quitMessage, '').trim();
                }

                asirProcess.on('close', (code) => {
                    if (code !== 0) {
                        asirOutputChannel.appendLine(`--- Risa/Asir process exited with code ${code} (Error) ---`);
                        vscode.window.showErrorMessage(`Risa/Asir execution failed with code ${code}. Check 'Risa/Asir CLI Output' for details.`);

                        if (outputAccumulator.length > 0) {
                            asirOutputChannel.appendLine(`--- Risa/Asir Standard Output (Error Context) ---`);
                            asirOutputChannel.append(outputAccumulator);
                            asirOutputChannel.appendLine(`--- End of Standard Output (Error Context) ---`);
                        }
                    } else {
                        asirOutputChannel.appendLine(`--- Risa/Asir execution finished successfully ---`);

                        let filteredOutput = outputAccumulator;
                        filteredOutput = filteredOutput.replace(ASIR_BOOT_MESSAGE_REGEX, '');

                        createResultWebview(context, textToExecute, filteredOutput, finalErrorMessage);
                    }
                    currentAsirProcess = null;
                    asirCancelStatusBarItem.hide();
                });

                asirProcess.on('error', (err) => {
                    asirOutputChannel.appendLine(`Failed to start Risa/Asir process: ${err.message}`);
                    vscode.window.showErrorMessage(`Failed to start Risa/Asir: ${err.message}. Check if Risa/Asir is installed correctly and path is set in settings.`);
                    currentAsirProcess = null;
                    asirCancelStatusBarItem.hide();
                });

            } catch (err: any) { 
                asirOutputChannel.appendLine(`General error during Risa/Asir execution: ${err.message}`);
                vscode.window.showErrorMessage(`An unexpected error occurred during Risa/Asir execution: ${err.message}`);
                currentAsirProcess = null;
                asirCancelStatusBarItem.hide();
            }

        } else {
            vscode.window.showInformationMessage('No active text editor to execute Risa/Asir code.');
        }
    });

    context.subscriptions.push(disposableAsirExecute);

        // --- 実行モードを切り替えるコマンド ---
    let disposableToggleMode = vscode.commands.registerCommand('risa_enhancers.switchExecutionMode', async () => {
        const config = vscode.workspace.getConfiguration('risaasirExecutor');
        const currentModeIsWsl = config.get<boolean>('useWslFromWindows', false);
        const newModeIsWsl = !currentModeIsWsl; // 現在のモードを反転

        await config.update('useWslFromWindows', newModeIsWsl, vscode.ConfigurationTarget.Workspace);

        // 設定が更新されたので、ステータスバーを再描画
        updateStatusBarMode(context);

        vscode.window.showInformationMessage(`Risa/Asir execution mode switched to: ${newModeIsWsl ? 'WSL' : 'Windows Native'}`);
    });
    context.subscriptions.push(disposableToggleMode);

    // --- 実行をキャンセルするコマンド ---
    let disposableCancelExecution = vscode.commands.registerCommand('risa_enhancers.cancelExecution', () => {
        if (currentAsirProcess) {
            const platform = process.platform;
            let killedSuccessfully = false;

            // プロセスを終了させるロジック
            if (platform === 'win32') {
                // Windowsの場合: taskkill コマンドを使う
                try {
                    spawn('taskkill', ['/F', '/T', '/PID', currentAsirProcess.pid!.toString()], { shell: true });
                    killedSuccessfully = true;
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Failed to kill Risa/Asir process on Windows: ${e.message}`);
                }
            } else {
                // Linux/macOSの場合: SIGTERMを送る
                try {
                    currentAsirProcess.kill('SIGTERM'); // SIGTERMを送る
                    killedSuccessfully = true;
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Failed to kill Risa/Asir process on Linux/macOS: ${e.message}`);
                }
            }

            if (killedSuccessfully) {
                asirOutputChannel.appendLine(`--- Risa/Asir execution cancelled ---`);
                vscode.window.showInformationMessage('Risa/Asir execution has been cancelled.');
                currentAsirProcess = null; // プロセス参照をクリア
                asirCancelStatusBarItem.hide(); // キャンセルボタンを非表示
            }
        } else {
            vscode.window.showInformationMessage('No Risa/Asir process is currently running.');
        }
    });
    context.subscriptions.push(disposableCancelExecution);

    // --- executeCodeのステータスバーアイテム ---
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'risa_enhancers.executeCode';
    statusBarItem.text = '$(play) Run Risa/Asir';
    statusBarItem.tooltip = 'Execute Risa/Asir code';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem)

    // --- cancelExecutionのステータスバーアイテム ---
    asirCancelStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99); // 実行ボタンの左に表示されるように優先度を調整
    asirCancelStatusBarItem.command = 'risa_enhancers.cancelExecution';
    asirCancelStatusBarItem.text = '$(stop) Cancel Risa/Asir';
    asirCancelStatusBarItem.tooltip = 'Click to cancel current Risa/Asir execution';
    // 最初は非表示にしておく
    asirCancelStatusBarItem.hide();
    context.subscriptions.push(asirCancelStatusBarItem);

    updateStatusBarMode(context);

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('risaasirExecutor.useWslFromWindows')){
            updateStatusBarMode(context);
        }
    }));

    // --- コード診断の登録  ---
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('risa-enhancers');
    context.subscriptions.push(diagnosticCollection);

    vscode.workspace.onDidOpenTextDocument(document => {
        if (document.languageId === 'rr') {
            updateDiagnosticsAdvanced(document, diagnosticCollection);
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.languageId === 'rr') {
            updateDiagnosticsAdvanced(event.document, diagnosticCollection);
        }
    }, null, context.subscriptions);

    let disposableHelloWorld = vscode.commands.registerCommand('risa-enhancers.helloWorld', () => {
        vscode.window.showInformationMessage('Hello VS Code from Risa Enhancers!');
    });
    context.subscriptions.push(disposableHelloWorld);
}

// コード診断の関数 
function updateDiagnosticsAdvanced(document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection): void {
    if (document.languageId !== 'rr') {
        return;
    }

    const text = document.getText();
    const diagnostics: vscode.Diagnostic[] = [];
    const stack: BracketInfo[] = [];
    const bracketRegex = /(\(|\)|\[|\]|\{|\})/g;
    let match;

    while ((match = bracketRegex.exec(text)) !== null) {
        const bracket = match[0];
        const position = document.positionAt(match.index);

        if (bracket === '(' || bracket === '[' || bracket === '{') {
            stack.push({ type: bracket, position });
        } else if (bracket === ')' || bracket === ']' || bracket === '}') {
            if (stack.length === 0) {
                // 対応する開き括弧がない
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(position, position.translate(0, 1)),
                    `対応する開き括弧がありません: ${bracket}`,
                    vscode.DiagnosticSeverity.Error
                ));
            } else {
                const lastOpenBracket = stack.pop(); // lastOpenBracketはBracketInfo | undefined の型になる
                
                // ここで lastOpenBracket が undefined でないことを保証
                if (lastOpenBracket) { 
                    if (!isMatchingBracket(lastOpenBracket.type, bracket)) {
                        // Type mismatch (incorrect nesting)
                        diagnostics.push(new vscode.Diagnostic(
                            new vscode.Range(position, position.translate(0, 1)),
                            `不正なネスト: '${bracket}' は '${lastOpenBracket.type}' と対応していません`,
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                } else {
                    // スタックが空なのにポップしようとした、というロジック上の矛盾がある場合
                    diagnostics.push(new vscode.Diagnostic(
                        new vscode.Range(position, position.translate(0, 1)),
                        `予期せぬエラー: スタックが空なのにポップされました。`,
                        vscode.DiagnosticSeverity.Error
                    ));
                }
            }
        }
    }

    // 閉じられていない開き括弧のチェック
    while (stack.length > 0) {
        const openBracket = stack.pop();
        if (openBracket) { // ここで openBracket が undefined でないことを保証
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(openBracket.position, openBracket.position.translate(0, 1)),
                `開き括弧 '${openBracket.type}' が閉じられていません`,
                vscode.DiagnosticSeverity.Error
            ));
        }
    }

    diagnosticCollection.set(document.uri, diagnostics);
}

function isMatchingBracket(open: string, close: string): boolean {
    return (open === '(' && close === ')') ||
           (open === '[' && close === ']') ||
           (open === '{' && close === '}');
}

// Webviewの関数
/**
 * Risa/Asirの結果を表示するための Webview を作成・表示。
 * @param context 拡張機能コンテキスト
 * @param inputCode 実行したRisa/Asirのコード
 * @param outputResult Risa/Asirの計算結果
 */
function createResultWebview(context: vscode.ExtensionContext, inputCode: string, outputResult: string, errorResult: string) {
    const panel = vscode.window.createWebviewPanel(
        'risaasirResult',
        'Risa/Asir Result',
        vscode.ViewColumn.Beside,
        {
            enableScripts: false, // JavaScriptを使う場合はtrue
            localResourceRoots: [
                vscode.Uri.file(path.join(context.extensionPath, 'media')) // CSS/JSファイルをロードできるようにする。
            ]
        }
    );

    panel.webview.html = getWebviewContent(inputCode, outputResult, errorResult);

    panel.onDidDispose(() =>{}, null, context.subscriptions);
}
/**
 * Webviewに表示するHTMLコンテンツの生成
 * @param inputCode 実行したRisa/Asir のコード
 * @param outputResult Risa/Asirの計算結果
 * @returns HTML 文字列
 */

function getWebviewContent(inputCode:string, outputResult: string, errorResult: string): string {
    // 入力コードと出力結果に含まれるHTML特殊文字を安全に表示させる。
    const escapedInputCode = inputCode.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapedOutputResult = outputResult.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapedErrorResult = errorResult.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let errorSectionHtml = '';
    if (escapedErrorResult.trim().length > 0){
        errorSectionHtml = `
            <div class="section">
                <h2>Risa/Asir Error Message</h2>
                <div class="code-block error-block">
                    <div class="content-wrapper">
                        <pre>${escapedErrorResult}</pre>
                    </div>
                </div>
            </div>`;
    }

    const finalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Risa/Asir Result</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 1.5em; line-height: 1.6; }
        h1, h2 { color: var(--vscode-editor-foreground); }
        .section { margin-bottom: 2em; }
        .code-block {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-editorGroup-border);
            border-radius: 4px;
            padding: 1em;
            overflow-x: auto; /* 横スクロールを可能にする */
            /* font-family: 'SF Mono', Monaco, Consolas, 'Courier New', monospace; */
            /* white-space: pre; */
            /* word-wrap: normal; */
            color: var(--vscode-editor-foreground);
        }
        .code-block pre {
            font-family: 'SF Mono', Monaco, Consolas, 'Courier New', monospace;
            white-space: pre; /* 念のため明示的に指定 */
            word-wrap: normal; /* 念のため明示的に指定 */
            margin: 0; /* <pre> タグのデフォルトのマージンをリセット */
            padding: 0;
            text-align: left;
        }
        /* VS Code のテーマカラーを継承 */
        body {
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        /* エラーメッセージ用のスタイル */
        .error-block { /* エラーブロック専用のスタイル */
            border-color: var(--vscode-errorForeground); /* エラー色で枠を強調 */
            background-color: var(--vscode-terminal-ansiBrightBlack); /* 必要であれば背景色も変更 */
        }
        .error-block pre { /* エラーブロック内のテキストスタイル */
            color: var(--vscode-errorForeground);
            font-weight: bold;
        }
    </style>
</head>
<body>
    <h1>Risa/Asir Computation Result</h1>

    ${errorSectionHtml}

    <div class="section">
        <h2>Input Code</h2>
        <div class="code-block">
            <div class="content-wrapper"> 
                <pre>${escapedInputCode}</pre>
            </div>
        </div>
    </div>

    <div class="section">
        <h2>Output Result</h2>
        <div class="code-block">
            <div class="content-wrapper"> 
                <pre>${escapedOutputResult}</pre>
            </div>
        </div>
    </div>
</body>
</html>`;

    return finalHtml;
}

export function deactivate() {
    if (asirModeStatusBarItem){
        asirModeStatusBarItem.dispose();  // 拡張機能終了時にアイテムを解法
    }
    if (asirCancelStatusBarItem) {
        asirCancelStatusBarItem.dispose();
    }
    // 拡張機能終了時に実行中のプロセスがあれば強制終了
    const globalOsPlatform = process.platform;
    if (currentAsirProcess) {
        if (globalOsPlatform === 'win32') {
            spawn('taskkill', ['/F', '/T', '/PID', currentAsirProcess.pid!.toString()], { shell: true });
        } else {
            currentAsirProcess.kill('SIGKILL'); 
        }
    }
}