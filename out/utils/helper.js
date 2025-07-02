"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMatchingBracket = isMatchingBracket;
exports.isBuiltInOrKeyword = isBuiltInOrKeyword;
exports.convertWindowsPathToWsl = convertWindowsPathToWsl;
const builtins_1 = require("../data/builtins");
// --- 括弧チェックのヘルパー関数 ---
function isMatchingBracket(open, close) {
    return (open === '(' && close === ')') ||
        (open === '[' && close === ']') ||
        (open === '{' && close === '}');
}
// --- 組み込み関数かキーワードかを判定するヘルパー関数 ---
function isBuiltInOrKeyword(name) {
    return builtins_1.ASIR_KEYWORDS.includes(name) || builtins_1.ASIR_BUILTIN_FUNCTIONS.includes(name);
}
// windowsパスをwslパスに変換するヘルパー関数
function convertWindowsPathToWsl(winPath) {
    let wslPath = winPath.replace(/\\/g, '/');
    const driveLetterMatch = wslPath.match(/^([A-Za-z]):\//);
    if (driveLetterMatch) {
        wslPath = `/mnt/${driveLetterMatch[1].toLowerCase()}${wslPath.substring(driveLetterMatch[0].length - 1)}`;
    }
    return wslPath;
}
//# sourceMappingURL=helper.js.map