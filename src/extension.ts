import * as vscode from 'vscode';

// The analyzer/runtime is kept in a separate module so the tested
// dependency-analysis implementation remains unchanged.
const runtime = require('./extensionRuntime') as {
    activate(context: vscode.ExtensionContext): void;
    deactivate(): void;
};

export function activate(context: vscode.ExtensionContext): void {
    runtime.activate(context);
}

export function deactivate(): void {
    runtime.deactivate();
}
