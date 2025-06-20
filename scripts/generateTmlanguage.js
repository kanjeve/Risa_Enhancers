const fs = require('fs');
const path = require('path');

const { ASIR_KEYWORDS, ASIR_BUILTIN_FUNCTIONS} = require('../out/builtins.js');

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