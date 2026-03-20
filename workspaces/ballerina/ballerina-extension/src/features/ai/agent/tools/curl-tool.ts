// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com/) All Rights Reserved.

// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at

// http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied. See the License for the
// specific language governing permissions and limitations
// under the License.

import { tool } from 'ai';
import { z } from 'zod';
import axios, { AxiosError, AxiosResponse } from 'axios';
import { CopilotEventHandler } from '../../utils/events';
import { readFileSync } from 'fs';
import { basename, isAbsolute, resolve } from 'path';

export const CURL_TOOL_NAME = "curlRequest";

const CURL_REQUEST_TIMEOUT_MS = 30_000;


export const HTTPInputSchema = z.object({
    curlCommand: z.string().describe("The curl command to execute, including the URL, method, headers, and body. For example: `curl -X POST https://api.example.com/data -H 'Content-Type: application/json' -d '{\"key\":\"value\"}'`"),
    testScenario: z.string().max(30).optional().describe("An optional identifier (max 30 chars) to group requests belonging to the same test scenario.")
});

export type HTTPInput = z.infer<typeof HTTPInputSchema>;

type HTTPResponse = {
    data: unknown;
    status: number;
    statusText: string;
    headers: Record<string, string>;
};
type HTTPErrorResponse = {
    error: true;
    message: string;
    code?: string;
    response?: HTTPResponse
};

function createSuccessResponse(response: AxiosResponse): HTTPResponse {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(response.headers)) {
        if (typeof value === 'string') {
            headers[key] = value;
        } else if (Array.isArray(value)) {
            headers[key] = value.join(', ');
        }
    }
    return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
        headers
    };
}

function createErrorResponse(error: AxiosError): HTTPErrorResponse {
    return {
        error: true,
        message: error.message,
        code: error.code,
        response: error.response ? createSuccessResponse(error.response) : undefined
    };
}

export function createCurlTool(eventHandler: CopilotEventHandler, defaultProjectPath?: string) {
    return tool({
        description: `A tool to make requests to a given API endpoint. Provide the endpoint URL and request details to get a response. Use this tool for testing and debugging HTTP endpoints.`,
        inputSchema: HTTPInputSchema,
		execute: async (input, context?: { toolCallId?: string; projectPath?: string }): Promise<HTTPResponse | HTTPErrorResponse> => {
			return await executeCurlRequest(input, eventHandler, context, defaultProjectPath);
		}
    });
}

/**
 * Parse a curl command string into components
 * Handles quoted strings and various curl options including multipart form data
 */
function parseCurl(curl: string): {
	method: string;
	url: string;
	headers: Record<string, string>;
	data: unknown;
	formFields?: Array<{ name: string; value: string; isFile: boolean; fileName?: string }>;
	dataBinaryFilePath?: string;
} {
	// Remove line breaks and continuations
	const cleanCurl = curl.replace(/\\\s*\n/g, ' ').trim();
	
	let method = 'GET';
	let methodExplicitlySet = false;
	let url = '';
	const headers: Record<string, string> = {};
	let body = '';
	let dataBinaryFilePath: string | undefined;
	let bodyFromDataBinary = false;
	const formFields: Array<{ name: string; value: string; isFile: boolean; fileName?: string }> = [];
	
	// Parse the curl string while respecting quoted values
	const tokens = tokenizeCurl(cleanCurl);
	
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		const lowerToken = token.toLowerCase();
		
		if (token === 'curl') {
			continue;
		}
		
		if (token === '-X' || token === '--request') {
			if (i + 1 < tokens.length) {
				method = tokens[i + 1];
				methodExplicitlySet = true;
				i++;
			}
		} else if (lowerToken.startsWith('--request=')) {
			method = token.substring('--request='.length);
			methodExplicitlySet = true;
		} else if (token === '-H' || token === '--header') {
			if (i + 1 < tokens.length) {
				const headerStr = tokens[i + 1];
				const colonIndex = headerStr.indexOf(':');
				if (colonIndex !== -1) {
					const key = headerStr.substring(0, colonIndex).trim();
					const value = headerStr.substring(colonIndex + 1).trim();
					headers[key] = value;
				}
				i++;
			}
		} else if (lowerToken.startsWith('--header=')) {
			const headerStr = token.substring('--header='.length);
			const colonIndex = headerStr.indexOf(':');
			if (colonIndex !== -1) {
				const key = headerStr.substring(0, colonIndex).trim();
				const value = headerStr.substring(colonIndex + 1).trim();
				headers[key] = value;
			}
		} else if (token === '-d' || token === '--data' || token === '--data-raw') {
			if (i + 1 < tokens.length) {
				body = tokens[i + 1];
				i++;
			}
		} else if (token === '--data-urlencode') {
			if (i + 1 < tokens.length) {
				const nextPart = tokens[i + 1];
				body = body ? `${body}&${nextPart}` : nextPart;
				i++;
			}
		} else if (token === '--data-binary') {
			if (i + 1 < tokens.length) {
				const binaryValue = tokens[i + 1];
				if (binaryValue.startsWith('@')) {
					dataBinaryFilePath = binaryValue.substring(1);
					body = '';
				} else {
					body = normalizeEscapedControlChars(binaryValue);
				}
				bodyFromDataBinary = true;
				i++;
			}
		} else if (lowerToken.startsWith('--data-binary=')) {
			const binaryValue = token.substring('--data-binary='.length);
			if (binaryValue.startsWith('@')) {
				dataBinaryFilePath = binaryValue.substring(1);
				body = '';
			} else {
				body = normalizeEscapedControlChars(binaryValue);
			}
			bodyFromDataBinary = true;
		} else if (token === '-F' || token === '--form') {
			if (i + 1 < tokens.length) {
				const formField = tokens[i + 1];
				const eqIndex = formField.indexOf('=');
				if (eqIndex !== -1) {
					const name = formField.substring(0, eqIndex).trim();
					const valueWithPrefix = formField.substring(eqIndex + 1).trim();
					const parsedField = parseMultipartFieldValue(valueWithPrefix);
					formFields.push({
						name,
						value: parsedField.value,
						isFile: parsedField.isFile,
						fileName: parsedField.fileName
					});
				}
				i++;
			}
		} else if (token === '--form-string') {
			if (i + 1 < tokens.length) {
				const formField = tokens[i + 1];
				const eqIndex = formField.indexOf('=');
				if (eqIndex !== -1) {
					const name = formField.substring(0, eqIndex).trim();
					const value = formField.substring(eqIndex + 1).trim();
					formFields.push({ name, value, isFile: false });
				}
				i++;
			}
		} else if (token.startsWith('http://') || token.startsWith('https://')) {
			url = token;
		}
	}
	
	// Parse body based on Content-Type
	let data: unknown = body;
	let contentType: string | undefined;

	for (const key in headers) {
	if (key.toLowerCase() === 'content-type') {
		contentType = headers[key];
		break;
	}
	}
	
	if (contentType && body) {
		if (contentType.toLowerCase().includes('application/json')) {
			try {
				data = JSON.parse(body);
			} catch (error) {
				console.warn('Failed to parse JSON body:', error);
				// Keep as string if parsing fails
				data = body;
			}
		}
		if (contentType.toLowerCase().includes('multipart/form-data') && bodyFromDataBinary) {
			data = normalizeEscapedControlChars(body);
		}
	}
	
	// curl defaults to POST when a body or form fields are supplied and no method is explicitly set
	if ((body || formFields.length > 0 || dataBinaryFilePath) && !methodExplicitlySet) {
		method = 'POST';
	}

	return {
		method,
		url,
		headers,
		data,
		formFields: formFields.length > 0 ? formFields : undefined,
		dataBinaryFilePath
	};
}

function normalizeEscapedControlChars(value: string): string {
	return value
		.replace(/\\r\\n/g, '\r\n')
		.replace(/\\n/g, '\n')
		.replace(/\\r/g, '\r');
}

function stripWrappingQuotes(value: string): string {
	if (value.length < 2) {
		return value;
	}
	const startsWithSingle = value.startsWith("'");
	const endsWithSingle = value.endsWith("'");
	const startsWithDouble = value.startsWith('"');
	const endsWithDouble = value.endsWith('"');
	if ((startsWithSingle && endsWithSingle) || (startsWithDouble && endsWithDouble)) {
		return value.substring(1, value.length - 1);
	}
	return value;
}

function parseMultipartFieldValue(valueWithPrefix: string): { value: string; isFile: boolean; fileName?: string } {
	if (!valueWithPrefix.startsWith('@')) {
		return { value: stripWrappingQuotes(valueWithPrefix), isFile: false };
	}

	const fileSpec = valueWithPrefix.substring(1).trim();
	const parts = fileSpec.split(';').map((part) => part.trim()).filter(Boolean);
	const pathPart = parts[0] ?? '';
	let fileName: string | undefined;

	for (const part of parts.slice(1)) {
		const eqIndex = part.indexOf('=');
		if (eqIndex === -1) {
			continue;
		}
		const key = part.substring(0, eqIndex).trim().toLowerCase();
		const value = stripWrappingQuotes(part.substring(eqIndex + 1).trim());
		if (key === 'filename' && value) {
			fileName = value;
		}
	}

	return {
		value: stripWrappingQuotes(pathPart),
		isFile: true,
		fileName
	};
}

function resolveInputPath(inputPath: string, projectPath?: string): string {
	const normalized = stripWrappingQuotes(inputPath.trim());
	if (!normalized) {
		return normalized;
	}
	if (isAbsolute(normalized)) {
		return normalized;
	}
	if (!projectPath) {
		throw new Error(`Relative path '${normalized}' requires a project path in execution context`);
	}
	return resolve(projectPath, normalized);
}

/**
 * Tokenize curl command while respecting quoted strings
 */
enum TokenScope {
	Plain = "Plain",
	InSingleQuotes = "InSingleQuotes",
	InDoubleQuotes = "InDoubleQuotes",
}

function tokenizeCurl(curl: string): string[] {
	const tokens: string[] = [];
	let current = '';
	let scope = TokenScope.Plain;
	
	for (let i = 0; i < curl.length; i++) {
		const char = curl[i];
		
		// Handle escape sequences inside quotes: \\ → \, \" → " (double quotes), \' → ' (single quotes)
		if (scope !== TokenScope.Plain && char === '\\' && i + 1 < curl.length) {
			const nextChar = curl[i + 1];
			if (nextChar === '\\' ||
				(scope === TokenScope.InSingleQuotes && nextChar === "'") ||
				(scope === TokenScope.InDoubleQuotes && nextChar === '"')) {
				current += nextChar;
				i++;
				continue;
			}
		}
		
		if (char === "'" && scope === TokenScope.Plain) {
			scope = TokenScope.InSingleQuotes;
		} else if (char === "'" && scope === TokenScope.InSingleQuotes) {
			scope = TokenScope.Plain;
		} else if (char === '"' && scope === TokenScope.Plain) {
			scope = TokenScope.InDoubleQuotes;
		} else if (char === '"' && scope === TokenScope.InDoubleQuotes) {
			scope = TokenScope.Plain;
		} else if (/\s/.test(char) && scope === TokenScope.Plain) {
			if (current) {
				tokens.push(current);
				current = '';
			}
		} else {
			current += char;
		}
	}
	
	if (current) {
		tokens.push(current);
	}
	
	return tokens;
}

export const executeCurlRequest = async (
	input: HTTPInput,
	eventHandler: CopilotEventHandler,
	context?: { toolCallId?: string; projectPath?: string },
	defaultProjectPath?: string
): Promise<HTTPResponse | HTTPErrorResponse> => {
	const toolCallId = context?.toolCallId || `fallback-${Date.now()}`;
    const projectPath = context?.projectPath || defaultProjectPath;
    const parsedRequest = parseCurl(input.curlCommand);
	const { formFields, dataBinaryFilePath, ...baseRequest } = parsedRequest;
    try {
		eventHandler({
            type: "tool_call",
            toolName: CURL_TOOL_NAME,
            toolInput: { request: parsedRequest, scenario: input.testScenario },
            toolCallId
        });
        
        // Handle multipart form data
		let requestConfig = { ...baseRequest, timeout: CURL_REQUEST_TIMEOUT_MS };
		if (formFields && formFields.length > 0) {
            const formData = new FormData();
            
			for (const field of formFields) {
                try {
                    if (field.isFile) {
                        // Read file and add to form data
						const filePath = resolveInputPath(field.value, projectPath);
						const fileContent = readFileSync(filePath);
						const fileName = field.fileName || basename(filePath);
						formData.append(field.name, new Blob([new Uint8Array(fileContent)]), fileName);
                    } else {
                        // Add regular field
                        formData.append(field.name, field.value);
                    }
                } catch (error) {
                    const fileError: HTTPErrorResponse = {
                        error: true,
                        message: `Failed to read file '${field.value}': ${error instanceof Error ? error.message : String(error)}`
                    };
                    const toolOutput = { request: parsedRequest, scenario: input.testScenario, output: fileError };
                    eventHandler({
                        type: "tool_result",
                        toolName: CURL_TOOL_NAME,
                        toolOutput: toolOutput,
                        toolCallId
                    });
                    return fileError;
                }
            }
            
            // Remove Content-Type header so axios sets it with proper boundary
            const headers = { ...parsedRequest.headers };
            delete headers['Content-Type'];
            delete headers['content-type'];
            
            requestConfig = {
                ...requestConfig,
				headers,
                data: formData
            };
        }

		if (dataBinaryFilePath) {
			try {
				const filePath = resolveInputPath(dataBinaryFilePath, projectPath);
				const fileContent = readFileSync(filePath);
				requestConfig = {
					...requestConfig,
					data: fileContent
				};
			} catch (error) {
				const fileError: HTTPErrorResponse = {
					error: true,
					message: `Failed to read data-binary file '${dataBinaryFilePath}': ${error instanceof Error ? error.message : String(error)}`
				};
				const toolOutput = { request: parsedRequest, scenario: input.testScenario, output: fileError };
				eventHandler({
					type: "tool_result",
					toolName: CURL_TOOL_NAME,
					toolOutput,
					toolCallId
				});
				return fileError;
			}
		}
        
        const response = await axios.request(requestConfig);
		const requestOutput = createSuccessResponse(response);
		const toolOutput = { request: parsedRequest, scenario: input.testScenario, output: requestOutput };
		eventHandler({
            type: "tool_result",
            toolName: CURL_TOOL_NAME,
            toolOutput: toolOutput,
            toolCallId
        });
        return requestOutput;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const errorOutput = createErrorResponse(error);
            const toolOutput = { request: parsedRequest, scenario: input.testScenario, output: errorOutput };
            eventHandler({
                type: "tool_result",
                toolName: CURL_TOOL_NAME,
                toolOutput: toolOutput,
                toolCallId
            });
            return errorOutput;
        }
        const genericErrorOutput: HTTPErrorResponse = {
            error: true,
            message: error instanceof Error ? error.message : String(error),
        };
        const toolOutput = { request: parsedRequest, scenario: input.testScenario, output: genericErrorOutput };
        eventHandler({
            type: "tool_result",
            toolName: CURL_TOOL_NAME,
            toolOutput: toolOutput,
            toolCallId
        });
        return genericErrorOutput;
    }
};
