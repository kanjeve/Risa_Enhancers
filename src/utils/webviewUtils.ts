// src/utils/webviewUtils.ts

import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Risa/Asirの結果を表示するための Webview を作成・表示。
 * @param context 拡張機能コンテキスト
 * @param inputCode 実行したRisa/Asirのコード
 * @param outputResult Risa/Asirの計算結果
 * @param errorResult Risa/Asirのエラーメッセージ
 */
export function createResultWebview(context: vscode.ExtensionContext, inputCode: string, outputResult: string, errorResult: string) {
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

/**
 * Webviewに表示するHTMLコンテンツの生成
 * @param inputCode 実行したRisa/Asir のコード
 * @param outputResult Risa/Asirの計算結果
 * @returns HTML 文字列
 */
export function getWebviewContent(inputCode: string, outputResult: string, errorResult: string): string {
    const escapedInputCode = inputCode.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapedOutputResult = outputResult.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, `&gt;`);
    const escapedErrorResult = errorResult.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, `&gt;`);

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