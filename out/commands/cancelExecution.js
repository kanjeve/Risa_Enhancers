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
exports.registerCancelExecutionCommand = registerCancelExecutionCommand;
const vscode = __importStar(require("vscode"));
const child_process = __importStar(require("child_process")); // taskkill/execSync のため
const executeCommand_1 = require("./executeCommand");
/**
 * 通常実行中のRisa/Asirプロセスをキャンセルするコマンドを登録します。
 * 主に `child_process` で起動されたプロセスを強制終了します。
 *
 * @param context 拡張機能のコンテキスト。
 * @param asirOutputChannel 共通のOutputChannel (ログ用)。
 * @param asirCancelStatusBarItem キャンセルボタンのStatusBarItem (表示/非表示制御用)。
 */
function registerCancelExecutionCommand(context, asirOutputChannel, asirCancelStatusBarItem) {
    let disposable = vscode.commands.registerCommand('risa_enhancers.cancelExecution', async () => {
        if (!executeCommand_1.currentNormalExecuteProcess) {
            vscode.window.showInformationMessage('No Risa/Asir normal execution is currently running to cancel.');
            return;
        }
        vscode.window.showInformationMessage('Attempting to cancel Risa/Asir calculation. Please wait...');
        asirOutputChannel.appendLine(`--- Cancelling Risa/Asir normal execution process... ---`);
        try {
            // プロセスIDを取得
            const pid = executeCommand_1.currentNormalExecuteProcess.pid;
            if (pid) {
                if (process.platform === 'win32') {
                    // Windowsの場合：taskkillで強制終了
                    child_process.execSync(`taskkill /F /T /PID ${pid}`);
                }
                else {
                    // Linux/macOSの場合：SIGKILLで強制終了
                    executeCommand_1.currentNormalExecuteProcess.kill('SIGKILL');
                }
                vscode.window.showInformationMessage('Risa/Asir normal execution cancelled.');
                asirOutputChannel.appendLine(`--- Risa/Asir normal execution successfully cancelled ---`);
            }
            else {
                vscode.window.showErrorMessage('Could not find PID for the running Risa/Asir process.');
            }
        }
        catch (error) {
            console.error('Error during Risa/Asir cancellation:', error);
            vscode.window.showErrorMessage(`Failed to cancel Risa/Asir: ${error.message}.`);
        }
        finally {
            // currentNormalExecuteProcess = null; // ★ここでは直接クリアしない (executeCommands.ts の責任)
            asirCancelStatusBarItem.hide(); // キャンセルボタンはここで非表示にする
        }
    });
    context.subscriptions.push(disposable);
}
//# sourceMappingURL=cancelExecution.js.map