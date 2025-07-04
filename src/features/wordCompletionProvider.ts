import * as vscode from 'vscode';
import { ASIR_BUILTIN_FUNCTIONS, ASIR_KEYWORDS } from '../data/builtins';
import { SymbolInfo } from '../features/diagnostics';

export function registerWordCompletionProvider(context:vscode.ExtensionContext, currentDefinedSymbols: Map<string, SymbolInfo>) {
    const provider = vscode.languages.registerCompletionItemProvider('rr', {
        provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
            const linePrefix = document.lineAt(position).text.substring(0, position.character);
            const lastWordMatch = linePrefix.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)$/);
            const lastWord = lastWordMatch ? lastWordMatch[1] : '';
            const completionItems: vscode.CompletionItem[] = [];

            // 定義済みシンボルからの補完
            currentDefinedSymbols.forEach((symbol, name) => {
                if (name.startsWith(lastWord)) {
                    // ... 補完ロジック ...
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
                    } else if (symbol.type === 'module') {
                        item.kind = vscode.CompletionItemKind.Module;
                        item.detail = `Asirモジュール ${name}`;
                    } else if (symbol.type === 'struct') {
                        item.kind = vscode.CompletionItemKind.Struct;
                        item.detail = `Asir構造体 ${name}`;
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
    '(',
    '.'); // ( と . もトリガーにする。
    context.subscriptions.push(provider);
}