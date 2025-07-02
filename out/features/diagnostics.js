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
exports.currentDefinedSymbols = void 0;
exports.registerDiagnostics = registerDiagnostics;
exports.updateDiagnosticsComprehensive = updateDiagnosticsComprehensive;
const vscode = __importStar(require("vscode"));
const helper_1 = require("../utils/helper");
const pasirser_1 = require("@risa-scope/pasirser");
// 診断コレクション
let diagnosticCollection;
// 定義済みシンボルを保持する Map 
exports.currentDefinedSymbols = new Map();
/**
 * Risa/Asir 言語のコード診断機能の初期化。
 *
 * @param context 拡張機能のコンテキスト。
 * @param sharedDefinedSymbols 他の機能と共有する定義済みシンボル Map。
 * @param outputChannel デバッグメッセージなどを出力するための OutputChannel。
 */
function registerDiagnostics(context, sharedDefinedSymbols, outputChannel) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('risa-enhancers');
    context.subscriptions.push(diagnosticCollection);
    // currentDefinedSymbols を共有された Map に設定
    exports.currentDefinedSymbols = sharedDefinedSymbols;
    const triggerDiagnostics = (document) => {
        if (document.languageId === 'rr') {
            // 解析ロジックを呼び出し、結果を currentDefinedSymbols に格納
            exports.currentDefinedSymbols = updateDiagnosticsComprehensive(document, diagnosticCollection);
            // outputChannel.appendLine(`DEBUG: Diagnostics updated. Found ${currentDefinedSymbols.size} symbols.`);
        }
    };
    // ドキュメントが開かれた、変更された、アクティブエディタが変わったタイミングで診断をトリガー
    vscode.workspace.onDidOpenTextDocument(document => {
        triggerDiagnostics(document);
    }, null, context.subscriptions);
    vscode.workspace.onDidChangeTextDocument(event => {
        triggerDiagnostics(event.document);
    }, null, context.subscriptions);
    // VS Code 起動時にアクティブなエディタがあれば診断をトリガー
    if (vscode.window.activeTextEditor) {
        triggerDiagnostics(vscode.window.activeTextEditor.document);
    }
}
/**
 * コード全体を解析し、診断メッセージを生成し、定義済みシンボルを更新します。
 * 現状は基本的な構文チェックとシンボル収集のみ。
 *
 * @param document 現在のテキストドキュメント。
 * @param diagnosticCollection 診断メッセージを追加するコレクション。
 * @returns 更新された定義済みシンボル Map。
 */
function updateDiagnosticsComprehensive(document, diagnosticCollection) {
    const text = document.getText();
    let diagnostics = [];
    const definedSymbols = new Map(); // この解析で発見されたシンボル
    // antlrによる構文エラーチェック
    const syntaxErrors = (0, pasirser_1.validateSyntax)(text);
    const syntaxDiagnostics = syntaxErrors.map(err => {
        const range = new vscode.Range(new vscode.Position(err.line - 1, err.column), new vscode.Position(err.line - 1, err.column + 1));
        return new vscode.Diagnostic(range, err.message, vscode.DiagnosticSeverity.Error);
    });
    diagnostics.push(...syntaxDiagnostics);
    if (syntaxErrors.length === 0) {
        // --- 括弧の不一致チェック ---
        const stack = [];
        const bracketRegex = /(\(|\)|\[|\]|\{|\})/g;
        let bracketMatch;
        while ((bracketMatch = bracketRegex.exec(text)) !== null) {
            const bracket = bracketMatch[0];
            const position = document.positionAt(bracketMatch.index);
            if (bracket === '(' || bracket === '[' || bracket === '{') {
                stack.push({ type: bracket, position });
            }
            else if (bracket === ')' || bracket === ']' || bracket === '}') {
                if (stack.length === 0) {
                    diagnostics.push(new vscode.Diagnostic(new vscode.Range(position, position.translate(0, 1)), `対応する開き括弧がありません: ${bracket}`, vscode.DiagnosticSeverity.Error));
                }
                else {
                    const lastOpenBracket = stack.pop();
                    if (lastOpenBracket && !(0, helper_1.isMatchingBracket)(lastOpenBracket.type, bracket)) {
                        diagnostics.push(new vscode.Diagnostic(new vscode.Range(position, position.translate(0, 1)), `不正なネスト: '${bracket}' は '${lastOpenBracket.type}' と対応していません`, vscode.DiagnosticSeverity.Error));
                    }
                }
            }
        }
        while (stack.length > 0) {
            const openBracket = stack.pop();
            if (openBracket) {
                diagnostics.push(new vscode.Diagnostic(new vscode.Range(openBracket.position, openBracket.position.translate(0, 1)), `開き括弧 '${openBracket.type}' が閉じられていません`, vscode.DiagnosticSeverity.Error));
            }
        }
        // --- 未定義変数・関数の検出と命名規則のチェック (既存ロジックを強化/移動) ---
        const rawUsedIdentifiers = [];
        const functionDefinitionRegex = /\bdef\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*\{/g;
        const functionDeclarationRegex = /\bfunction\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*;/g;
        const assignmentRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g;
        const externDeclarationRegex = /\bextern\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*;/g;
        const moduleDefinitionRegex = /\bmodule\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\{/g; // ★追加
        const structDefinitionRegex = /\bstruct\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\{/g; // ★追加
        // すべての識別子を捕捉するための一般的な正規表現
        const allIdentifiersInLineRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
        // コメントを除外するためのパターン
        const lineCommentRegex = /#.*/g;
        const blockCommentRegex = /\/\*[\s\S]*?\*\//g;
        const lines = text.split('\n');
        lines.forEach((lineText, lineNum) => {
            let cleanLine = lineText;
            // コメントを除去
            cleanLine = cleanLine.replace(blockCommentRegex, '');
            cleanLine = cleanLine.replace(lineCommentRegex, '');
            // --- 変数定義と命名規則のチェック ---
            assignmentRegex.lastIndex = 0;
            let assignMatch;
            while ((assignMatch = assignmentRegex.exec(cleanLine)) !== null) {
                const varName = assignMatch[1];
                const startPos = document.positionAt(document.offsetAt(new vscode.Position(lineNum, assignMatch.index)));
                const endPos = startPos.translate(0, varName.length);
                if (varName.match(/^[a-z]/)) { // 小文字始まりの変数名
                    diagnostics.push(new vscode.Diagnostic(new vscode.Range(startPos, endPos), `変数名 '${varName}' は大文字で始まる必要があります (Risa/Asir の規則)。`, vscode.DiagnosticSeverity.Error));
                }
                if (varName.match(/^[A-Z]/)) {
                    definedSymbols.set(varName, { name: varName, type: 'variable', definitionRange: new vscode.Range(startPos, endPos) });
                }
            }
            // --- 関数定義と命名規則のチェック ---
            functionDefinitionRegex.lastIndex = 0;
            let funcDefMatch;
            while ((funcDefMatch = functionDefinitionRegex.exec(cleanLine)) !== null) {
                const funcName = funcDefMatch[1];
                const funcNameStartInMatch = funcDefMatch[0].indexOf(funcName);
                const startPos = document.positionAt(document.offsetAt(new vscode.Position(lineNum, funcDefMatch.index + funcNameStartInMatch)));
                const endPos = startPos.translate(0, funcName.length);
                if (funcName.match(/^[A-Z]/)) { // 大文字始まりの関数名
                    diagnostics.push(new vscode.Diagnostic(new vscode.Range(startPos, endPos), `関数名 '${funcName}' は小文字のアルファベットで始まる必要があります (Risa/Asir の規則)。`, vscode.DiagnosticSeverity.Error));
                }
                else {
                    definedSymbols.set(funcName, { name: funcName, type: 'function', definitionRange: new vscode.Range(startPos, endPos) });
                }
                // 仮引数を抽出して定義済みシンボルとして扱う (関数スコープの簡易認識)
                const parameterString = funcDefMatch[2];
                if (parameterString) {
                    const paramNames = parameterString.split(',').map(p => p.trim()).filter(p => p.length > 0);
                    paramNames.forEach(paramName => {
                        // ここで definedSymbols に追加することで、関数内部での引数使用が未定義とならないようにする
                        // ただし、この definedSymbols はファイル全体で共有されるため、厳密なスコープ解析には向かない
                        if (!definedSymbols.has(paramName)) {
                            definedSymbols.set(paramName, { name: paramName, type: 'parameter' });
                        }
                    });
                }
            }
            // --- function 宣言の検出 ---
            functionDeclarationRegex.lastIndex = 0;
            let funcDeclMatch;
            while ((funcDeclMatch = functionDeclarationRegex.exec(cleanLine)) !== null) {
                const funcName = funcDeclMatch[1];
                const funcNameStartInMatch = funcDeclMatch[0].indexOf(funcName);
                const startPos = document.positionAt(document.offsetAt(new vscode.Position(lineNum, funcDeclMatch.index + funcNameStartInMatch)));
                const endPos = startPos.translate(0, funcName.length);
                if (!definedSymbols.has(funcName)) { // 既に定義済みでなければ追加
                    definedSymbols.set(funcName, { name: funcName, type: 'function', definitionRange: new vscode.Range(startPos, endPos) });
                }
                const parametersString = funcDeclMatch[2];
                if (parametersString) {
                    const paramNames = parametersString.split(',').map(p => p.trim()).filter(p => p.length > 0);
                    paramNames.forEach(paramName => {
                        if (!definedSymbols.has(paramName)) {
                            definedSymbols.set(paramName, { name: paramName, type: 'parameter' });
                        }
                    });
                }
            }
            // --- extern 宣言の検出 ---
            externDeclarationRegex.lastIndex = 0;
            let externDeclMatch;
            while ((externDeclMatch = externDeclarationRegex.exec(cleanLine)) !== null) {
                const varName = externDeclMatch[1];
                const varNameStartInMatch = externDeclMatch[0].indexOf(varName);
                const startPos = document.positionAt(document.offsetAt(new vscode.Position(lineNum, externDeclMatch.index + varNameStartInMatch)));
                const endPos = startPos.translate(0, varName.length);
                if (varName.match(/^[a-z]/)) { // extern 変数名も大文字始まり規則
                    diagnostics.push(new vscode.Diagnostic(new vscode.Range(startPos, endPos), `外部変数名 '${varName}' は大文字のアルファベットで始まる必要があります (Risa/Asir の規則)。`, vscode.DiagnosticSeverity.Error));
                }
                else {
                    if (!definedSymbols.has(varName)) {
                        definedSymbols.set(varName, { name: varName, type: 'variable', definitionRange: new vscode.Range(startPos, endPos) });
                    }
                }
            }
            // --- module 定義の検出 --- 
            moduleDefinitionRegex.lastIndex = 0;
            let moduleDefMatch;
            while ((moduleDefMatch = moduleDefinitionRegex.exec(cleanLine)) !== null) {
                const moduleName = moduleDefMatch[1];
                const moduleNameStartInMatch = moduleDefMatch[0].indexOf(moduleName);
                const startPos = document.positionAt(document.offsetAt(new vscode.Position(lineNum, moduleDefMatch.index + moduleNameStartInMatch)));
                const endPos = startPos.translate(0, moduleName.length);
                definedSymbols.set(moduleName, { name: moduleName, type: 'module', definitionRange: new vscode.Range(startPos, endPos) });
            }
            // --- struct 定義の検出 --- 
            structDefinitionRegex.lastIndex = 0;
            let structDefMatch;
            while ((structDefMatch = structDefinitionRegex.exec(cleanLine)) !== null) {
                const structName = structDefMatch[1];
                const structNameStartInMatch = structDefMatch[0].indexOf(structName);
                const startPos = document.positionAt(document.offsetAt(new vscode.Position(lineNum, structDefMatch.index + structNameStartInMatch)));
                const endPos = startPos.translate(0, structName.length);
                // 構造体名の命名規則があればここでチェック
                definedSymbols.set(structName, { name: structName, type: 'struct', definitionRange: new vscode.Range(startPos, endPos) });
            }
            // --- 未定義のシンボルをチェック ---
            allIdentifiersInLineRegex.lastIndex = 0;
            let idMatch;
            while ((idMatch = allIdentifiersInLineRegex.exec(cleanLine)) !== null) {
                const identifierName = idMatch[1];
                const startPos = document.positionAt(document.offsetAt(new vscode.Position(lineNum, idMatch.index)));
                const endPos = startPos.translate(0, identifierName.length);
                rawUsedIdentifiers.push({ name: identifierName, range: new vscode.Range(startPos, endPos), originalLine: cleanLine, originalIndex: idMatch.index });
            }
        });
        rawUsedIdentifiers.forEach(symbol => {
            // ユーザー定義シンボル（このファイル内で定義されたもの）は警告しない
            if (definedSymbols.has(symbol.name)) {
                return;
            }
            // 組み込み関数やキーワードは警告しない
            if ((0, helper_1.isBuiltInOrKeyword)(symbol.name)) {
                return;
            }
            // それ以外の識別子について
            // ここで識別子の種類 (関数呼び出し形式か変数形式か) を判断し、警告を出す
            const afterIdentifier = symbol.originalLine.substring(symbol.originalIndex + symbol.name.length);
            const isFunctionCallForm = afterIdentifier.match(/^\s*\(/);
            if (symbol.name.match(/^[a-z]/)) { // 小文字始まり (関数名の可能性)
                if (isFunctionCallForm) {
                    diagnostics.push(new vscode.Diagnostic(symbol.range, `未定義の関数: '${symbol.name}'`, vscode.DiagnosticSeverity.Warning // Warning レベル
                    ));
                }
                else {
                    // 関数名規則に反するが、変数でもない識別子。厳密な診断はASTが必要。
                    // 現時点では警告を出さないか、別の警告にする
                }
            }
            else { // 大文字始まり (変数の可能性)
                // 大文字始まりだが定義が見つからない変数
                diagnostics.push(new vscode.Diagnostic(symbol.range, `未定義の変数: '${symbol.name}'`, vscode.DiagnosticSeverity.Warning // Warning レベル
                ));
            }
        });
    }
    diagnosticCollection.set(document.uri, diagnostics);
    return definedSymbols;
}
//# sourceMappingURL=diagnostics.js.map