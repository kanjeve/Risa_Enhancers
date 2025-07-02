import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs'; // fs.writeFileSync, fs.unlinkSync のため
import * as os from 'os'; // os.tmpdir のため

// ヘルパー関数 (別のファイルからインポート)
import { convertWindowsPathToWsl } from '../utils/helper'; // Windows/WSL パス変換

// グローバル変数
export let currentAsirTerminal: vscode.Terminal | null = null; // デバッグセッションターミナル
export let debugTerminalClosedPromise: Promise<void> | undefined; // ターミナルが閉じるのを待つPromise
export let debugTerminalClosedResolve: (() => void) | undefined; // 上記Promiseを解決する関数

/**
 * デバッグモードのRisa/Asirコマンドを登録します。
 * コードを一時ファイルに保存し、デバッグセッションターミナルでロードします。
 *
 * @param context 拡張機能のコンテキスト。
 * @param asirOutputChannel 共通のOutputChannel (デバッグログ用)。
 * @param debugStartStatusBarItem デバッグ開始ボタンのStatusBarItem (表示/非表示制御用)。
 * @param stopSessionStatusBarItem デバッグ停止ボタンのStatusBarItem (表示/非表示制御用)。
 */
export function registerDebugCommands(
    context: vscode.ExtensionContext,
    asirOutputChannel: vscode.OutputChannel,
    startSessionStatusBarItem: vscode.StatusBarItem,
    stopSessionStatusBarItem: vscode.StatusBarItem
) {
    // --- デバッグセッション開始コマンドの登録 ---
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

        // 1. コードを一時ファイルに保存 (Windows/OS一時ディレクトリ上)
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

        // 2. Risa/Asir デバッグターミナルを起動
        if (!currentAsirTerminal) {
            vscode.window.showInformationMessage('Starting Risa/Asir debug session...');
            const resourceUri = editor.document.uri;
            const config = vscode.workspace.getConfiguration('risaasirExecutor', resourceUri);

            // ★Risa/Asir起動時の遅延設定を取得
            const debugStartupDelay = config.get<number>('debugStartupDelay', 3000);

            let commandLine: string;
            const currentOsPlatform = process.platform;

            if (currentOsPlatform === 'win32') {
                const useWslFromWindows = config.get<boolean>('useWslFromWindows', false);
                if (useWslFromWindows) {
                    const wslDistribution = config.get<string>('wslDistribution', 'Ubuntu');
                    const asirPathLinux = config.get<string>('asirPathLinux', 'asir');
                    // WSLの場合: script コマンドでラップし、終了時にシェルも終了させる `; exit` を追加
                    // これが前回解決した WSL の複雑なエスケープ対応
                    const bashCommand = `script -q -c '${asirPathLinux}' /dev/null ; exit`;
                    commandLine = `& wsl -d ${wslDistribution} -e bash -c "${bashCommand}"`;
                } else {
                    const asirPathWindows = config.get<string>('asirPathWindows', 'asir.exe');
                    // Windowsネイティブの場合: PowerShell で直接 Risa/Asir を起動し、終了したらシェルも終了
                    commandLine = `& "${asirPathWindows}" ; exit`;
                }
            } else if (currentOsPlatform === 'darwin' || currentOsPlatform === 'linux') {
                const asirPath = currentOsPlatform === 'darwin' ? config.get<string>('asirPathMac', 'asir') : config.get<string>('asirPathLinux', 'asir');
                // Mac/Linux の場合: stdbuf を使うが script は不要 (Ctrl+CはOS標準でOK)
                commandLine = `stdbuf -o0 "${asirPath}" ; exit`;
            } else {
                vscode.window.showErrorMessage(`Unsupported OS platform: ${currentOsPlatform}`);
                fs.unlinkSync(windowsTempFilePath); // エラー時は一時ファイルを削除
                return;
            }

            currentAsirTerminal = vscode.window.createTerminal({
                name: 'Risa/Asir Interactive', 
                shellPath: undefined, // OSのデフォルトシェルを使う
                shellArgs: [],
                cwd: resourceUri ? path.dirname(resourceUri.fsPath) : (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
                    ? vscode.workspace.workspaceFolders[0].uri.fsPath
                    : undefined
                ),
                hideFromUser: false
            });

            // ターミナルが閉じられたときのイベントリスナー
            context.subscriptions.push(vscode.window.onDidCloseTerminal(e => {
                if (e === currentAsirTerminal) {
                    vscode.window.showInformationMessage('Risa/Asir debug session terminal closed.');
                    currentAsirTerminal = null;
                    startSessionStatusBarItem.show(); // 開始ボタンを再表示
                    stopSessionStatusBarItem.hide();  // 停止ボタンを非表示
                    try { fs.unlinkSync(windowsTempFilePath); } catch (err) { console.error(`Failed to delete temporary file: ${err}`); } // 一時ファイルを削除
                    if (debugTerminalClosedResolve) { // ターミナルが閉じたことをPromiseで解決
                        debugTerminalClosedResolve();
                        debugTerminalClosedResolve = undefined;
                        debugTerminalClosedPromise = undefined;
                    }
                }
            }));

            currentAsirTerminal.show(true); // ターミナルを表示

            // ステータスバーアイテムの表示切り替え
            startSessionStatusBarItem.hide(); // デバッグ開始ボタンを非表示
            stopSessionStatusBarItem.show(); // デバッグ停止ボタンを表示

            // Risa/Asir起動コマンドを送信
            console.log(`DEBUG: Sending Risa/Asir startup command via sendText.`);
            currentAsirTerminal.sendText(commandLine);

            // Risa/Asirが起動し、プロンプトを出すまで十分な時間待つ (設定値を使用)
            await new Promise(resolve => setTimeout(resolve, debugStartupDelay));
            console.log(`DEBUG: Waited for Risa/Asir startup completion (${debugStartupDelay}ms).`);

        } else {
            // 既にデバッグセッションがアクティブな場合 (既存セッションへのロード)
            vscode.window.showInformationMessage('Existing Risa/Asir debug session found. Loading code into it.');
            currentAsirTerminal.show(true);
            // 既存セッションへのロードの場合、Risa/Asirがコマンドを受け付けられる状態になるまで待機
            const config = vscode.workspace.getConfiguration('risaasirExecutor', editor.document.uri); // configを再取得
            const debugStartupDelay = config.get<number>('debugStartupDelay', 500); // 既存セッションは短め
            await new Promise(resolve => setTimeout(resolve, debugStartupDelay > 0 ? debugStartupDelay / 2 : 500)); // 半分程度の時間か、最低500ms
        }

        // 3. 一時ファイルのパスを読み込めるように変換
        let loadCommand: string;
        const currentOsPlatform = process.platform;
        const config = vscode.workspace.getConfiguration('risaasirExecutor', document.uri); // configを再取得
        const useWslFromWindows = config.get<boolean>('useWslFromWindows', false);

        if (currentOsPlatform === 'win32' && useWslFromWindows) {
            const wslTempFilePath = convertWindowsPathToWsl(windowsTempFilePath);
            loadCommand = `load("${wslTempFilePath}");`;
        } else {
            loadCommand = `load("${windowsTempFilePath.replace(/\\/g, '/')}");`;
        }

        // Load コマンドをターミナルに送信
        asirOutputChannel.appendLine(`> ${loadCommand}`);
        currentAsirTerminal.sendText(loadCommand);
        // Load コマンドが処理されるまで少し待つ
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log(`DEBUG: Load command sent.`);

        const debugStartupDelay = config.get<number>('debugStartupDelay', 3000);
        // ユーザーへのメッセージ (Ctrl+C デバッグの案内)
        vscode.window.showInformationMessage(
            'Code loaded for debugging. Call your function (e.g., `myfunc(1);`) in the "Risa/Asir Debug" terminal and use Ctrl+C then "d" to enter debug mode.' +
            ` If loading fails, try increasing the "Risa/Asir Executor: Debug Startup Delay" setting (currently ${debugStartupDelay}ms).`
        );

        // デバッグセッション中は拡張機能が終了しないようにする Promise を設定
        debugTerminalClosedPromise = new Promise<void>(resolve => {
            debugTerminalClosedResolve = resolve;
        });
        await debugTerminalClosedPromise; // ターミナルが閉じるまで待機
    });
    context.subscriptions.push(disposableStartAsirDebug);


    // --- デバッグセッション停止コマンドの登録 ---
    let disposableStopAsirInteractive = vscode.commands.registerCommand('risa_enhancers.stopAsirInteractive', async () => {
        if (!currentAsirTerminal) {
            vscode.window.showInformationMessage('No Risa/Asir debug session is currently running.');
            return;
        }
        vscode.window.showInformationMessage('Stopping Risa/Asir debug session...');
        asirOutputChannel.appendLine('--- Sending \'quit;\' to Risa/Asir debug terminal ---');

        currentAsirTerminal.sendText('quit;'); // quit; を送信

        // ターミナルが閉じるのを待つ Promise を設定
        const terminalClosedByQuit = new Promise<void>(resolve => {
            let disposableListener: vscode.Disposable | undefined;
            disposableListener = vscode.window.onDidCloseTerminal(e => {
                if (e === currentAsirTerminal) {
                    if (disposableListener) disposableListener.dispose();
                    resolve();
                }
            });
        });

        const timeout = new Promise<void>(resolve => setTimeout(resolve, 5000)); // 5秒待つ

        await Promise.race([terminalClosedByQuit, timeout]); // どちらか早い方を待つ

        // 5秒待ってもターミナルが閉じなければ強制終了
        if (currentAsirTerminal) {
            vscode.window.showWarningMessage('Risa/Asir debug terminal did not close gracefully. Disposing it forcefully.');
            asirOutputChannel.appendLine(`--- Forcing termination of Risa/Asir debug terminal... ---`);
            currentAsirTerminal.dispose(); // 強制的に閉じる
        }
        vscode.window.showInformationMessage('Risa/Asir debug session stopped.');
        // currentAsirTerminal = null; // onDidCloseTerminal で設定される
        // asirCancelStatusBarItem.hide(); // onDidCloseTerminal で設定される
        // debugStartStatusBarItem.show(); // onDidCloseTerminal で設定される
        // stopSessionStatusBarItem.hide();  // onDidCloseTerminal で設定される
        // Promiseをリセット (onDidCloseTerminal で設定されるので、重複を避ける)
        // debugTerminalClosedPromise = undefined;
        // debugTerminalClosedResolve = undefined;
    });
    context.subscriptions.push(disposableStopAsirInteractive);
}