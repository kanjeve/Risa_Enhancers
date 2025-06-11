import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
// import * as os from 'os'; 
import { /*isFunction,*/ TextDecoder } from 'util';
import { ASIR_KEYWORDS, ASIR_BUILTIN_FUNCTIONS } from "./builtins";
import { ctrlc } from 'ctrlc-windows';
import { rejects } from 'assert';
// import { start } from 'repl';
// import { isBuiltin } from 'module';

// パッケージリストの型定義 
interface PackageInfo {
    name: string;
    description: string;
}

interface BracketInfo {
    type: string;
    position: vscode.Position
}

interface SymbolInfo {
    name: string;
    type: 'variable' | 'function' |'parameter';
    definitionRange?: vscode.Range;
}

let loadedPackages: PackageInfo[] = []; // パッケージリストを保持する変数 
let ctrlPackages: PackageInfo[] = [];   // ctrl 用のパッケージリスト

// 定義済みを保持するためのもの（コード診断用）
let currentDefinedSymbols: Map<string, SymbolInfo> = new Map();

// ステータスバーにWSL変更ボタンの追加
let asirModeStatusBarItem: vscode.StatusBarItem;
let asirOutputChannel: vscode.OutputChannel;
let isDebuggingModeQuitSent: boolean = false;

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

// メインの関数
export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "risa-enhancers" is now active!');

    asirOutputChannel = vscode.window.createOutputChannel('Risa/Asir CLI Output');
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

            isDebuggingModeQuitSent = false;

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
                    command =`"${ asirPathWindows || 'asir.exe'}" -quiet`;
                    args = [];
                    displayMessage = 'Executing Risa/Asir on Windows natively...';
                    spawnOptions.shell = true;
                }
            } else if (currentOsPlatform === 'darwin') {
                // macOSの場合
                const asirPathMac = config.get<string>('asirPathMac');
                command = `${asirPathMac || 'asir'} -quiet`; // 設定がなければデフォルトのasirを試す
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

                // デバッグモード検出用の設定
                const debugModePromptRegex = /^\(debug\)\s*$/m;
                let lastOutputChunk = '';

                asirProcess.stdout.on('data', (data: Buffer) => {
                    let decodedString: string;
                    if (currentOsPlatform === 'win32') {
                        decodedString = new TextDecoder('shift-jis').decode(data);
                        // asirOutputChannel.append(decodedString);
                    } else {
                        decodedString = data.toString();
                    }

                    outputAccumulator += decodedString;
                    asirOutputChannel.append(decodedString);

                    // デバッグモードを検出
                    if (!isDebuggingModeQuitSent) {
                    const recentOutput = lastOutputChunk + decodedString;
                    if (recentOutput.match(debugModePromptRegex)) {
                        console.log('Risa/Asir entered debug mode (stdout). Sending "quit" command...');
                        asirProcess.stdin.write('quit\n');
                        isDebuggingModeQuitSent = true;
                        vscode.window.showWarningMessage('Risa/Asir entered debug mode due to an error. Attempting to quit automatically.');
                    }
                }
                lastOutputChunk = decodedString; 
                });

                asirProcess.stderr.on('data', (data: Buffer) => {
                    let errorString: string;
                    if (currentOsPlatform === 'win32') {
                        errorString = new TextDecoder('shift-jis').decode(data);
                    } else {
                        errorString = data.toString();
                    }

                    errorAccumulator += errorString; // ここでエラー蓄積
                    asirOutputChannel.appendLine(`Error from Risa/Asir: ${errorString}`);

                    // 念のため
                    if (!isDebuggingModeQuitSent) {
                        if (errorString.match(debugModePromptRegex)) {
                            console.log('Risa/Asir entered debug mode (stderr). Sending "quit" command...');
                            asirProcess.stdin.write('quit\n');
                            isDebuggingModeQuitSent = true;
                            vscode.window.showWarningMessage('Risa/Asir entered debug mode due to an error. Attempting to quit automatically.');
                        }
                    }
                });

                asirProcess.on('close', (code) => {
                    currentAsirProcess = null;
                    asirCancelStatusBarItem.hide();
                    let finalErrorMessage = errorAccumulator;

                    // 特定の終了メッセージをフィルタリング
                    const quitMessage = /(Calling the registered quit callbacks\.\.\.done\.[\r\n]+)|(return to toplevel[\r\n]*)/g;
                    if (finalErrorMessage.match(quitMessage)) {
                        finalErrorMessage = finalErrorMessage.replace(quitMessage, '').trim();
                    }

                    if (code !== 0 && !isDebuggingModeQuitSent) {
                        asirOutputChannel.appendLine(`--- Risa/Asir process exited with code ${code} (Error) ---`);
                        vscode.window.showErrorMessage(`Risa/Asir execution failed with code ${code}. Check 'Risa/Asir CLI Output' for details.`);

                        if (outputAccumulator.length > 0) {
                            asirOutputChannel.appendLine(`--- Risa/Asir Standard Output (Error Context) ---`);
                            asirOutputChannel.append(outputAccumulator);
                            asirOutputChannel.appendLine(`--- End of Standard Output (Error Context) ---`);
                        }
                    } else {
                        asirOutputChannel.appendLine(`--- Risa/Asir execution finished successfully ---`);

                    }
                    createResultWebview(context, textToExecute, outputAccumulator, finalErrorMessage);
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

    // 2. キャンセル実行コマンドの登録
    registerCancelExecutionCommand(context); // これを追加
    // もし registerCancelExecutionCommand 関数が disposable を返すなら:
    // context.subscriptions.push(registerCancelExecutionCommand(context));

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
    context.subscriptions.push(asirOutputChannel,asirCancelStatusBarItem);

    updateStatusBarMode(context);

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('risaasirExecutor.useWslFromWindows')){
            updateStatusBarMode(context);
        }
    }));

    // --- コード診断の登録  ---
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('risa-enhancers');
    context.subscriptions.push(diagnosticCollection);

    const triggerDiagnostics = (document: vscode.TextDocument) => {
        if (document.languageId === 'rr') {
            currentDefinedSymbols = updateDiagnosticsComprehensive(document, diagnosticCollection);
        }
    }
    vscode.workspace.onDidOpenTextDocument(document => {
        triggerDiagnostics(document);
    }, null, context.subscriptions);
    vscode.workspace.onDidChangeTextDocument(event => {
        triggerDiagnostics(event.document);
    }, null, context.subscriptions);
    if (vscode.window.activeTextEditor) {
        triggerDiagnostics(vscode.window.activeTextEditor.document);
    }

    // completionItemProviderの登録
    const CompletionProvider = vscode.languages.registerCompletionItemProvider(
        { scheme: 'file', language: 'rr'},
        {
            provideCompletionItems(document: vscode.TextDocument, position: vscode.Position,token: vscode.CancellationToken, content: vscode.CompletionContext) {
                const linePrefix = document.lineAt(position).text.substring(0, position.character);
                const lastWordMatch = linePrefix.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)$/);
                const lastWord = lastWordMatch ? lastWordMatch[1] : '';
                const completionItems: vscode.CompletionItem[] = [];

                // 定義済みシンボルからの補完
                currentDefinedSymbols.forEach((symbol, name) => {
                    if (name.startsWith(lastWord)) {
                        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);
                        if (symbol.type === 'function') {
                            item.kind = vscode.CompletionItemKind.Function;
                            item.insertText = new vscode.SnippetString(`${name}(${symbol.definitionRange ? symbol.definitionRange.start.line + 1 : ''})$0`);
                            item.detail = `Asir関数 ${name}`;
                            item.documentation = new vscode.MarkdownString(`\`\`\`asir\ndef ${name}(${symbol.definitionRange ? symbol.definitionRange.start.line + 1 : ''}) { ... }\`\`\`\n\n${name} はユーザー定義関数です。`);
                        } else if (symbol.type === 'variable') {
                            item.kind = vscode.CompletionItemKind.Variable;
                            item.detail = `Asir変数 ${name}`;
                        } else if (symbol.type === 'parameter') {
                            item.kind = vscode.CompletionItemKind.Property;
                            item.detail = `関数引数 ${name}`;
                        }
                        completionItems.push(item);
                    }
                });

                // 組み込み関数からの補完
                ASIR_BUILTIN_FUNCTIONS.forEach(funcName => {
                    if (funcName.startsWith(lastWord)) {
                        const item = new vscode.CompletionItem(funcName, vscode.CompletionItemKind.Function);
                        item.detail = `Asir組み込み関数 ${funcName}`;
                        item.insertText = new vscode.SnippetString(`${funcName}($0)`);
                        completionItems.push(item);
                    }
                });

                // キーワードからの補完
                ASIR_KEYWORDS.forEach(keyword => {
                    if (keyword.startsWith(lastWord)) {
                        const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
                        item.detail = `Asir文`;
                        completionItems.push(item);
                    }
                });
                return completionItems;
            }
        },
        '.',
        '('
    );
    context.subscriptions.push(CompletionProvider);

    let disposableHelloWorld = vscode.commands.registerCommand('risa-enhancers.helloWorld', () => {
        vscode.window.showInformationMessage('Hello VS Code from Risa Enhancers!');
    });
    context.subscriptions.push(disposableHelloWorld);
}

// キャンセルコマンドのサポート関数
async function interruptAsirProcess(process: ChildProcessWithoutNullStreams, osPlatform: NodeJS.Platform): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
        let timer: NodeJS.Timeout;
        let listenerActive = false;
        let receivedInterruptPrompt = false;
        let receivedAbortPrompt = false;
        let interruptOutputBuffer = '';
        const WINDOWS_CTRL_C_EXTIT_CODE = 3221225786;

        const cleanup = () => {
            clearTimeout(timer);
            if (listenerActive) {
                process.stdout.off('data', stdoutListener);
                process.stderr.off('data', stderrListener);
            }
        };
        const stdoutListener = (data: Buffer) => {
            const output = data.toString();
            asirOutputChannel.append(output);
            interruptOutputBuffer += output;

            if (osPlatform === 'win32') {
                const interruptPromptRegex = /interrupt\s*\?(q|t|c|d|u|w|\?)/;
                const abortPromptRegex = /Abort this computation\?\s*\(y or n\)/;
                if (!receivedInterruptPrompt && output.match(interruptPromptRegex)) {
                    receivedInterruptPrompt = true;
                    console.log('Risa/ASir: Reseived "interrupt ?" prompt. Sending "u" to abort current computation.');
                    process.stdin.write('u\n');
                    interruptOutputBuffer = '';
                } else if (receivedInterruptPrompt && !receivedInterruptPrompt && output.match(abortPromptRegex)) {
                    receivedAbortPrompt = true;
                    console.log('Risa/Asir: Received "Abort this computation?" prompt. Sending "y" to confirm abort.');
                    process.stdin.write('y\n');
                    cleanup();
                    resolve();
                    interruptOutputBuffer = '';
                }
            }
        };
        // 念のため
        const stderrListener = (data: Buffer) => {
            const errorOutput = data.toString();
            asirOutputChannel.appendLine(`Error during interrupt: ${errorOutput}`);
        };
        // プロセスが終了したとき
        const closeListener = (code: number) => {
            cleanup();
            if (code === 0 || code === WINDOWS_CTRL_C_EXTIT_CODE) {
                resolve();
            } else {
                reject(new Error(`Risa/Asir process exited with code ${code} unexpectedly during interrupt.`));
            }
        };
        process.stdout.on('data', stdoutListener);
        process.stderr.on('data', stderrListener);
        process.once('close', closeListener);
        listenerActive = true;

        // タイムアウトの設定
        timer = setTimeout(() => {
            cleanup();
            reject(new Error('Risa/Asir did not respond to interrupt prompts within the timeout.'));
        }, 15000);

        // Ctrl+Cの送信
        if (osPlatform === 'win32') {
            try {
                if (process.pid) {
                    ctrlc(process.pid);
                    console.log(`sent Ctrl+C to Risa/Asir process (PID: ${process.pid}) via ctrl-windows.`);
                } else {
                    throw new Error("Risa/Asir process PID not found for Ctrl+C.");
                }
            } catch (e: any){
                cleanup();
                reject(new Error(`Failed to send Ctrl+C on Windows: ${e.message}`));
            }
        } else {
            process.kill('SIGINT');
            console.log('Sent SIGINT to Risa/Asir process.');
        }
    });
}
// キャンセルコマンドの関数
export function registerCancelExecutionCommand(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('risa_enhancers.cancelExecution', async () => {
        if (!currentAsirProcess) {
            vscode.window.showInformationMessage('No Risa/Asir process is currently running to cancel.');
            return;
        }
        vscode.window.showInformationMessage('Attempting to interrupt Risa/Asir calculation. Please wait...');
        asirOutputChannel.appendLine(`--- Interrupting Risa/Asir process... ---`);

        try {
            await interruptAsirProcess(currentAsirProcess, process.platform);
            vscode.window.showInformationMessage('Risa/Asir calculation successfully interrupted.');
            asirOutputChannel.appendLine(`--- Risa/Asir process successfully interrupted ---`);
        } catch (error: any) {
            console.error('Error during Risa/Asir interruption:', error);
            vscode.window.showErrorMessage(`Failed to interrupt Risa/Asir: ${error.message}. Attempting forced termination.`);
            asirOutputChannel.appendLine(`--- Forced termination of Risa/Asir process... ---`);

            // タイムアウトなどで中断できなかった場合、最終手段として強制終了
            if (currentAsirProcess) {
                if (process.platform === 'win32') {
                    const cp = require('child_process');
                    try {
                        cp.execSync(`taskkill /F /T /PID ${currentAsirProcess.pid}`);
                        vscode.window.showInformationMessage('Risa/Asir process forced terminated.');
                        asirOutputChannel.appendLine(`--- Risa/Asir process forced terminated ---`);
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Failed to force terminate Risa/Asir: ${e.message}`);
                        asirOutputChannel.appendLine(`--- Failed to force terminate: ${e.message} ---`);
                    }
                } else {
                    currentAsirProcess.kill('SIGKILL');
                    vscode.window.showInformationMessage('Risa/Asir process forced terminated.');
                    asirOutputChannel.appendLine(`--- Risa/Asir process forced terminated ---`);
                }
            }
        } finally {
            // プロセスが終了したら、ステータスバーアイテムを隠す
            currentAsirProcess = null;
            asirCancelStatusBarItem.hide();
        }
    });
}

// コード診断の関数 
function updateDiagnosticsComprehensive(document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection): Map<string, SymbolInfo> {
    if (document.languageId !== 'rr') {
        return new Map();
    }

    const text = document.getText();
    const diagnostics: vscode.Diagnostic[] = [];
    const definedSymbols = new Map<string, SymbolInfo>();

    // --- 括弧の不一致チェック
    const stack: BracketInfo[] = [];
    const bracketRegex = /(\(|\)|\[|\]|\{|\})/g;
    let brancketMatch;

    while ((brancketMatch = bracketRegex.exec(text)) !== null) {
        const bracket = brancketMatch[0];
        const position = document.positionAt(brancketMatch.index);

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
        if (openBracket) { 
            diagnostics.push(new vscode.Diagnostic(
                new vscode.Range(openBracket.position, openBracket.position.translate(0, 1)),
                `開き括弧 '${openBracket.type}' が閉じられていません`,
                vscode.DiagnosticSeverity.Error
            ));
        }
    }

    // ---未定義変数・関数の検出
    const rawUsedIdentifiers: { name: string, range: vscode.Range, originalLine: string, originalIndex: number }[] = [];

    const functionDefinitionRegex = /\bdef\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*\{/g; 
    const assignmentRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g; 
    const allIdentifiersInLineRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    const functionDeclarationRegex = /\bfunction\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*;/g;
    const externDeclarationRegex = /\bextern\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*;/g; 


    // コメントを除外するためのパターン
    const lineCommentRegex = /#.*/g;
    const blockCommentRegex = /\/\*[\s\S]*?\*\//g;

    const lines = text.split('\n');
    lines.forEach((lineText, lineNum) =>{
        let cleanLine = lineText;

        // コメントを除去
        cleanLine = cleanLine.replace(blockCommentRegex, '');
        cleanLine = cleanLine.replace(lineCommentRegex,'')

        assignmentRegex.lastIndex = 0;
        functionDefinitionRegex.lastIndex = 0;
        allIdentifiersInLineRegex.lastIndex = 0;
        functionDeclarationRegex.lastIndex = 0;
        externDeclarationRegex.lastIndex = 0;

        // --変数定義の検出と変数名規則のチェック
        // 代入分を検出してその左辺が大文字始まりかをチェックする。
        let assignMatch: RegExpExecArray | null;
        while ((assignMatch = assignmentRegex.exec(cleanLine)) !== null){
            const varName = assignMatch[1];
            const startPos = document.positionAt(document.offsetAt(new vscode.Position(lineNum, assignMatch.index)));
            const endPos = startPos.translate(0, varName.length);

            if (varName.match(/^[a-z]/)) {
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(startPos, endPos),
                    `変数名は '${varName}' は大文字ので始まる必要があります。`,
                    vscode.DiagnosticSeverity.Error
                ));
            }
            if (varName.match(/^[A-Z]/)) {
                definedSymbols.set(varName, { name: varName, type: 'variable', definitionRange: new vscode.Range(startPos, endPos) });
            }
        }

        // --- 関数定義の検出
        let funcDefMatch: RegExpExecArray | null;
        while ((funcDefMatch = functionDefinitionRegex.exec(cleanLine)) !== null) {
            const funcName = funcDefMatch[1];
            const funcNameStartInMatch = funcDefMatch[0].indexOf(funcName);
            const startPos = document.positionAt(document.offsetAt(new vscode.Position(lineNum, funcDefMatch.index + funcNameStartInMatch)));
            const endPos = startPos.translate(0, funcName.length);
            
            // 関数小文字始まりチェック
            if (funcName.match(/^[A-Z]/)) {
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(startPos, endPos),
                    `関数名 '${funcName}' は小文字のアルファベットで始まる必要があります。`,
                    vscode.DiagnosticSeverity.Error
                ));
            } else {
                definedSymbols.set(funcName, { name: funcName, type: 'function', definitionRange: new vscode.Range(startPos, endPos) });
            }

            // 仮引数を抽出して定義済みシンボルとして扱う
            const parameterString = funcDefMatch[2];
            if (parameterString) {
                const paramNames = parameterString.split(',').map(p => p.trim()).filter(p => p.length > 0);
                paramNames.forEach(paramName => {
                    // 仮引数も definedSymbols に追加
                    if (!definedSymbols.has(paramName)) { // 既にグローバルで同名があれば上書きしない
                        definedSymbols.set(paramName, { name: paramName, type: 'parameter' });
                    }
                });
            }
        }

        // functionの検出
        let funcDeclMatch: RegExpExecArray | null;
        while ((funcDeclMatch = functionDeclarationRegex.exec(cleanLine)) !== null) {
            const funcName = funcDeclMatch[1];
            const funcNameStartInMatch = funcDeclMatch[0].indexOf(funcName);
            const startPos = document.positionAt(document.offsetAt(new vscode.Position(lineNum, funcDeclMatch.index + funcNameStartInMatch)));
            const endPos = startPos.translate(0, funcName.length);
            if (!definedSymbols.has(funcName)) { 
                definedSymbols.set(funcName, { name: funcName, type: 'function', definitionRange: new vscode.Range(startPos, endPos) });
            }
            const parametersString = funcDeclMatch[2]; 
            if (parametersString) {
                const paramNames = parametersString.split(',').map(p => p.trim()).filter(p => p.length > 0);
                paramNames.forEach(paramName => {
                    if (!definedSymbols.has(paramName)) { 
                        definedSymbols.set(paramName, { name: paramName, type: 'parameter' });
                    }
                });
            }
        }

        // externの検出
        let externDeclMatch: RegExpExecArray | null;
        while ((externDeclMatch = externDeclarationRegex.exec(cleanLine)) !== null) {
            const varName = externDeclMatch[1];
            const varNameStartInMatch = externDeclMatch[0].indexOf(varName);
            const startPos = document.positionAt(document.offsetAt(new vscode.Position(lineNum, externDeclMatch.index + varNameStartInMatch)));
            const endPos = startPos.translate(0, varName.length);

            if (varName.match(/^[A-Z]/)) {
                if (!definedSymbols.has(varName)) { 
                    definedSymbols.set(varName, { name: varName, type: 'variable', definitionRange: new vscode.Range(startPos, endPos) });
                }
            } else {
                 diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(startPos, endPos),
                    `外部変数名 '${varName}' は大文字のアルファベットで始まる必要があります (Asir の規則)`,
                    vscode.DiagnosticSeverity.Error
                ));
            }
        }

        // すべての識別子が定義済みかをチェック
        let idMatch: RegExpExecArray | null;
        allIdentifiersInLineRegex.lastIndex = 0; // 各行で正規表現のlastIndexをリセット
        while ((idMatch = allIdentifiersInLineRegex.exec(cleanLine)) !== null) {
            const identifierName = idMatch[1];
            const startPos = document.positionAt(document.offsetAt(new vscode.Position(lineNum, idMatch.index)));
            const endPos = startPos.translate(0, identifierName.length);

            rawUsedIdentifiers.push({ name: identifierName, range: new vscode.Range(startPos, endPos), originalLine: cleanLine, originalIndex: idMatch.index });
        }
    });

    // 未定義のシンボルをチェック
    rawUsedIdentifiers.forEach(symbol => {
        // ユーザー定義関数などは警告しない
        if (definedSymbols.has(symbol.name)) {
            return;
        }
        // 組み込み関数やキーワードは警告しない
        if (isBuiltInOrKeyword(symbol.name)) {
            return;
        }
        // それ以外の識別子について
        if (symbol.name.match(/^[a-z]/)) {
            const afterIdentifier = symbol.originalLine.substring(symbol.originalIndex + symbol.name.length);
            const isFunctionCallForm = afterIdentifier.match(/^\s*\(/);
            if (isFunctionCallForm) {
                diagnostics.push(new vscode.Diagnostic(
                    symbol.range,
                    `未定義の関数: '${symbol.name}'`,
                    vscode.DiagnosticSeverity.Warning
                ));
            } else {
            } 
        } else {
            diagnostics.push(new vscode.Diagnostic(
                symbol.range,
                `未定義の変数: '${symbol.name}'`,
                vscode.DiagnosticSeverity.Warning
            ));
        }
            
    });
    diagnosticCollection.set(document.uri, diagnostics);
    return definedSymbols;
}


// 括弧チェック用
function isMatchingBracket(open: string, close: string): boolean {
    return (open === '(' && close === ')') ||
           (open === '[' && close === ']') ||
           (open === '{' && close === '}');
}

// 組み込み関数かキーワードかを判定する
function isBuiltInOrKeyword(name:string): boolean {
    return ASIR_KEYWORDS.includes(name) || ASIR_BUILTIN_FUNCTIONS.includes(name);
}

// 関数の仮引数かどうかを簡易的に判定する関数
// 仮引数抽出時に行うため不要
/*
function isFunctionParameter(identifier: string, lineText: string, identifierIndex: number): boolean {
    const preDefMatch = lineText.substring(0, identifierIndex).match(/\bdef\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
    if (preDefMatch) {
        const afterparen = lineText.substring(identifierIndex + identifier.length);
        if (afterparen.trim().startsWith(')') || afterparen.trim().startsWith(',')){
            return true;
        }
    }
    return false;
}
*/

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