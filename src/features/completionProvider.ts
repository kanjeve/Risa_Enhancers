import * as vscode from 'vscode';
import { loadedPackages, ctrlPackages, PackageInfo } from '../data/packages';

export function registerPackageCompletionProvider(context: vscode.ExtensionContext) {
    const provider = vscode.languages.registerCompletionItemProvider('rr', {
        provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {
            const linePrefix = document.lineAt(position).text.substring(0, position.character);
            const packageMatch = linePrefix.match(/(load|import|ctrl)\(\s*(["']([^"']*)?)?$/);
            if (!packageMatch) {
                return undefined;
            }

            const functionName = packageMatch[1];
            const typedText = packageMatch[3] || '';
            let targetPackages: PackageInfo[] = [];

            if (functionName === 'load' || functionName === 'import') {
                targetPackages = loadedPackages;
            } else if (functionName === 'ctrl') {
                targetPackages = ctrlPackages;
            } 

            const completionItems: vscode.CompletionItem[] = [];
            targetPackages.forEach(pkg => {
                if (pkg.name.startsWith(typedText)) {
                    const item = new vscode.CompletionItem(pkg.name, vscode.CompletionItemKind.Module);
                    item.detail = pkg.description;

                    if (packageMatch[2] && (packageMatch[2].startsWith('"') || packageMatch[2].startsWith("'"))) {
                        item.insertText = pkg.name;
                    } else {
                        item.insertText = new vscode.SnippetString(`"${pkg.name}"`);
                    }
                    completionItems.push(item);
                }
            });
            return completionItems;
        }
    }, '"', '\'');
    context.subscriptions.push(provider)
}