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
exports.registerPackageCompletionProvider = registerPackageCompletionProvider;
const vscode = __importStar(require("vscode"));
const packages_1 = require("../data/packages");
function registerPackageCompletionProvider(context) {
    const provider = vscode.languages.registerCompletionItemProvider('rr', {
        provideCompletionItems(document, position, token, context) {
            const linePrefix = document.lineAt(position).text.substring(0, position.character);
            const packageMatch = linePrefix.match(/(load|import|ctrl)\(\s*(["']([^"']*)?)?$/);
            if (!packageMatch) {
                return undefined;
            }
            const functionName = packageMatch[1];
            const typedText = packageMatch[3] || '';
            let targetPackages = [];
            if (functionName === 'load' || functionName === 'import') {
                targetPackages = packages_1.loadedPackages;
            }
            else if (functionName === 'ctrl') {
                targetPackages = packages_1.ctrlPackages;
            }
            const completionItems = [];
            targetPackages.forEach(pkg => {
                if (pkg.name.startsWith(typedText)) {
                    const item = new vscode.CompletionItem(pkg.name, vscode.CompletionItemKind.Module);
                    item.detail = pkg.description;
                    if (packageMatch[2] && (packageMatch[2].startsWith('"') || packageMatch[2].startsWith("'"))) {
                        item.insertText = pkg.name;
                    }
                    else {
                        item.insertText = new vscode.SnippetString(`"${pkg.name}"`);
                    }
                    completionItems.push(item);
                }
            });
            return completionItems;
        }
    }, '"', '\'');
    context.subscriptions.push(provider);
}
//# sourceMappingURL=completionProvider.js.map