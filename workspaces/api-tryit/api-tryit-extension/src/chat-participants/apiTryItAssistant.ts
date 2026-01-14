import * as vscode from 'vscode';
import * as chatUtils from '@vscode/chat-extension-utils';
import { chatModels, refreshChatModels } from './chatModels';
import { getOpenApiSpecsFromWorkspace } from './utils';
import { HttpRequestConfig } from '../tools/APITryTool';

const SYSTEM_PROMPT = `You are an API testing assistant. Help the user test and debug their APIs using the OpenAPI specification or other API description provided. Use the available tools to make API requests as needed. Provide clear and concise responses to the user's queries.`;
const TRY_COMMAND_PROMPT = `Use the "api-try-tool" to make API requests based on the OpenAPI specification provided by the user. If not specifide, always make requests to all resources in available APIs in the specification. Always provide the request details (method, url, headers, body) when making a request. Analyze the response and provide insights or suggestions for further testing or debugging.`;
const commandPrompts: Record<string, string> = {
    'tryAPI': TRY_COMMAND_PROMPT
};

type ToolCallRound = {
    toolCalls: ToolCall[];
};

type ToolCall = {
    name: string;
    input: HttpRequestConfig;
};

export const assistantRequestHandler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<any> => {
    const trytool = vscode.lm.tools.find(tool => tool.name === 'api-try-tool');
    if (!trytool) {
        stream.markdown(`**Warning:** API-try-tool is not available.`);
    }
    const chatModel = request.model;
    const autoModel = chatModel.id === 'auto';
    const tools = trytool ? [trytool] : [];
    const command = request.command;
    stream.progress(`Searching for OpenAPI specifications in the workspace...`);
    const openApiSpecs = await getOpenApiSpecsFromWorkspace();
    if (autoModel) {
        stream.progress(`Selecting a chat model for your request...`);
        if (chatModels === undefined || chatModels.length == 0) {
            await refreshChatModels();
            if (chatModels === undefined || chatModels.length == 0) throw new Error('No chat models are available.');
        }
        for (let i = 0; i < chatModels.length; i++) {
            const model = chatModels[i];
            try {
                stream.progress(`Thinking...`)
                return await sendModelRequest(request, context, stream, tools, model, command,openApiSpecs, token);
            } catch (err) {
                console.error(`[TryIt: model ${model.id} failed]`, err);
                if (i === chatModels.length - 1) {
                    throw new Error('All chat models failed to process the request.');
                }
            }
        }
    }

    return await sendModelRequest(request, context, stream, tools, chatModel, command,openApiSpecs, token);

};

async function sendModelRequest(request: vscode.ChatRequest, chatContext: vscode.ChatContext, stream: vscode.ChatResponseStream, tools: vscode.LanguageModelToolInformation[], chatModel: vscode.LanguageModelChat, command: string | undefined, openApiSpecs: Record<string, string>, token: vscode.CancellationToken) {
    const validCommand = command && commandPrompts[command];
    console.log('[TryIt: command]', command, validCommand);
    const prompt = `System Prompt: ${SYSTEM_PROMPT}
    ${validCommand ? `/${command} Command Prompt: ${commandPrompts[command]}` : ''}
    OpenAPI Specifications: ${JSON.stringify(openApiSpecs)}
    User Prompt: ${request.prompt}`;
    console.log('[TryIt: prompt]', prompt);
    const libResult = chatUtils.sendChatParticipantRequest(
        request,
        chatContext,
        {
            prompt:  prompt,
            responseStreamOptions: {
                stream,
                references: true,
                responseText: true
            },
            tools,
            model: chatModel,
        },
        token
    );
    const result = await libResult.result;
    const toolCallRounds: ToolCallRound[] = result.metadata?.toolCallsMetadata?.toolCallRounds || [];
    if (toolCallRounds && toolCallRounds.length > 0) {
        console.log('[TryIt: toolCallRounds]', toolCallRounds);
        for (const round of toolCallRounds) {
            for (const toolCall of round.toolCalls) {
                console.log('[TryIt: toolCall]', toolCall.name, toolCall.input);
            }
        }
        // for now, the button would open an info message with instruction to add the request manually
        stream.button({
            'title' : 'Add to API Try It Collections',
            'command': 'vscode.open'
        })
    }
    
    return result;
}
