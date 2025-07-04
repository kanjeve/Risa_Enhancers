import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { TextDecoder } from 'util'; 

import { currentAsirTerminal } from './debugCommand';
import { createResultWebview, getWebviewContent } from '../utils/webviewUtils'; 
import { convertWindowsPathToWsl } from '../utils/helper';

// 通常実行中のRisa/Asirプロセスを保持する変数
export let currentNormalExecuteProcess: ChildProcessWithoutNullStreams | null = null;

/**
 * 通常実行モードのRisa/Asirコマンドを登録します。
 * コードを実行し、結果をWebviewに表示します。
 *
 * @param context 拡張機能のコンテキスト。
 * @param asirOutputChannel 共通のOutputChannel。
 */
export function registerExecuteCommand(
    context: vscode.ExtensionContext,
    asirOutputChannel: vscode.OutputChannel
) {
    let disposableAsirExecute = vscode.commands.registerCommand('risa_enhancers.executeCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if(!editor) {
                vscode.window.showInformationMessage('No active text editor to execute Risa/Asir code.');
                return;
            } 
    
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
    
            // 実行中の場合は中断を促す
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

            const tempDir = os.tmpdir();
            const uniqueId = Math.random().toString(36).substring(2, 15);
            const tempFileName = `vscode_asir_exec_temp_${uniqueId}.rr`;
            const windowsTempFilePath = path.join(tempDir, tempFileName);

            try {
                fs.writeFileSync(windowsTempFilePath, textToExecute, 'utf8');
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to save temporary file for execution: ${error.message}`);
                return;
            }

            const cleanupTempFile = () => {
                try{ fs.unlinkSync(windowsTempFilePath); } catch (err) { console.error(`Failed to delete temporary file: ${err}`);}
            };

            if (currentOsPlatform === 'win32') {
                const useWslFromWindows = config.get<boolean>('useWslFromWindows', false);
                if (useWslFromWindows) {
                    const wslDistribution = config.get<string>('wslDistribution', 'Ubuntu');
                    const asirPathLinux = config.get<string>('asirPathLinux', 'asir');
                    const wslTempFilePath = convertWindowsPathToWsl(windowsTempFilePath);
                    command = 'wsl';
                    const bashCommandString = `bash -c "${asirPathLinux} -quiet -f '${wslTempFilePath}'"`;
                    args = ['-d', wslDistribution, bashCommandString];
                    displayMessage = `Executing Risa/Asir WSL (${wslDistribution})...`;
                    spawnOptions.shell = true;
                } else {
                    const asirPathWindows = config.get<string>('asirPathWindows');
                    command = `"${asirPathWindows}" -quiet`;
                    args = [];
                    displayMessage = 'Executing Risa/Asir on Windows natively...';
                    spawnOptions.shell = true;
                }
            } else if (currentOsPlatform === 'darwin' || currentOsPlatform === 'linux') {
                const asirPath = currentOsPlatform === 'darwin' ? config.get<string>('asirPathMac', 'asir') : config.get<string>('asirPathLinux', 'asir');
                command = asirPath;
                args = ['-quiet', '-f', windowsTempFilePath];
                displayMessage = `Executing Risa/Asir on ${currentOsPlatform}...`;
                spawnOptions.shell = true;
            } else {
                vscode.window.showErrorMessage(`Unsupported OS platform: ${currentOsPlatform}`);
                cleanupTempFile();
                return;
            }
    
            spawnOptions.maxBuffer = 1024*1024*100;
    
            asirOutputChannel.clear();
            asirOutputChannel.show(true);
            asirOutputChannel.appendLine(`--- ${displayMessage} ---`);
    
            try {
                const asirProcess = spawn(command, args, spawnOptions);
                currentNormalExecuteProcess = asirProcess;

                if (currentOsPlatform === 'win32' && !config.get<boolean>('useWslFromWindows')) {
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

                    console.log(`DEBUG STDOUT RAW (${data.length} bytes): ${data.toString('hex')}`);
                    console.log(`DEBUG STDOUT DECODED: "${decodedString.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`);
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

                    // console.log(`DEBUG STDERR RAW (${data.length} bytes): ${data.toString('hex')}`);
                    // console.log(`DEBUG STDERR DECODED: "${errorString.replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`);
                });
    
                await new Promise<void>((resolve, reject) => {
                    asirProcess.on('close', (code) => {
                        currentNormalExecuteProcess = null;
                        cleanupTempFile();

                        let finalErrorMessage = errorAccumulator;
                        let isSuccessfulExit = false;

                        const normalQuitMessage =[
                            /(^|\s)Calling the registered quit callbacks\.\.\.done\.(\s|$)/gm,
                            /(^|\s)return to toplevel(\s|$)/gm
                        ];

                        normalQuitMessage.forEach(regex => {
                            if (finalErrorMessage.match(regex)) {
                                console.log(`DEBUG FILTER: Matched normal quit message: "${regex.source}"`);
                                finalErrorMessage = finalErrorMessage.replace(regex, '').trim();
                            }
                        });

                        if (errorAccumulator.length > 0 && finalErrorMessage.length === 0) {
                            console.log(`DEBUG FILTER: Original error message filtered out completely. Assuming normal quit.`);
                            isSuccessfulExit = true;
                        } else if (errorAccumulator.length > 0 && finalErrorMessage.length > 0) {
                            console.log(`DEBUG FILTER: Original error message partially filtered. Remaining: "${finalErrorMessage.replace(/\n/g, '\\n')}"`);
                        }
    
                        const CANCELLATION_CODES_WIN = [3221225786]; 
                        const CANCELLATION_CODES_UNIX = [130, 143]; 
    
                        const isCancelledExit = (
                            (typeof code === 'number' && process.platform === 'win32' && CANCELLATION_CODES_WIN.includes(code)) ||
                            (typeof code === 'number' && (process.platform === 'linux' || process.platform === 'darwin') && CANCELLATION_CODES_UNIX.includes(code))
                        );
    
                        if (isSuccessfulExit) {
                            asirOutputChannel.appendLine(`--- Risa/Asir execution finished successfully ---`);
                            if (typeof code === 'number' && code !== 0) {
                                console.log(`DEBUG: Process exited with non-zero code ${code}, but no error message remaind. Considering it successful.`);
                            }
                            resolve();
                        } else if (typeof code !== 'number' || (code !== 0 && !isCancelledExit)) {
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
                        createResultWebview(context, textToExecute, outputAccumulator, finalErrorMessage);
                    });
                    asirProcess.on('error', (err) => {
                        currentNormalExecuteProcess = null;
                        cleanupTempFile();
                        asirOutputChannel.appendLine(`Failed to start Risa/Asir process: ${err.message}`);
                        vscode.window.showErrorMessage(`Failed to start Risa/Asir: ${err.message}. Check if Risa/Asir is installed correctly and path is set in settings.`);
                        createResultWebview(context, textToExecute, outputAccumulator, err.message);
                        reject(err);
                    });
                });
                
            } catch (err: any) {
                currentNormalExecuteProcess = null;
                cleanupTempFile();
                asirOutputChannel.appendLine(`General error during Risa/Asir execution: ${err.message}`);
                vscode.window.showErrorMessage(`An unexpected error occured during Risa/Asir exection: ${err.message}`);
                createResultWebview(context, textToExecute, outputAccumulator, err.message);
            }
        });
        context.subscriptions.push(disposableAsirExecute);
}