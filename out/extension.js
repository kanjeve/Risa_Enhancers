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
// 各機能モジュールのインポート
const completionProvider_1 = require("./features/completionProvider");
const wordCompletionProvider_1 = require("./features/wordCompletionProvider");
const diagnostics_1 = require("./features/diagnostics");
const executeCommand_1 = require("./commands/executeCommand");
const debugCommand_1 = require("./commands/debugCommand");
const cancelExecution_1 = require("./commands/cancelExecution");
const packages_1 = require("./data/packages");
// --- グローバル変数の定義 ---
let asirOutputChannel;
// ステータスバーアイテム
let asirModeStatusBarItem;
let asirCancelStatusBarItem;
let executeCodeStatusBarItem;
let startSessionStatusBarItem;
let stopSessionStatusBarItem;
// SymbolInfoの共有
let sharedDefinedSymbols = new Map();
function activate(context) {
    console.log('Congratulations, your extension "risa-enhancers" is now active!');
    // 共通のOutputChannelを作成
    asirOutputChannel = vscode.window.createOutputChannel('Risa/Asir CLI Output');
    context.subscriptions.push(asirOutputChannel);
    // --- データファイルの読み込み (必要であれば専用モジュールへ) ---
    (0, packages_1.loadPackageData)(context);
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
    (0, diagnostics_1.registerDiagnostics)(context, sharedDefinedSymbols, asirOutputChannel);
    (0, completionProvider_1.registerPackageCompletionProvider)(context);
    (0, wordCompletionProvider_1.registerWordCompletionProvider)(context, sharedDefinedSymbols);
    (0, executeCommand_1.registerExecuteCommand)(context, asirOutputChannel);
    (0, debugCommand_1.registerDebugCommands)(context, asirOutputChannel, startSessionStatusBarItem, stopSessionStatusBarItem);
    (0, cancelExecution_1.registerCancelExecutionCommand)(context, asirOutputChannel, asirCancelStatusBarItem);
    // HelloWorld コマンド
    let disposableHelloWorld = vscode.commands.registerCommand('risa-enhancers.helloWorld', () => {
        vscode.window.showInformationMessage('Hello VS Code from Risa Enhancers!');
    });
    context.subscriptions.push(disposableHelloWorld);
    // --- 実行モードを切り替えるコマンド ---
    let disposableToggleMode = vscode.commands.registerCommand('risa_enhancers.switchExecutionMode', async () => {
        const config = vscode.workspace.getConfiguration('risaasirExecutor', null);
        const currentModeIsWsl = config.get('useWslFromWindows', false);
        const newModeIsWsl = !currentModeIsWsl;
        await config.update('useWslFromWindows', newModeIsWsl, vscode.ConfigurationTarget.Workspace);
        updateStatusBarMode(context); // ステータスバーを更新
        vscode.window.showInformationMessage(`Risa/Asir execution mode switched to: ${newModeIsWsl ? 'WSL' : 'Windows Native'}`);
    });
    context.subscriptions.push(disposableToggleMode);
}
// deactivate 
function deactivate() {
    if (asirModeStatusBarItem) {
        asirModeStatusBarItem.dispose();
    }
    if (asirCancelStatusBarItem) {
        asirCancelStatusBarItem.dispose();
    }
    if (startSessionStatusBarItem) {
        startSessionStatusBarItem.dispose();
    }
    if (stopSessionStatusBarItem) {
        stopSessionStatusBarItem.dispose();
    }
    if (executeCodeStatusBarItem) {
        executeCodeStatusBarItem.dispose();
    }
    // 通常実行を終了
    const { currentNormalExecuteProcess } = require('./commands/executeCommand');
    if (currentNormalExecuteProcess) {
        vscode.window.showInformationMessage('Terminating Risa/Asir normal execution on extension deactivation.');
        if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            try {
                execSync(`taskkill /F /T /PID ${currentNormalExecuteProcess.pid}`);
            }
            catch (e) {
                console.error(`Failed to force terminate normal execution process: ${e}`);
            }
        }
        else {
            currentNormalExecuteProcess.kill('SIGKILL');
        }
    }
    // デバッグターミナルを終了
    const { currentAsirTerminal } = require('./commands/debugCommands');
    if (currentAsirTerminal) {
        vscode.window.showInformationMessage('Terminating Risa/Asir debug terminal on extension deactivation.');
        currentAsirTerminal.dispose();
    }
}
// --- updateStatusBarMode 関数 ---
async function updateStatusBarMode(context) {
    const config = vscode.workspace.getConfiguration('risaasirExecutor', null);
    const useWsl = config.get('useWslFromWindows', false);
    if (process.platform === 'win32') {
        if (!asirModeStatusBarItem) {
            asirModeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
            asirModeStatusBarItem.command = 'risa_enhancers.switchExecutionMode';
            context.subscriptions.push(asirModeStatusBarItem);
        }
        asirModeStatusBarItem.text = `$(sync) Risa/Asir: ${useWsl ? 'WSL' : 'Windows'}`;
        asirModeStatusBarItem.tooltip = `Click to switch Risa/Asir execution mode to ${useWsl ? 'Windows Native' : 'WSL'}`;
        asirModeStatusBarItem.show();
    }
    else {
        if (asirModeStatusBarItem) {
            asirModeStatusBarItem.hide();
        }
    }
}
//# sourceMappingURL=extension.js.map