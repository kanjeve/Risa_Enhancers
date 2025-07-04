import * as vscode from 'vscode';
import * as child_process from 'child_process'; // taskkill/execSync のため

import { currentNormalExecuteProcess } from './executeCommand';

/**
 * 通常実行中のRisa/Asirプロセスをキャンセルするコマンドを登録します。
 * 主に `child_process` で起動されたプロセスを強制終了します。
 *
 * @param context 拡張機能のコンテキスト。
 * @param asirOutputChannel 共通のOutputChannel (ログ用)。
 * @param asirCancelStatusBarItem キャンセルボタンのStatusBarItem (表示/非表示制御用)。
 */
export function registerCancelExecutionCommand(
    context: vscode.ExtensionContext,
    asirOutputChannel: vscode.OutputChannel,
    asirCancelStatusBarItem: vscode.StatusBarItem
) {
    let disposable = vscode.commands.registerCommand('risa_enhancers.cancelExecution', async () => {
        if (!currentNormalExecuteProcess) {
            vscode.window.showInformationMessage('No Risa/Asir normal execution is currently running to cancel.');
            return;
        }

        vscode.window.showInformationMessage('Attempting to cancel Risa/Asir calculation. Please wait...');
        asirOutputChannel.appendLine(`--- Cancelling Risa/Asir normal execution process... ---`);

        try {
            // プロセスIDを取得
            const pid = currentNormalExecuteProcess.pid;
            if (pid) {
                if (process.platform === 'win32') {
                    // Windowsの場合：taskkillで強制終了
                    child_process.execSync(`taskkill /F /T /PID ${pid}`);
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
            // currentNormalExecuteProcess = null; // ★ここでは直接クリアしない (executeCommands.ts の責任)
            asirCancelStatusBarItem.hide(); // キャンセルボタンはここで非表示にする
        }
    });

    context.subscriptions.push(disposable); 
}