import * as vscode from 'vscode';
export default class OpenTryIt implements vscode.LanguageModelTool<void> {
    
    async invoke(_options: vscode.LanguageModelToolInvocationOptions<void>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult | null | undefined> {
        const choice = await vscode.window.showInformationMessage('Open with Try It?', { modal: true }, 'Open');
        if (choice !== 'Open') {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('User cancelled opening Try It panel.')
            ]);
        }
        vscode.commands.executeCommand('api-tryit.openTryIt');
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('API Try It panel opened.')
        ]);
    }
}