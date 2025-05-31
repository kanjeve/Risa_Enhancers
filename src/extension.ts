import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import * as os from 'os'; 

// パッケージリストの型定義 
interface PackageInfo {
    name: string;
    description: string;
}

let loadedPackages: PackageInfo[] = []; // パッケージリストを保持する変数 
let ctrlPackages: PackageInfo[] = [];   // ctrl 用のパッケージリスト

// ステータスバーにWSL変更ボタンの追加
let asirModeStatusBarItem: vscode.StatusBarItem;

// ステータスバーアイテムの表示を更新する関数
async function updateStatusBarMode(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('risaasirExecutor');
    const useWsl = config.get<boolean>('useWslFromWindows', false);

    if (process.platform === 'win32') {
        // Windowsの場合のみ、モード切り替えボタンを表示
        if (!asirModeStatusBarItem) {
            asirModeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
            asirModeStatusBarItem.command = 'risaasir.toggleExecutionMode'; // クリック時のコマンド
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
    let disposableAsirExecute = vscode.commands.registerCommand('risa_enhancers.executeCode', async () => { // async を追加
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const document = editor.document;
            const selection = editor.selection;
            const textToExecute = document.getText(selection.isEmpty ? undefined : selection);

            // 拡張機能の設定からRisa/Asirのパスを取得
            let command: string;
            let args: string[] = [];
            let displayMessage: string;

            // VS Codeの設定から、WSL経由実行の希望とディストリビューション名を取得
            const config = vscode.workspace.getConfiguration('risaasirExecutor');

            // OSを判定
            const platform = process.platform;
            console.log(`Detected OS platform: ${platform}`);

            if (platform === 'win32') {
                // Windowsの場合 
                const useWslFromWindows = config.get<boolean>('useWslFromWindows',false);
                if (useWslFromWindows) {
                    // Windows上でWSL経由で実行する場合
                    const wslDistribution = config.get<string>('wslDistribution', 'Ubuntu');
                    const asirPathLinux = config.get<string>('asirPathLinux');

                    command = 'wsl'; // wsl を直接呼び出す
                    const wslCommand = `${asirPathLinux || 'asir'} <<'EOF'\n${textToExecute}\nquit;\nEOF`; // WSL内のパスを取得
                    // WSLコマンド: wsl.exe -d <distro_name> <command_to_run_in_wsl>
                    args = ['-d', wslDistribution, `bash`, '-c', wslCommand];
                    displayMessage = `Executing Risa/Asir WSL (${wslDistribution})...`;
                } else {
                    // Windows上でWindowsネイティブのRisa/Asirを実行する場合
                    const asirPathWindows = config.get<string>('asirPathWindows');
                    command = `"${asirPathWindows || 'asir.exe'}"`;
                    args = [];

                    // Windowsネイティブのasir向けに quit; を stdin に追加
                    const fullCommand = textToExecute + '\nquit;\n';

                    asirOutputChannel.clear();
                    asirOutputChannel.show(true);
                    asirOutputChannel.appendLine(`--- Executing Risa/Asir code on Windows natively ---`);
                    // asirOutputChannel.appendLine(`Command: ${command}`);
                    asirOutputChannel.appendLine(`Input:\n${textToExecute}\n---`);

                    try {
                        const process = spawn(command, args, { shell: true }); // shell: true を追加

                        process.stdin.write(fullCommand);
                        process.stdin.end();

                        process.stdout.on('data', (data: Buffer) => {
                            asirOutputChannel.append(data.toString());
                        });
                        process.stderr.on('data', (data: Buffer) => {
                            asirOutputChannel.appendLine(`Error from Risa/Asir: ${data.toString()}`);
                        });
                        process.on('close', (code) => {
                            if (code !== 0) {
                                asirOutputChannel.appendLine(`--- Risa/Asir process exited with code ${code} (Error) ---`);
                                vscode.window.showErrorMessage(`Risa/Asir execution failed with code ${code}. Check 'Risa/Asir CLI Output' for details.`);
                            } else {
                                asirOutputChannel.appendLine(`--- Risa/Asir execution finished successfully ---`);
                            }
                        });
                        process.on('error', (err) => {
                            asirOutputChannel.appendLine(`Failed to start Risa/Asir process: ${err.message}`);
                            vscode.window.showErrorMessage(`Failed to start Risa/Asir: ${err.message}. Check if Risa/Asir is installed correctly and path is set in settings.`);
                        });
                    } catch (err: any) {
                        asirOutputChannel.appendLine(`General error during Risa/Asir execution: ${err.message}`);
                        vscode.window.showErrorMessage(`An unexpected error occurred during Risa/Asir execution: ${err.message}`);
                    }
                    return; // ここで処理を終了
                }
            } else if (platform === 'darwin') {
                // macOSの場合
                const asirPathMac = config.get<string>('asirPathMac');
                command = asirPathMac || 'asir'; // 設定がなければデフォルトのasirを試す
                args = []; // コマンドライン引数は基本的に不要
                displayMessage = 'Executing Risa/Asir on macOS...';
                // macOSもquit;をstdinに送る方式
                const fullCommand = textToExecute + '\nquit;\n';

                asirOutputChannel.clear();
                asirOutputChannel.show(true);
                asirOutputChannel.appendLine(`--- Executing Risa/Asir code on macOS ---`);
                // asirOutputChannel.appendLine(`Command: ${command} ${args.join(' ')}`);
                asirOutputChannel.appendLine(`Input:\n${textToExecute}\n---`);

                try {
                    const process = spawn(command, args);
                    process.stdin.write(fullCommand);
                    process.stdin.end();

                    process.stdout.on('data', (data: Buffer) => {
                        asirOutputChannel.append(data.toString());
                    });
                    process.stderr.on('data', (data: Buffer) => {
                        asirOutputChannel.appendLine(`Error from Risa/Asir: ${data.toString()}`);
                    });
                    process.on('close', (code) => {
                        if (code !== 0) {
                            asirOutputChannel.appendLine(`--- Risa/Asir process exited with code ${code} (Error) ---`);
                            vscode.window.showErrorMessage(`Risa/Asir execution failed with code ${code}. Check 'Risa/Asir CLI Output' for details.`);
                        } else {
                            asirOutputChannel.appendLine(`--- Risa/Asir execution finished successfully ---`);
                        }
                    });
                    process.on('error', (err) => {
                        asirOutputChannel.appendLine(`Failed to start Risa/Asir process: ${err.message}`);
                        vscode.window.showErrorMessage(`Failed to start Risa/Asir: ${err.message}. Check if Risa/Asir is installed correctly and path is set in settings.`);
                    });
                } catch (err: any) {
                    asirOutputChannel.appendLine(`General error during Risa/Asir execution: ${err.message}`);
                    vscode.window.showErrorMessage(`An unexpected error occurred during Risa/Asir execution: ${err.message}`);
                }
                return; // ここで処理を終了
            } else if (platform === 'linux') {
                // Linuxの場合 (WSLを含む)
                const asirPathLinux = config.get<string>('asirPathLinux');
                // WSLで実行する場合は、bash -c "asirPath" の形式を使う
                // ただし、asirPathがWSL内のパスである前提
                command = 'bash';
                const wslCommand = `${asirPathLinux || 'asir'} <<'EOF'\n${textToExecute}\nquit;\nEOF`;
                args = ['-c', wslCommand]; // 設定がなければデフォルトのasirを試す
                displayMessage = 'Executing Risa/Asir on Linux...';
            } else {
                vscode.window.showErrorMessage(`Unsupported OS platform: ${platform}`);
                return;
            }

            asirOutputChannel.clear();
            asirOutputChannel.show(true);
            asirOutputChannel.appendLine(`---${displayMessage} ---`);
            // asirOutputChannel.appendLine(`Command: ${command} ${args.join(' ')}`);
            asirOutputChannel.appendLine(`Input:\n${textToExecute}\n---`);

            try {
                const process = spawn(command, args);

                process.stdout.on('data', (data: Buffer) => {
                    asirOutputChannel.append(data.toString());
                });

                process.stderr.on('data', (data: Buffer) => {
                    asirOutputChannel.appendLine(`Error from Risa/Asir: ${data.toString()}`);
                });

                process.on('close', (code) => {
                    if (code !== 0) {
                        asirOutputChannel.appendLine(`--- Risa/Asir process exited with code ${code} (Error) ---`);
                        vscode.window.showErrorMessage(`Risa/Asir execution failed with code ${code}. Check 'Risa/Asir CLI Output' for details.`);
                    } else {
                        asirOutputChannel.appendLine(`--- Risa/Asir execution finished successfully ---`);
                    }
                });

                process.on('error', (err) => {
                    asirOutputChannel.appendLine(`Failed to start Risa/Asir process: ${err.message}`);
                    vscode.window.showErrorMessage(`Failed to start Risa/Asir: ${err.message}. Check if Risa/Asir is installed correctly and path is set in settings.`);
                });

            } catch (err: any) { // エラーの型を指定
                asirOutputChannel.appendLine(`General error during Risa/Asir execution: ${err.message}`);
                vscode.window.showErrorMessage(`An unexpected error occurred during Risa/Asir execution: ${err.message}`);
            }

        } else {
            vscode.window.showInformationMessage('No active text editor to execute Risa/Asir code.');
        }
    });

    context.subscriptions.push(disposableAsirExecute);

        // --- 実行モードを切り替えるコマンド ---
    let disposableToggleMode = vscode.commands.registerCommand('risaasir.toggleExecutionMode', async () => {
        const config = vscode.workspace.getConfiguration('risaasirExecutor');
        const currentModeIsWsl = config.get<boolean>('useWslFromWindows', false);
        const newModeIsWsl = !currentModeIsWsl; // 現在のモードを反転

        await config.update('useWslFromWindows', newModeIsWsl, vscode.ConfigurationTarget.Workspace);

        // 設定が更新されたので、ステータスバーを再描画
        updateStatusBarMode(context);

        vscode.window.showInformationMessage(`Risa/Asir execution mode switched to: ${newModeIsWsl ? 'WSL' : 'Windows Native'}`);
    });
    context.subscriptions.push(disposableToggleMode);

    // --- ステータスバーアイテムの作成と登録 ---
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'risa_enhancers.executeCode';
    statusBarItem.text = '$(play) Run Risa/Asir';
    statusBarItem.tooltip = 'Execute Risa/Asir code';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem)

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
            updateDiagnostics(document, diagnosticCollection);
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.languageId === 'rr') {
            updateDiagnostics(event.document, diagnosticCollection);
        }
    }, null, context.subscriptions);

    let disposableHelloWorld = vscode.commands.registerCommand('risa-enhancers.helloWorld', () => {
        vscode.window.showInformationMessage('Hello VS Code from Risa Enhancers!');
    });
    context.subscriptions.push(disposableHelloWorld);
}

// コード診断の関数 
function updateDiagnostics(document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection): void {
    if (document.languageId !== 'rr') {
        return;
    }

    const text = document.getText();
    const diagnostics: vscode.Diagnostic[] = [];
    const openBrackets: { [key: string]: number } = { '(': 0, '[': 0, '{': 0 };
    const closeBrackets: { [key: string]: number } = { ')': 0, ']': 0, '}': 0 };

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (openBrackets.hasOwnProperty(char)) {
            openBrackets[char]++;
        } else if (closeBrackets.hasOwnProperty(char)) {
            closeBrackets[char]++;
        }
    }

    if (openBrackets['('] !== closeBrackets[')']) {
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(document.positionAt(text.length), document.positionAt(text.length)),
            '開き括弧と閉じ括弧の数が一致しません',
            vscode.DiagnosticSeverity.Warning
        );
        diagnostics.push(diagnostic);
    }
    if (openBrackets['['] !== closeBrackets[']']) {
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(document.positionAt(text.length), document.positionAt(text.length)),
            '開き角括弧と閉じ角括弧の数が一致しません',
            vscode.DiagnosticSeverity.Warning
        );
        diagnostics.push(diagnostic);
    }
    if (openBrackets['{'] !== closeBrackets['}']) {
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(document.positionAt(text.length), document.positionAt(text.length)),
            '開き中括弧と閉じ中括弧の数が一致しません',
            vscode.DiagnosticSeverity.Warning
        );
        diagnostics.push(diagnostic);
    }

    diagnosticCollection.set(document.uri, diagnostics);
}

export function deactivate() {
    if (asirModeStatusBarItem){
        asirModeStatusBarItem.dispose();  // 拡張機能終了時にアイテムを解法
    }
}