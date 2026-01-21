import * as vscode from 'vscode';
export default class OpenTryIt implements vscode.LanguageModelTool<void> {
    
    async invoke(_options: vscode.LanguageModelToolInvocationOptions<void>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult | null | undefined> {
        vscode.commands.executeCommand('api-tryit.openTryIt');
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('API Try It panel opened.')
        ]);
    }
    prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<void>, token: vscode.CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
        return {
            confirmationMessages: {
                title: 'Open API Try It',
                message: new vscode.MarkdownString('Open this file in Try It view')
            }
        };
    }
}