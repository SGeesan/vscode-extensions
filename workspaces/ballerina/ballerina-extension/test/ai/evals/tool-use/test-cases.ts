// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com) All Rights Reserved.

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

export type ToolCallThreshold = {
    maxCalls: number;
    minCalls: number;
};

type TestCaseDefinition = {
    prompt: string;
    projectPath: string;
    toolCallThresholds?: Map<string, ToolCallThreshold>; // Map of tool name to its call thresholds
};

export const httpInitTestCases: Array<TestCaseDefinition> = [
    {
        // Long JSON payload — e-commerce order submission
        prompt: "I need to build a mock HTTP service for an e-commerce order submission. When a client POSTs to /orders I want it to accept a full order payload that includes: orderId, customerId, customerName, customerEmail, a shippingAddress object with street, city, state, zip, and country, a billingAddress object with the exact same sub-fields, an items array where every entry has productId, name, quantity, unitPrice, discount, category, and sku, a paymentMethod object with type, cardLastFour, and cardHolder, and top-level fields couponCode, notes, priority, and createdAt. The response just needs to come back with the total number of line items and a hardcoded confirmation number — no real database or payment gateway, this is purely a mock. Once the service is written please send a test request with a realistic fully-filled payload and show me that the response comes back correctly.",
        projectPath: "bi_init",
        toolCallThresholds: new Map([["curlRequest", { minCalls: 1, maxCalls: 6 }]])
    },
    {
        // Many request headers — multi-tenant API gateway context propagation
        prompt: "I'm building a multi-tenant API where each request carries a bunch of context headers that downstream services need to inspect. Can you create a mock HTTP service with a GET /profile endpoint that reads the following headers from the incoming request and returns them as a JSON object: X-Tenant-Id, X-Correlation-Id, X-Request-Source, X-Client-Version, X-Device-Id, X-Session-Token, X-User-Role, X-Feature-Flags, X-Timezone, and X-Locale. If a header is not present in the request it should show up as null in the response rather than being omitted. No external dependencies or config files — just a self-contained local service. After writing the service, fire a request that includes all ten of those headers and confirm each one shows up correctly in the JSON response.",
        projectPath: "bi_init",
        toolCallThresholds: new Map([["curlRequest", { minCalls: 1, maxCalls: 6 }]])
    },
    {
        // Many query parameters — product catalog search
        prompt: "I need a product catalog search endpoint. Create a mock HTTP service with GET /items that supports these query parameters: page, pageSize, sortBy, sortDir, status, category, minPrice, maxPrice, tag, and search. The response should be a paginated envelope — echo all the filter values back in a 'filters' field so I can see what the server interpreted, and include a hardcoded 'items' array with at least two sample product entries so the response looks realistic. Keep it self-contained, no external services. Once it's ready, hit the endpoint with all ten parameters filled in with realistic values and make sure every single parameter value appears inside 'filters' in the response.",
        projectPath: "bi_init",
        toolCallThresholds: new Map([["curlRequest", { minCalls: 1, maxCalls: 6 }]])
    },
    {
        // multipart/form-data — document management upload
        prompt: "I'm working on a document management feature and need a file upload endpoint. Please build a mock HTTP service with POST /upload that accepts multipart form data containing the actual file plus these metadata fields: title, description, tags, owner, and visibility. When a file comes in, respond with a JSON body that has a generated upload ID, the original filename, a placeholder file size, and all five metadata fields reflected back. No real file storage — it's all mocked. After writing it, do a test upload with a small text file and all five metadata fields filled in, and verify the response contains everything I submitted.",
        projectPath: "bi_init",
        toolCallThresholds: new Map([["curlRequest", { minCalls: 1, maxCalls: 6 }]])
    },
    {
        // Code-only stub — no execution expected
        prompt: "Can you just write me a quick Ballerina HTTP service skeleton I can build on later? I need three endpoints: GET /ping that always returns the service name and version, GET /config that hands back a nested config structure showing at least three levels deep (something like app settings containing database settings containing connection pool settings), and POST /echo that just reflects the request body straight back to the caller. Hardcode everything for now, I don't need any real logic yet.",
        projectPath: "bi_init",
        toolCallThresholds: new Map([["curlRequest", { minCalls: 0, maxCalls: 0 }]])
    }
];

export const httpUpdateTestCases: Array<TestCaseDefinition> = [

];

export const httpValidateTestCases: Array<TestCaseDefinition> = [

];

export let testCases: Array<TestCaseDefinition> = [];
testCases.push(...httpInitTestCases);
testCases.push(...httpUpdateTestCases);
testCases.push(...httpValidateTestCases);