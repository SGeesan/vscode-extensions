import * as vscode from 'vscode';
let chatModels: vscode.LanguageModelChat[] | undefined = undefined;
export async function refreshChatModels() {
    chatModels = await vscode.lm.selectChatModels();
}
// Listen for changes in available chat models and refresh the list
vscode.lm.onDidChangeChatModels(() => {
    refreshChatModels();
});
export { chatModels };