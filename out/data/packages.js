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
exports.ctrlPackages = exports.loadedPackages = void 0;
exports.loadPackageData = loadPackageData;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.loadedPackages = [];
exports.ctrlPackages = [];
function loadPackageData(context) {
    const packagesFilePath = path.join(context.extensionPath, 'data', 'packages.json');
    try {
        exports.loadedPackages = JSON.parse(fs.readFileSync(packagesFilePath, 'utf8'));
        console.log(`Loaded ${exports.loadedPackages.length} packages from ${packagesFilePath}`);
    }
    catch (error) {
        console.error(`Failed to load packages.json: ${error}`);
    }
    const ctrlPackagesFilePath = path.join(context.extensionPath, 'data', 'ctrl_packages.json');
    try {
        exports.ctrlPackages = JSON.parse(fs.readFileSync(ctrlPackagesFilePath, 'utf8'));
        console.log(`Loaded ${exports.ctrlPackages.length} ctrl packages from ${ctrlPackagesFilePath}`);
    }
    catch (error) {
        console.error(`Failed to load ctrl_packages.json: ${error}`);
    }
}
//# sourceMappingURL=packages.js.map