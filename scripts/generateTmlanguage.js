import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url'; 


const ASIR_KEYWORDS = [
    'if', 'while', 'for', 'return', 'break', 'continue', 'static', 'struct', 'do', 'else', 'extern',
    'def', 'endmodule', 'function', 'global', 'local', 'localif', 'module',
    'car', 'cdr', 'getopt', 'newstruct', 'map', 'pari', 'quote', 'recmap', 'timer',
    'end', 'quit', 'true','false',
];

export const ASIR_BUILTIN_FUNCTIONS = [
    'load', 'import', 'ctrl', 'cputime', 'append', 'gcd', 'list', 'matrix', 'print',
    'det', 'inv', 'sin', 'cos', 'tan', 'log', 'exp', 'sqrt', 'abs', 'floor', 'ceil',
    'round', 'eval', 'quote', 'map', 'reduce', 'length', 'typeof', 'char', 'size',
    '@pi', '@e', 
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tmLanguagePath = path.join(__dirname, '..', 'syntaxes', 'rr.tmLanguage.json');

// 既存のtmLanguage.jsonを読み込む
let tmLanguage = {};
try {
    tmLanguage = JSON.parse(fs.readFileSync(tmLanguagePath, 'utf8'));
} catch (e) {
    console.error(`Error reading ${tmLanguagePath}:`, e);
    // ファイルが存在しない場合は、基本構造を初期化
    tmLanguage = {
        "scopeName": "source.rr",
        "fileTypes": ["rr"],
        "patterns": []
    };
}

// 既存のパターンを保持しつつ、キーワードと組み込み関数部分を更新
// もしpatternsが配列でない場合や存在しない場合は初期化
if (!Array.isArray(tmLanguage.patterns)) {
    tmLanguage.patterns = [];
}

// 既存のキーワードと組み込み関数のパターンを削除（重複を避けるため）
tmLanguage.patterns = tmLanguage.patterns.filter(p =>
    !p.name || (!p.name.includes('keyword.control.rr') && !p.name.includes('support.function.builtin.rr'))
);

// キーワードのパターンを追加
tmLanguage.patterns.push({
    "name": "keyword.control.rr",
    "match": `\\b(${ASIR_KEYWORDS.join('|')})\\b`
});

// 組み込み関数のパターン
const escapedBuiltinFunctions = ASIR_BUILTIN_FUNCTIONS.map(f => f.replace(/[@.]/g, '\\$&')); // @や.をエスケープ
tmLanguage.patterns.push({
    "name": "support.function.builtin.rr",
    "match": `\\b(${escapedBuiltinFunctions.join('|')})\\b`
});

fs.writeFileSync(tmLanguagePath, JSON.stringify(tmLanguage, null, 4), 'utf8');
console.log('rr.tmLanguage.json updated successfully with data from builtins.ts!');