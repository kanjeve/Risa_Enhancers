import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode'; // context のため

export interface PackageInfo {
    name: string;
    description: string;
}

export let loadedPackages: PackageInfo[] = [];
export let ctrlPackages: PackageInfo[] = [];

export function loadPackageData(context: vscode.ExtensionContext) {
    const packagesFilePath = path.join(context.extensionPath, 'data', 'packages.json');
    try {
        loadedPackages = JSON.parse(fs.readFileSync(packagesFilePath, 'utf8'));
        console.log(`Loaded ${loadedPackages.length} packages from ${packagesFilePath}`);
    } catch (error) {
        console.error(`Failed to load packages.json: ${error}`);
    }
    const ctrlPackagesFilePath = path.join(context.extensionPath, 'data', 'ctrl_packages.json');
    try {
        ctrlPackages = JSON.parse(fs.readFileSync(ctrlPackagesFilePath, 'utf8'));
        console.log(`Loaded ${ctrlPackages.length} ctrl packages from ${ctrlPackagesFilePath}`);
    } catch (error) {
        console.error(`Failed to load ctrl_packages.json: ${error}`);
    }
}