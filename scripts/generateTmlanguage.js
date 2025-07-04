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
    tmLanguage = {};
}

// トップレベルの上書き
tmLanguage.$schema = "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json";
tmLanguage.name = "Asir";
tmLanguage.scopeName = "source.rr";
tmLanguage.fileTypes = ["rr"]; // 必要に応じて設定
tmLanguage.patterns = [
    { "include": "#comments" },
    { "include": "#strings" },

    { "include": "#functions" },
    { "include": "#function-parameters"},
    { "include": "#variables" },
    { "include": "#modules" },
    { "include": "#structs" },

    { "include": "#keywords" },
    { "include": "#language-constants" },
    { "include": "#types" },

    { "include": "#numbers" },
    { "include": "#operators" },
    { "include": "#built-in-functions" },

    { "include": "#punctuation" }
];

// repositolyセクションの存在保障
if (!tmLanguage.repository) {
    tmLanguage.repository = {};
}
const ensureRepositorySection = (sectionName) => {
    if (!tmLanguage.repository[sectionName]) {
        tmLanguage.repository[sectionName] = { "patterns": [] };
    }
};
ensureRepositorySection("comments");
ensureRepositorySection("keywords");
ensureRepositorySection("strings");
ensureRepositorySection("numbers");
ensureRepositorySection("operators");
ensureRepositorySection("built-in-functions");
ensureRepositorySection("language-constants");
ensureRepositorySection("types");
ensureRepositorySection("punctuation");
ensureRepositorySection("functions");
ensureRepositorySection("variables");
ensureRepositorySection("modules");
ensureRepositorySection("structs");
ensureRepositorySection("function-parameters");


// patternsの上書き
// comments
tmLanguage.repository.comments = {
    "patterns": [
        {
            "name": "comment.block.rr",
            "begin": "/\\*",
            "end": "\\*/",
            "patterns": [
                { "name": "comment.block.documentation.rr", "match": "(@[a-zA-Z]+)" }
            ]
        }
    ]
};
// keywords
tmLanguage.repository.keywords = {
    "patterns": [
        {
            "name": "keyword.control.rr",
            "match": `\\b(${ASIR_KEYWORDS.join('|')})\\b`
        }
    ]
};
// strings
tmLanguage.repository.strings = {
    "name": "string.quoted.double.rr",
    "begin": "\"",
    "end": "\"",
    "patterns": [ 
        { "name": "constant.character.escape.rr", "match": "\\\\." } 
    ]
};
// numbers
tmLanguage.repository.numbers = {
    "patterns": [
        {
            "name": "constant.numeric.rr",
            "match": "\\b\\d+(\\.\\d*)?([eE][+-]?\\d+)?\\b"
        }
    ]
};
// operators
tmLanguage.repository.operators = {
    "patterns":[
        {
            "name": "keyword.operator.rr",
            "match": "[+\\-*/%=<>&|!^]"
        }
    ]
};
// built-in-functions 
const escapedBuiltinFunctions = ASIR_BUILTIN_FUNCTIONS.map(f => f.replace(/[@.]/g, '\\$&'));
tmLanguage.repository['built-in-functions'] = {
    "patterns": [
        {
            "name": "support.function.builtin.rr",
            "match": `\\b(${escapedBuiltinFunctions.join('|')})\\b(\\s*\\()`,
            "captures": {
                "1": { "name": "support.function.builtin.rr" },
                "2": { "name": "punctuation.bracket.parenthesis.rr" }
            },
            "patterns": [
                { "include": "$self" } 
            ]
        }
    ]
};
// language-constants
tmLanguage.repository['language-constants'] = {
    "patterns": [
        {
            "name": "constant.language.rr",
            "match": "\\b(true|false|null)\\b"
        }
    ]
};
// types
tmLanguage.repository.types = {
    "patterns": [
        {
            "name": "storage.type.rr",
            "match": "\\b(int|poly|list|matrix|vector)\\b"
        }
    ]
};
// punctuation
tmLanguage.repository.punctuation = {
    "patterns": [
        { "name": "punctuation.separator.delimiter.rr", "match": "[,;:]" },
        { "name": "punctuation.bracket.square.rr", "match": "[\\[\\]]" },
        { "name": "punctuation.bracket.curly.rr", "match": "[{}]" },
        { "name": "punctuation.bracket.parenthesis.rr", "match": "[()]" }
    ]
};
// functions
tmLanguage.repository.functions = {
        "patterns":[
        {
            "name": "entity.name.function.rr",
            "begin": "\\b(def|function|localf)\\s+([a-z][a-zA-Z0-9_]*)\\s*\\(",
            "beginCaptures": {
                "1": { "name": "keyword.control.rr" },
                "2": { "name": "entity.name.function.rr" }
            },
            "end": "\\}",
            "endCaptures": {
                "0": { "name": "punctuation.bracket.curly.rr" } 
            },
            "patterns": [
                { "include": "#comments" },        
                { "include": "#strings" },         
                { "include": "#numbers" },        
                { "include": "#operators" },       
                { "include": "#keywords" },       
                { "include": "#built-in-functions" }, 
                { "include": "#language-constants" },
                { "include": "#types" },  
                { "include": "#punctuation" },   
                { "include": "#variables" }
            ]
        }
    ]
};
// variables
tmLanguage.repository.variables = {
    "patterns": [
        {
            "name": "variable.other.rr",
            "match": "\\b(extern|global|local|static)\\s+([A-Z][a-zA-Z0-9_]*)\\b",
            "captures": {
                "2": { "name": "variable.other.rr" }
            }
        },
        {
            "name": "variable.other.rr",
            "match": "\\b([A-Z][a-zA-Z0-9_]*)\\s*=", 
            "captures": {
                "1": { "name": "variable.other.rr" }
            }
        },
        {
            "name": "variable.other.rr",
            "match": "\\b([A-Z][a-zA-Z0-9_]*)\\b(?!\\s*\\()" 
        }
    ]
};
// modules
tmLanguage.repository.modules = {
    "patterns": [
        {
            "name": "entity.name.module.rr",
            "match": "\\b(module)\\s+([a-z][a-zA-Z0-9_]*)\\b",
            "captures": {
                "2": { "name": "entity.name.module.rr" }
            }
        }
    ]
};
// structs
tmLanguage.repository.structs = {
    "patterns": [
        {
            "name": "entity.name.struct.rr",
            "match": "\\b(struct)\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\b",
            "captures": {
                "2": { "name": "entity.name.struct.rr" }
            }
        }
    ]
};
// function-parameters 
tmLanguage.repository['function-parameters'] = { 
    "patterns": [
        {
            "name": "variable.other.rr",
            "match": "(?<=\\([^)]*\\b)([a-zA-Z_][a-zA-Z0-9_]*)(?=\\b[^)]*\\))"
        }
    ]
};


fs.writeFileSync(tmLanguagePath, JSON.stringify(tmLanguage, null, 4), 'utf8');
console.log('rr.tmLanguage.json updated successfully with data from builtins.ts!');