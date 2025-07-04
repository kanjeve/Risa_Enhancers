import * as vscode from 'vscode';

// 各機能モジュールのインポート
import { registerPackageCompletionProvider } from './features/completionProvider';
import { registerWordCompletionProvider } from './features/wordCompletionProvider';
import { registerDiagnostics, SymbolInfo } from './features/diagnostics';
import { registerExecuteCommand } from './commands/executeCommand';
import { registerDebugCommands } from './commands/debugCommand';
import { registerCancelExecutionCommand } from './commands/cancelExecution';
import { loadPackageData } from './data/packages'; 


// --- グローバル変数の定義 ---
let asirOutputChannel: vscode.OutputChannel;
// ステータスバーアイテム
let asirModeStatusBarItem: vscode.StatusBarItem;
let asirCancelStatusBarItem: vscode.StatusBarItem;
let executeCodeStatusBarItem: vscode.StatusBarItem;
let startSessionStatusBarItem: vscode.StatusBarItem;
let stopSessionStatusBarItem: vscode.StatusBarItem;
// SymbolInfoの共有
let sharedDefinedSymbols: Map<string, SymbolInfo> = new Map(); 

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "risa-enhancers" is now active!');

    // 共通のOutputChannelを作成
    asirOutputChannel = vscode.window.createOutputChannel('Risa/Asir CLI Output');
    context.subscriptions.push(asirOutputChannel);

    // --- データファイルの読み込み (必要であれば専用モジュールへ) ---
    loadPackageData(context);

    // --- ステータスバーアイテムの初期化と登録  ---
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

    // WSL/Windows モード切り替えボタン
    asirModeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    asirModeStatusBarItem.command = 'risa_enhancers.switchExecutionMode';
    context.subscriptions.push(asirModeStatusBarItem);
    updateStatusBarMode(context); // 初期設定

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('risaasirExecutor.useWslFromWindows')) {
            updateStatusBarMode(context);
        }
    }));

    // --- 各機能の初期化と登録 ---

    registerDiagnostics(context, sharedDefinedSymbols, asirOutputChannel);
    registerPackageCompletionProvider(context); 
    registerWordCompletionProvider(context, sharedDefinedSymbols);
    registerExecuteCommand(context, asirOutputChannel);
    registerDebugCommands(context, asirOutputChannel, startSessionStatusBarItem, stopSessionStatusBarItem);
    registerCancelExecutionCommand(context, asirOutputChannel, asirCancelStatusBarItem);
    
    // HelloWorld コマンド
    let disposableHelloWorld = vscode.commands.registerCommand('risa-enhancers.helloWorld', () => {
        vscode.window.showInformationMessage('Hello VS Code from Risa Enhancers!');
    });
    context.subscriptions.push(disposableHelloWorld);

    // --- 実行モードを切り替えるコマンド ---
    let disposableToggleMode = vscode.commands.registerCommand('risa_enhancers.switchExecutionMode', async () => {
        const config = vscode.workspace.getConfiguration('risaasirExecutor', null);
        const currentModeIsWsl = config.get<boolean>('useWslFromWindows', false);
        const newModeIsWsl = !currentModeIsWsl;

        await config.update('useWslFromWindows', newModeIsWsl, vscode.ConfigurationTarget.Workspace);
        updateStatusBarMode(context); // ステータスバーを更新
        vscode.window.showInformationMessage(`Risa/Asir execution mode switched to: ${newModeIsWsl ? 'WSL' : 'Windows Native'}`);
    });
    context.subscriptions.push(disposableToggleMode);
}

// deactivate 
export function deactivate() {
    if (asirModeStatusBarItem) { asirModeStatusBarItem.dispose(); }
    if (asirCancelStatusBarItem) { asirCancelStatusBarItem.dispose(); }
    if (startSessionStatusBarItem) { startSessionStatusBarItem.dispose(); }
    if (stopSessionStatusBarItem) { stopSessionStatusBarItem.dispose(); }
    if (executeCodeStatusBarItem) { executeCodeStatusBarItem.dispose(); }

    // 通常実行を終了
    const { currentNormalExecuteProcess } = require('./commands/executeCommand');
    if (currentNormalExecuteProcess) {
        vscode.window.showInformationMessage('Terminating Risa/Asir normal execution on extension deactivation.');
        if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            try { execSync(`taskkill /F /T /PID ${currentNormalExecuteProcess.pid!}`); } catch (e) { console.error(`Failed to force terminate normal execution process: ${e}`); }
        } else {
            currentNormalExecuteProcess.kill('SIGKILL');
        }
    }
    // デバッグターミナルを終了
    const { currentAsirTerminal } = require('./commands/debugCommand');
    if (currentAsirTerminal) { 
        vscode.window.showInformationMessage('Terminating Risa/Asir debug terminal on extension deactivation.');
        currentAsirTerminal.dispose();
    }
}

// --- updateStatusBarMode 関数 ---
async function updateStatusBarMode(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('risaasirExecutor', null);
    const useWsl = config.get<boolean>('useWslFromWindows', false);

    if (process.platform === 'win32') {
        if (!asirModeStatusBarItem) { 
            asirModeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
            asirModeStatusBarItem.command = 'risa_enhancers.switchExecutionMode';
            context.subscriptions.push(asirModeStatusBarItem);
        }
        asirModeStatusBarItem.text = `$(sync) Risa/Asir: ${useWsl ? 'WSL' : 'Windows'}`;
        asirModeStatusBarItem.tooltip = `Click to switch Risa/Asir execution mode to ${useWsl ? 'Windows Native' : 'WSL'}`;
        asirModeStatusBarItem.show();
    } else {
        if (asirModeStatusBarItem) {
            asirModeStatusBarItem.hide();
        }
    }
}