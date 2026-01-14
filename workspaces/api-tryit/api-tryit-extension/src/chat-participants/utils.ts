import * as vscode from 'vscode';
export async function getOpenApiSpecsFromWorkspace(): Promise<Record< string, string>> {
    const openApiSpecs: Record<string, string> = {};
    const files = await vscode.workspace.findFiles('**/*.{yaml,yml,json}', '**/node_modules/**,.vscode/**');
    for (const file of files) {
        const content = await vscode.workspace.fs.readFile(file);
        openApiSpecs[file.fsPath] = Buffer.from(content).toString('utf8');
    }
    return openApiSpecs;
}