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
exports.currentNormalExecuteProcess = void 0;
exports.registerExecuteCommand = registerExecuteCommand;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const util_1 = require("util"); // Shift-JIS デコードのため
const debugCommand_1 = require("./debugCommand");
const webviewUtils_1 = require("../utils/webviewUtils"); // Webview 関連の関数
// 通常実行中のRisa/Asirプロセスを保持する変数
exports.currentNormalExecuteProcess = null;
/**
 * 通常実行モードのRisa/Asirコマンドを登録します。
 * コードを実行し、結果をWebviewに表示します。
 *
 * @param context 拡張機能のコンテキスト。
 * @param asirOutputChannel 共通のOutputChannel。
 */
function registerExecuteCommand(context, asirOutputChannel) {
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
            if (debugCommand_1.currentAsirTerminal) {
                vscode.window.showInformationMessage('sending code to active Risa/Asir debug session.');
                debugCommand_1.currentAsirTerminal.sendText(textToExecute);
                debugCommand_1.currentAsirTerminal.show(true);
                return;
            }
            // 実行中に中断を促す
            if (exports.currentNormalExecuteProcess) {
                vscode.window.showWarningMessage('A Risa/Asir execution is already running. Please cancel it first.', 'Cancel')
                    .then(selection => {
                    if (selection === 'Cancel') {
                        vscode.commands.executeCommand('risa_enhancers.cancelExecution');
                    }
                });
                return;
            }
            let command;
            let args = [];
            let displayMessage;
            let spawnOptions = {};
            const config = vscode.workspace.getConfiguration('risaasirExecutor', document.uri);
            const currentOsPlatform = process.platform;
            let outputAccumulator = '';
            let errorAccumulator = '';
            if (currentOsPlatform === 'win32') {
                const useWslFromWindows = config.get('useWslFromWindows', false);
                if (useWslFromWindows) {
                    const wslDistribution = config.get('wslDistribution', 'Ubuntu');
                    const asirPathLinux = config.get('asirPathLinux');
                    command = 'wsl';
                    const asirCommandWithQuiet = `${asirPathLinux || 'asir'} -quiet`;
                    const wslCommand = `${asirCommandWithQuiet} <<'EOF'\n${textToExecute}\nquit$\nEOF`;
                    args = ['-d', wslDistribution, `bash`, '-c', wslCommand];
                    displayMessage = `Executing Risa/Asir WSL (${wslDistribution})...`;
                }
                else {
                    const asirPathWindows = config.get('asirPathWindows');
                    command = `"${asirPathWindows || 'asir.exe'}" -quiet`;
                    args = [];
                    displayMessage = 'Executing Risa/Asir on Windows natively...';
                    spawnOptions.shell = true;
                }
            }
            else if (currentOsPlatform === 'darwin' || currentOsPlatform === 'linux') {
                const asirPath = currentOsPlatform === 'darwin' ? config.get('asirPathMac') : config.get('asirPathLinux');
                command = `${asirPath || 'asir'} -quiet`;
                args = [];
                displayMessage = `Executing Risa/Asir on ${currentOsPlatform}...`;
            }
            else {
                vscode.window.showErrorMessage(`Unsupported OS platform: ${currentOsPlatform}`);
                return;
            }
            spawnOptions.maxBuffer = 1024 * 1024 * 100;
            asirOutputChannel.clear();
            asirOutputChannel.show(true);
            asirOutputChannel.appendLine(`--- ${displayMessage} ---`);
            try {
                const asirProcess = (0, child_process_1.spawn)(command, args, spawnOptions);
                exports.currentNormalExecuteProcess = asirProcess;
                if ((currentOsPlatform === 'win32' && !config.get('useWslFromWindows')) || currentOsPlatform === 'darwin') {
                    const fullCommand = textToExecute + '\nquit$\n';
                    asirProcess.stdin.write(fullCommand);
                    asirProcess.stdin.end();
                }
                // 標準出力
                asirProcess.stdout.on('data', (data) => {
                    let decodedString;
                    if (currentOsPlatform === 'win32' && !config.get('useWslFromWindows', false)) {
                        decodedString = new util_1.TextDecoder('shift-jis').decode(data);
                    }
                    else {
                        decodedString = data.toString();
                    }
                    outputAccumulator += decodedString;
                    asirOutputChannel.append(decodedString);
                });
                // エラー出力
                asirProcess.stderr.on('data', (data) => {
                    let errorString;
                    if (currentOsPlatform === 'win32' && !config.get('useWslFromWindows', false)) {
                        errorString = new util_1.TextDecoder('shift-jis').decode(data);
                    }
                    else {
                        errorString = data.toString();
                    }
                    errorAccumulator += errorString;
                    asirOutputChannel.appendLine(`Error from Risa/Asir: ${errorString}`);
                });
                await new Promise((resolve, reject) => {
                    asirProcess.on('close', (code) => {
                        exports.currentNormalExecuteProcess = null;
                        let finalErrorMessage = errorAccumulator;
                        const quitMessage = /(Calling the registered quit callbacks\.\.\.done\.[\r\n]+)|(return to toplevel[\r\n]*)/g;
                        if (finalErrorMessage.match(quitMessage)) {
                            finalErrorMessage = finalErrorMessage.replace(quitMessage, '').trim();
                        }
                        const CANCELLATION_CODES_WIN = [3221225786];
                        const CANCELLATION_CODES_UNIX = [130, 143];
                        const isCancelledExit = ((typeof code === 'number' && process.platform === 'win32' && CANCELLATION_CODES_WIN.includes(code)) ||
                            (typeof code === 'number' && (process.platform === 'linux' || process.platform === 'darwin') && CANCELLATION_CODES_UNIX.includes(code)));
                        if (code !== 0 && isCancelledExit) {
                            asirOutputChannel.appendLine(`--- Risa/Asir process exited with code ${code} (Error) ---`);
                            vscode.window.showErrorMessage(`Risa/Asir execution failed with code ${code}. Check 'Risa/Asir CLI Output' for details.`);
                            if (outputAccumulator.length > 0) {
                                asirOutputChannel.appendLine(`--- Risa/Asir Standard Output (Error Context) ---`);
                                asirOutputChannel.append(outputAccumulator);
                                asirOutputChannel.appendLine(`--- End of Standard Output (Error Context) ---`);
                            }
                            reject(new Error(`Process exited with code ${code}`));
                        }
                        else {
                            asirOutputChannel.appendLine(`--- Risa/Asir execution finished successfully ---`);
                            resolve();
                        }
                    });
                    asirProcess.on('error', (err) => {
                        exports.currentNormalExecuteProcess = null;
                        asirOutputChannel.appendLine(`Failed to start Risa/Asir process: ${err.message}`);
                        vscode.window.showErrorMessage(`Failed to start Risa/Asir: ${err.message}. Check if Risa/Asir is installed correctly and path is set in settings.`);
                        reject(err);
                    });
                });
                (0, webviewUtils_1.createResultWebview)(context, textToExecute, outputAccumulator, errorAccumulator);
            }
            catch (err) {
                exports.currentNormalExecuteProcess = null;
                asirOutputChannel.appendLine(`General error during Risa/Asir execution: ${err.message}`);
                vscode.window.showErrorMessage(`An unexpected error occured during Risa/Asir exection: ${err.message}`);
            }
        }
        else {
            vscode.window.showInformationMessage('No active text editor to execute Risa/Asir code.');
        }
    });
    context.subscriptions.push(disposableAsirExecute);
}
//# sourceMappingURL=executeCommand.js.map