import * as vscode from 'vscode';
import axios from 'axios';

export type HttpRequestConfig = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
};

export default class APITryTool implements vscode.LanguageModelTool<HttpRequestConfig> {
    
    async invoke(options: vscode.LanguageModelToolInvocationOptions<HttpRequestConfig>, _token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult | null | undefined> {
        {
            try{
            const response = await axios.request({
                url: options.input?.url,
                method: options.input?.method,
                headers: options.input?.headers,
                data: options.input?.body,
            });
			return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(JSON.stringify({response: response.data,
                status: response.status
            }))]);} catch (error: any) {
                console.error('Error in APITryTool invoke:', error);
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Error from request: ${JSON.stringify(
                    { error: error.message,
                        status: error.status,
                        data: error.response?.data
                     })}`)
                ]);
            }
        }
    }

    prepareInvocation?(options: vscode.LanguageModelToolInvocationPrepareOptions<HttpRequestConfig>, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
        return{invocationMessage: `Sending ${options.input?.method || ""} request to API ${options.input?.url||" "}...`};
    }

}