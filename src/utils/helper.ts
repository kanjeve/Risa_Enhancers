import * as vscode from 'vscode';
import { ASIR_BUILTIN_FUNCTIONS, ASIR_KEYWORDS } from "../data/builtins";


// --- 括弧チェックのヘルパー関数 ---
export function isMatchingBracket(open: string, close: string): boolean {
    return (open === '(' && close === ')') ||
           (open === '[' && close === ']') ||
           (open === '{' && close === '}');
}

// --- 組み込み関数かキーワードかを判定するヘルパー関数 ---
export function isBuiltInOrKeyword(name:string): boolean {
    return ASIR_KEYWORDS.includes(name) || ASIR_BUILTIN_FUNCTIONS.includes(name);
}

// windowsパスをwslパスに変換するヘルパー関数
export function convertWindowsPathToWsl(winPath: string): string {
    let wslPath = winPath.replace(/\\/g, '/');
    const driveLetterMatch = wslPath.match(/^([A-Za-z]):\//);
    if (driveLetterMatch) {
        wslPath = `/mnt/${driveLetterMatch[1].toLowerCase()}${wslPath.substring(driveLetterMatch[0].length-1)}`;
    }
    return wslPath;
}