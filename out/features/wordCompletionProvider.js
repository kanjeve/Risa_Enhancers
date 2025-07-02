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
exports.registerWordCompletionProvider = registerWordCompletionProvider;
const vscode = __importStar(require("vscode"));
const builtins_1 = require("../data/builtins");
function registerWordCompletionProvider(context, currentDefinedSymbols) {
    const provider = vscode.languages.registerCompletionItemProvider('rr', {
        provideCompletionItems(document, position) {
            const linePrefix = document.lineAt(position).text.substring(0, position.character);
            const lastWordMatch = linePrefix.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)$/);
            const lastWord = lastWordMatch ? lastWordMatch[1] : '';
            const completionItems = [];
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
                    }
                    else if (symbol.type === 'variable') {
                        item.kind = vscode.CompletionItemKind.Variable;
                        item.detail = `Asir変数 ${name}`;
                    }
                    else if (symbol.type === 'parameter') {
                        item.kind = vscode.CompletionItemKind.Property;
                        item.detail = `関数引数 ${name}`;
                    }
                    else if (symbol.type === 'module') {
                        item.kind = vscode.CompletionItemKind.Module;
                        item.detail = `Asirモジュール ${name}`;
                    }
                    else if (symbol.type === 'struct') {
                        item.kind = vscode.CompletionItemKind.Struct;
                        item.detail = `Asir構造体 ${name}`;
                    }
                    completionItems.push(item);
                }
            });
            // 組み込み関数からの補完
            builtins_1.ASIR_BUILTIN_FUNCTIONS.forEach(funcName => {
                if (funcName.startsWith(lastWord)) {
                    const item = new vscode.CompletionItem(funcName, vscode.CompletionItemKind.Function);
                    item.detail = `Asir組み込み関数 ${funcName}`;
                    item.insertText = new vscode.SnippetString(`${funcName}($0)`);
                    completionItems.push(item);
                }
            });
            // キーワードからの補完
            builtins_1.ASIR_KEYWORDS.forEach(keyword => {
                if (keyword.startsWith(lastWord)) {
                    const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
                    item.detail = `Asir文`;
                    completionItems.push(item);
                }
            });
            return completionItems;
        }
    }, '(', '.'); // ( と . もトリガーにする。
    context.subscriptions.push(provider);
}
//# sourceMappingURL=wordCompletionProvider.js.map