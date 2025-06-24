import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as os from 'os'; 
import { /*isFunction,*/ TextDecoder } from 'util';
import { ASIR_KEYWORDS, ASIR_BUILTIN_FUNCTIONS } from "./builtins";
import { ctrlc } from 'ctrlc-windows';
import { rejects } from 'assert';
// import * as pty from '@lydell/node-pty';
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

// ステータスバーアイテムの追加
let asirModeStatusBarItem: vscode.StatusBarItem;
let asirCancelStatusBarItem: vscode.StatusBarItem;
let startSessionStatusBarItem: vscode.StatusBarItem;
let stopSessionStatusBarItem: vscode.StatusBarItem;
let executeCodeStatusBarItem: vscode.StatusBarItem;

// 出力を保持するためのもの
let asirOutputChannel: vscode.OutputChannel;
// let isDebuggingModeQuitSent: boolean = false;

// インタラクティブ実行中のRisa/Asirプロセスを保持する変数
let currentAsirTerminal: vscode.Terminal | null = null;
let currentNormalExecuteProcess: ChildProcessWithoutNullStreams | null = null;

// Risa/Asirが終了したことを示すプロセス
let debugTerminalClosedPromise: Promise<void> | undefined;
let debugTerminalClosedResolve: (() => void) | undefined;

// ステータスバーアイテムの表示を更新する関数
async function updateStatusBarMode(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('risaasirExecutor', null);
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

    // --- 通常実行コマンドの登録 ---
    let disposableAsirExecute = vscode.commands.registerCommand('risa_enhancers.executeCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {

            const document = editor.document;
            const selection = editor.selection;
            const textToExecute = document.getText(selection.isEmpty ? undefined : selection);

            if (textToExecute.trim().length === 0) {
                vscode.window.showInformationMessage('No code selected or current line is empty.');
                return;
            }
            // デバッグセクションが起動中ならコードはデバッグターミナルへ
            if (currentAsirTerminal) {
                vscode.window.showInformationMessage('sending code to active Risa/Asir debug session.');
                currentAsirTerminal.sendText(textToExecute);
                currentAsirTerminal.show(true);
                return;
            }

            // 実行中に中断を促す
            if (currentNormalExecuteProcess) {
                vscode.window.showWarningMessage('A Risa/Asir execution is already running. Please cancel it first.', 'Cancel')
                    .then(selection => {
                        if (selection === 'Cancel') {
                            vscode.commands.executeCommand('risa_enhancers.cancelExecution');
                        }
                    });
                return;
            }

            let command: string;
            let args: string[] = [];
            let displayMessage: string;
            let spawnOptions: { shell?: boolean; maxBuffer?: number } = {};

            const config = vscode.workspace.getConfiguration('risaasirExecutor', document.uri);
            const currentOsPlatform = process.platform;

            let outputAccumulator = '';
            let errorAccumulator = '';

            if (currentOsPlatform === 'win32') {
                const useWslFromWindows = config.get<boolean>('useWslFromWindows', false);
                if (useWslFromWindows) {
                    const wslDistribution = config.get<string>('wslDistribution', 'Ubuntu');
                    const asirPathLinux = config.get<string>('asirPathLinux');
                    command = 'wsl';
                    const asirCommandWithQuiet = `${asirPathLinux || 'asir'} -quiet`;
                    const wslCommand = `${asirCommandWithQuiet} <<'EOF'\n${textToExecute}\nquit$\nEOF`;
                    args = ['-d', wslDistribution,`bash`, '-c', wslCommand];
                    displayMessage = `Executing Risa/Asir WSL (${wslDistribution})...`;
                } else {
                    const asirPathWindows = config.get<string>('asirPathWindows');
                    command = `"${asirPathWindows || 'asir.exe'}" -quiet`;
                    args = [];
                    displayMessage = 'Executing Risa/Asir on Windows natively...';
                    spawnOptions.shell = true;
                }
            } else if (currentOsPlatform === 'darwin' || currentOsPlatform === 'linux') {
                const asirPath = currentOsPlatform === 'darwin' ? config.get<string>('asirPathMac') : config.get<string>('asirPathLinux');
                command = `${asirPath || 'asir'} -quiet`;
                args = [];
                displayMessage = `Executing Risa/Asir on ${currentOsPlatform}...`;
            } else {
                vscode.window.showErrorMessage(`Unsupported OS platform: ${currentOsPlatform}`);
                return;
            }

            spawnOptions.maxBuffer = 1024*1024*100;

            asirOutputChannel.clear();
            asirOutputChannel.show(true);
            asirOutputChannel.appendLine(`--- ${displayMessage} ---`);

            try {
                const asirProcess = spawn(command, args, spawnOptions);
                currentNormalExecuteProcess = asirProcess;

                if ((currentOsPlatform === 'win32' && !config.get<boolean>('useWslFromWindows')) || currentOsPlatform === 'darwin') {
                    const fullCommand = textToExecute + '\nquit$\n';
                    asirProcess.stdin.write(fullCommand);
                    asirProcess.stdin.end();
                }

                // 標準出力
                asirProcess.stdout.on('data', (data: Buffer) => {
                    let decodedString: string;
                    if (currentOsPlatform === 'win32' && !config.get<boolean>('useWslFromWindows', false)) {
                        decodedString = new TextDecoder('shift-jis').decode(data);
                    } else {
                        decodedString = data.toString();
                    }
                    outputAccumulator += decodedString;
                    asirOutputChannel.append(decodedString);
                });

                // エラー出力
                asirProcess.stderr.on('data', (data: Buffer) => {
                    let errorString: string;
                    if (currentOsPlatform === 'win32' && !config.get<boolean>('useWslFromWindows', false)) {
                        errorString = new TextDecoder('shift-jis').decode(data);
                    } else {
                        errorString = data.toString();
                    }
                    errorAccumulator += errorString;
                    asirOutputChannel.appendLine(`Error from Risa/Asir: ${errorString}`);
                });

                await new Promise<void>((resolve, reject) => {
                    asirProcess.on('close', (code) => {
                        currentNormalExecuteProcess = null;
                        let finalErrorMessage = errorAccumulator;
                        const quitMessage = /(Calling the registered quit callbacks\.\.\.done\.[\r\n]+)|(return to toplevel[\r\n]*)/g;
                        if (finalErrorMessage.match(quitMessage)) {
                            finalErrorMessage = finalErrorMessage.replace(quitMessage, '').trim();
                        }

                        const CANCELLATION_CODES_WIN = [3221225786]; 
                        const CANCELLATION_CODES_UNIX = [130, 143]; 

                        const isCancelledExit = (
                            (typeof code === 'number' && process.platform === 'win32' && CANCELLATION_CODES_WIN.includes(code)) ||
                            (typeof code === 'number' && (process.platform === 'linux' || process.platform === 'darwin') && CANCELLATION_CODES_UNIX.includes(code))
                        );


                        if (code !== 0 && isCancelledExit) {
                            asirOutputChannel.appendLine(`--- Risa/Asir process exited with code ${code} (Error) ---`);
                            vscode.window.showErrorMessage(`Risa/Asir execution failed with code ${code}. Check 'Risa/Asir CLI Output' for details.`);
                            if (outputAccumulator.length > 0) {
                                asirOutputChannel.appendLine(`--- Risa/Asir Standard Output (Error Context) ---`);
                                asirOutputChannel.append(outputAccumulator);
                                asirOutputChannel.appendLine(`--- End of Standard Output (Error Context) ---`);
                            }
                            reject(new Error(`Process exited with code ${code}`));
                        } else {
                            asirOutputChannel.appendLine(`--- Risa/Asir execution finished successfully ---`);
                            resolve();
                        }
                    });
                    asirProcess.on('error', (err) => {
                        currentNormalExecuteProcess = null;
                        asirOutputChannel.appendLine(`Failed to start Risa/Asir process: ${err.message}`);
                        vscode.window.showErrorMessage(`Failed to start Risa/Asir: ${err.message}. Check if Risa/Asir is installed correctly and path is set in settings.`);
                        reject(err);
                    });
                });
                createResultWebview(context, textToExecute, outputAccumulator, errorAccumulator);
            } catch (err: any) {
                currentNormalExecuteProcess = null;
                asirOutputChannel.appendLine(`General error during Risa/Asir execution: ${err.message}`);
                vscode.window.showErrorMessage(`An unexpected error occured during Risa/Asir exection: ${err.message}`);
            }
        } else {
            vscode.window.showInformationMessage('No active text editor to execute Risa/Asir code.')
        }
    });
    context.subscriptions.push(disposableAsirExecute);

    //--- デバッグセッション開始コマンドの登録 ---
    let disposableStartAsirDebug = vscode.commands.registerCommand('risa_enhancers.startAsirInteractive', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active text editor to debug Risa/Asir code from.');
            return;
        }

        const document = editor.document;
        const selection = editor.selection;
        const codeToDebug = document.getText(selection.isEmpty ? undefined : selection);

        if (codeToDebug.trim().length === 0) {
            vscode.window.showInformationMessage('No code selected or current line is empty for debugging.');
            return;
        }

        // コードを一時ファイルに保存
        const tempDir = os.tmpdir();
        const uniqueId = Math.random().toString(36).substring(2, 15);
        const tempFileName = `vscode_asir_debug_${uniqueId}.rr`;
        const windowsTempFilePath = path.join(tempDir, tempFileName);

        try {
            fs.writeFileSync(windowsTempFilePath, codeToDebug, 'utf8');
            console.log(`DEBUG: Code saved to temporary file: ${windowsTempFilePath}`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to save temporary file for debugging: ${error.message}`);
            return;
        }

        // デバッグターミナル起動
        if (!currentAsirTerminal) {
            vscode.window.showInformationMessage('Starting Risa/Asir debug session...');
            const resourceUri = editor.document.uri;
            const config = vscode.workspace.getConfiguration('risaasirExecutor', resourceUri);

            const debugStartupDelay = config.get<number>('debugStartupDelay', 3000);

            const currentOsPlatform = process.platform;
            let commandLine: string;

            if (currentOsPlatform === 'win32') {
                // Windowsの場合 
                const useWslFromWindows = config.get<boolean>('useWslFromWindows',false);
                if (useWslFromWindows) {
                    // Windows上でWSL経由で実行する場合
                    const wslDistribution = config.get<string>('wslDistribution', 'Ubuntu');
                    const asirPathLinux = config.get<string>('asirPathLinux', 'asir');
                    const bashCommand = `script -q -c '${asirPathLinux}' /dev/null`;
                    commandLine = `wsl -d ${wslDistribution} -e bash -c "${bashCommand}"`;
                } else {
                    // Windows上でWindowsネイティブのRisa/Asirを実行する場合
                    const asirPathWindows = config.get<string>('asirPathWindows', 'asir.exe');
                    commandLine = `& "${asirPathWindows}"`;
                }
            } else if (currentOsPlatform === 'darwin') {
                // macOSの場合
                const asirPathMac = config.get<string>('asirPathMac', 'asir');
                commandLine = `stdbuf -o0 "${asirPathMac}"`;
            } else if (currentOsPlatform === 'linux') {
                // Linuxの場合 (WSLを含む)
                const asirPathLinux = config.get<string>('asirPathLinux', 'asir');
                commandLine = `stdbuf -o0 "${asirPathLinux}"`;
            } else {
                vscode.window.showErrorMessage(`Unsupported OS platform for interactive session: ${currentOsPlatform}`);
                fs.unlinkSync(windowsTempFilePath);
                return;
            }

            currentAsirTerminal = vscode.window.createTerminal({
                name: 'Risa/Asir Interactive',
                shellPath: undefined,
                shellArgs: [],
                cwd: resourceUri ? path.dirname(resourceUri.fsPath) : (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
                    ? vscode.workspace.workspaceFolders[0].uri.fsPath
                    : undefined
                ),
                hideFromUser: false
            });

            startSessionStatusBarItem.hide();
            stopSessionStatusBarItem.show();

            // ターミナルが閉じられたとき
            context.subscriptions.push(vscode.window.onDidCloseTerminal(e => {
                if (e === currentAsirTerminal) {
                    vscode.window.showInformationMessage('Risa/Asir interactive session terminal closed.');
                    currentAsirTerminal = null;
                    asirCancelStatusBarItem.hide(); 
                    startSessionStatusBarItem.show();
                    stopSessionStatusBarItem.hide();
                    try { fs.unlinkSync(windowsTempFilePath); } catch (err) { console.error(`Failed to delete temporary file: ${err}`);}
                    if (debugTerminalClosedResolve) { 
                        debugTerminalClosedResolve();
                        debugTerminalClosedResolve = undefined;
                        debugTerminalClosedPromise = undefined;
                    }
                }
            }));

            // ターミナル表示
            currentAsirTerminal.show(true);

            // Risa/Asir 起動
            console.log(`DEBUG: Sending Risa/Asir startup command via sendText.`);
            currentAsirTerminal.sendText(commandLine);

            // 少し待つ
            await new Promise(resolve => setTimeout(resolve, debugStartupDelay)); 
            console.log("DEBUG: Waited for Risa/Asir startup completion.");
                
        } else {
            // デバッグセッションがアクティブな場合
            vscode.window.showInformationMessage('Existing Risa/Asir debug session found. Loading code into it.');
            currentAsirTerminal.show(true);
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // 一時ファイルのパスを読み込めるように変換
        let loadCommand: string;
        const currentOsPlatform = process.platform;
        const config = vscode.workspace.getConfiguration('risaasirExecutor', document.uri);
        const useWslFromWindows = config.get<boolean>('useWslFromWindows', false);

        if (currentOsPlatform === 'win32' && useWslFromWindows) {
            const wslTempFilePath = convertWindowsPathToWsl(windowsTempFilePath);
            loadCommand = `load("${wslTempFilePath}");`;
        } else {
            loadCommand = `load("${windowsTempFilePath.replace(/\\/g, '/')}");`;
        }

        // loadコマンドを送信
        asirOutputChannel.appendLine(`> ${loadCommand}`);
        currentAsirTerminal.sendText(loadCommand);
        await new Promise(resolve => setTimeout(resolve, 500)); 
        console.log(`DEBUG: Load command sent.`);
        const debugStartupDelay = config.get<number>('debugStartupDelay', 3000);

        vscode.window.showInformationMessage(
            'Code loaded for debugging. Call your function (e.g., `myfunc(1);`) in the "Risa/Asir Debug" terminal and use Ctrl+C then "d" to enter debug mode.' + 
            `If loading fails, try increasing the "Risa/Asir Executor: Debug Startup Delay" setting (currently ${debugStartupDelay}ms).`
        );
        

        // ターミナルが閉じられるまで拡張機能が終了しないようにする
        debugTerminalClosedPromise = new Promise<void>(resolve => {
            debugTerminalClosedResolve = resolve;
        });
        await debugTerminalClosedPromise;
    });
    context.subscriptions.push(disposableStartAsirDebug);

    // --- デバッグセッション停止コマンドの登録 ---
    let disposableStopAsirInteractive = vscode.commands.registerCommand('risa_enhancers.stopAsirInteractive', async () => {
        if (!currentAsirTerminal) {
            vscode.window.showInformationMessage('No Risa/Asir interactive session is currently running.');
            return;
        }
        vscode.window.showInformationMessage('Stopping Risa/Asir interactive session...');
        asirOutputChannel.appendLine('--- Sending \'quit;\' to Risa/Asir process ---');

        currentAsirTerminal.sendText('quit;');

        // 少し待つ
        const terminalClosedByQuit = new Promise<void>(resolve => {
            const disposable = vscode.window.onDidCloseTerminal(e => {
                if (e === currentAsirTerminal) { 
                    disposable.dispose(); 
                    resolve();
                }
            });
        });
        const timeout = new Promise<void>(resolve => setTimeout(resolve, 5000));
        await Promise.race([terminalClosedByQuit, timeout]);

        // 終わらないなら強制終了
        if(currentAsirTerminal) {
            vscode.window.showWarningMessage('Risa/Asir terminal did not close gracefully. Disposing it forcefully.');
            asirOutputChannel.appendLine(`--- Forcing termination of Risa/Asir terminal... ---`);
            currentAsirTerminal.dispose();
        }
        vscode.window.showInformationMessage('Risa/Asir interactive session stopped.');
        currentAsirTerminal = null;
        asirCancelStatusBarItem.hide();
        debugTerminalClosedPromise = undefined;
        debugTerminalClosedResolve = undefined;
        if (!currentAsirTerminal) { // currentAsirTerminal が null になっていることを確認 (dispose されたら onDidCloseTerminal が発火し null になる)
        startSessionStatusBarItem.show();
        stopSessionStatusBarItem.hide();
    }
    });
    context.subscriptions.push(disposableStopAsirInteractive);

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

    // --- キャンセル実行コマンド ---
    registerCancelExecutionCommand(context); 

    //--- ステータスバーアイテムの登録 ---
    // 通常実行
    executeCodeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    executeCodeStatusBarItem.command = 'risa_enhancers.executeCode';
    executeCodeStatusBarItem.text = '$(play) Execute Risa/Asir';
    executeCodeStatusBarItem.tooltip = 'Execute Risa/Asir code (Webview Output)';
    executeCodeStatusBarItem.hide();
    context.subscriptions.push(executeCodeStatusBarItem);

    // デバッグセッション開始
    startSessionStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
    startSessionStatusBarItem.command = 'risa_enhancers.startAsirInteractive';
    startSessionStatusBarItem.text = '$(terminal) Start Risa/Asir Debug Session';
    startSessionStatusBarItem.tooltip = 'Start a new Risa/Asir interactive session';
    startSessionStatusBarItem.show();
    context.subscriptions.push(startSessionStatusBarItem);

    // デバッグセッション停止
    stopSessionStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98); 
    stopSessionStatusBarItem.command = 'risa_enhancers.stopAsirInteractive';
    stopSessionStatusBarItem.text = '$(debug-stop) Stop Risa/Asir Debug Session';
    stopSessionStatusBarItem.tooltip = 'Stop the current Risa/Asir interactive session';
    stopSessionStatusBarItem.hide();
    context.subscriptions.push(stopSessionStatusBarItem);

    // 計算キャンセル
    asirCancelStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99); 
    asirCancelStatusBarItem.command = 'risa_enhancers.cancelExecution';
    asirCancelStatusBarItem.text = '$(stop) Cancel Risa/Asir';
    asirCancelStatusBarItem.tooltip = 'Click to cancel current Risa/Asir execution';
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


// キャンセルコマンドの関数
export function registerCancelExecutionCommand(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('risa_enhancers.cancelExecution', async () => {
        if (!currentNormalExecuteProcess) {
            vscode.window.showInformationMessage('No Risa/Asir process is currently running to cancel.');
            return;
        }
        vscode.window.showInformationMessage('Attempting to interrupt Risa/Asir calculation. Please wait...');
        asirOutputChannel.appendLine(`--- Cancelling Risa/Asir normal execution process... ---`);

        try {
            // プロセスIDを取得
            const pid = currentNormalExecuteProcess.pid;
            if (pid) {
                if (process.platform === 'win32') {
                    // Windowsの場合：taskkillで強制終了
                    const cp = require('child_process');
                    cp.execSync(`taskkill /F /T /PID ${pid}`);
                } else {
                    // Linux/macOSの場合：SIGKILLで強制終了
                    currentNormalExecuteProcess.kill('SIGKILL');
                }
                vscode.window.showInformationMessage('Risa/Asir normal execution cancelled.');
                asirOutputChannel.appendLine(`--- Risa/Asir normal execution successfully cancelled ---`);
            } else {
                vscode.window.showErrorMessage('Could not find PID for the running Risa/Asir process.');
            }
        } catch (error: any) {
            console.error('Error during Risa/Asir cancellation:', error);
            vscode.window.showErrorMessage(`Failed to cancel Risa/Asir: ${error.message}.`);
        } finally {
            currentNormalExecuteProcess = null;
            asirCancelStatusBarItem.hide(); 
        }
    });
    context.subscriptions.push(disposable);
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

//--- ヘルパー関数 ---

// windowsパスをwslパスに変換するヘルパー関数
function convertWindowsPathToWsl(winPath: string): string {
    let wslPath = winPath.replace(/\\/g, '/');
    const driveLetterMatch = wslPath.match(/^([A-Za-z]):\//);
    if (driveLetterMatch) {
        wslPath = `/mnt/${driveLetterMatch[1].toLowerCase()}${wslPath.substring(driveLetterMatch[0].length-1)}`;
    }
    return wslPath;
}

// 括弧チェック
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
/*function isFunctionParameter(identifier: string, lineText: string, identifierIndex: number): boolean {
    const preDefMatch = lineText.substring(0, identifierIndex).match(/\bdef\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
    if (preDefMatch) {
        const afterparen = lineText.substring(identifierIndex + identifier.length);
        if (afterparen.trim().startsWith(')') || afterparen.trim().startsWith(',')){
            return true;
        }
    }
    return false;
}*/

// Risa/Asirの結果を表示するための Webview を作成・表示 (通常実行用)
function createResultWebview(context: vscode.ExtensionContext, inputCode: string, outputResult: string, errorResult: string) {
    const panel = vscode.window.createWebviewPanel(
        'risaasirResult',
        'Risa/Asir Result',
        vscode.ViewColumn.Beside,
        {
            enableScripts: false,
            localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
        }
    );

    panel.webview.html = getWebviewContent(inputCode, outputResult, errorResult);

    panel.onDidDispose(() => {}, null, context.subscriptions);
}

// Webview生成 (通常実行用)
function getWebviewContent(inputCode: string, outputResult: string, errorResult: string): string {
    const escapedInputCode = inputCode.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapedOutputResult = outputResult.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapedErrorResult = errorResult.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let errorSectionHtml = '';
    if (escapedErrorResult.trim().length > 0) {
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
            overflow-x: auto;
            color: var(--vscode-editor-foreground);
        }
        .code-block pre {
            font-family: 'SF Mono', Monaco, Consolas, 'Courier New', monospace;
            white-space: pre;
            word-wrap: normal;
            margin: 0;
            padding: 0;
            text-align: left;
        }
        body {
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        .error-block {
            border-color: var(--vscode-errorForeground);
            background-color: var(--vscode-terminal-ansiBrightBlack);
        }
        .error-block pre {
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
    // 拡張機能終了時にアイテムを解放
    if (asirModeStatusBarItem){asirModeStatusBarItem.dispose(); }
    if (asirCancelStatusBarItem) {asirCancelStatusBarItem.dispose();}
    if (startSessionStatusBarItem){startSessionStatusBarItem.dispose(); }
    if (stopSessionStatusBarItem) {stopSessionStatusBarItem.dispose();}
    if (executeCodeStatusBarItem) {executeCodeStatusBarItem.dispose(); }

    // 拡張機能終了時に実行中のデバッグターミナルがあれば強制終了
    if (currentAsirTerminal) {
        vscode.window.showInformationMessage('Terminating Risa/Asir debug terminal on extension deactivation.');
        currentAsirTerminal.dispose();
    }
    const globalOsPlatform = process.platform;

    if (currentNormalExecuteProcess) {
        if (globalOsPlatform === 'win32') {
            spawn('taskkill', ['/F', '/T', '/PID', currentNormalExecuteProcess.pid!.toString()], { shell: true });
        } else {
            currentNormalExecuteProcess.kill('SIGKILL');
        }
    }

}