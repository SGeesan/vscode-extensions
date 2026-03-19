// Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com/) All Rights Reserved.

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

import { TestCaseResult, TestUseCase, UsecaseResult, DiagnosticMessage, Summary, ToolEvent, ToolCallEvent, ToolResultEvent, EvalsToolResultEvent, IterationSummary, TestCaseAccuracy, AggregatedUsageMetrics, ToolEvalResult, AggregatedToolEvalResult } from '../types';
import { extractSourceFilesFromContent } from '../utils/content-parser';
import { FILES } from '../utils/constants';

/**
 * Converts TestCaseResult to UsecaseResult format
 */
export function convertTestResultToUsecaseResult(testResult: TestCaseResult, iteration?: number, useCase?: TestUseCase): UsecaseResult {
    // Use generatedSources if available (actual .bal files from filesystem),
    // otherwise fall back to parsing fullContent (backward compatibility)
    const files = testResult.generatedSources
        ? testResult.generatedSources.map(sf => ({
            fileName: sf.filePath,  // Convert filePath to fileName for result types
            content: sf.content
          }))
        : extractSourceFilesFromContent(testResult.result.fullContent);

    const diagnostics: DiagnosticMessage[] = testResult.result.diagnostics.map(diag => ({
        message: typeof diag === 'string' ? diag : (diag as { message?: string }).message || diag.toString(),
        severity: (diag as { severity?: string }).severity || 'error',
        code: (diag as { code?: string }).code,
        source: (diag as { source?: string }).source
    }));

    const errorEvents = testResult.result.events
        .filter(event => event.type === 'error')
        .map(event => event.content);

    // Extract tool events - following the same pattern as production event handler
    const toolEvents: ToolEvent[] = testResult.result.events
        .filter(event => event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'evals_tool_result')
        .map(event => {
            if (event.type === 'tool_call') {
                return {
                    type: 'tool_call',
                    toolName: event.toolName
                } as ToolCallEvent;
            } else if (event.type === 'tool_result') {
                return {
                    type: "tool_result",
                    toolName: event.toolName,
                    toolOutput: event.toolOutput,
                } as ToolResultEvent;
            } else {
                // evals_tool_result
                return {
                    type: 'evals_tool_result',
                    toolName: event.toolName,
                    output: event.output
                } as EvalsToolResultEvent;
            }
        });
    let toolEvalResults: ToolEvalResult[] | undefined = undefined;
    if (useCase && useCase.toolCallThresholds){
        toolEvalResults = [];
        // Evaluate specified tools
        useCase.toolCallThresholds.forEach((threshold, toolName) => {
            const calls = testResult.result.events.filter(e => e.type === 'tool_call' && e.toolName === toolName).length;
            const efficiencyScore = calculateTrapezoidalEfficiency(calls, threshold.minCalls, threshold.maxCalls);
            const isUnderused = calls < threshold.minCalls;
            const isOverused = calls > threshold.maxCalls;
            const isExpectedToBeUsed = threshold.minCalls > 0;
            const results = testResult.result.events.filter(e => (e.type === 'tool_result' || e.type === 'evals_tool_result') && e.toolName === toolName);
            if (results.length !== calls) {
                diagnostics.push({
                    message: `Tool call count (${calls}) for tool "${toolName}" does not match result count (${results.length})`,
                    severity: 'error',
                    code: 'TOOL_CALL_RESULT_MISMATCH',
                    source: 'Tool Use Evaluation'
                });
            } 
            const successCount = results.filter((res) => isToolResultSuccess(res as { toolName: string; toolOutput?: any; output?: any })).length;
            toolEvalResults.push({
                toolName,
                efficiencyScore,
                isUnderused,
                isOverused,
                isExpectedToBeUsed,
                successCount,
                totalCalls: calls
            });
        });

    }

    return {
        usecase: testResult.useCase.usecase,
        diagnostics: diagnostics,
        files: files,
        compiled: testResult.passed && diagnostics.length === 0,
        duration: testResult.result.duration,
        timestamp: testResult.result.startTime,
        errorEvents: errorEvents.length > 0 ? errorEvents : undefined,
        toolEvents: toolEvents.length > 0 ? toolEvents : undefined,
        iteration,
        usage: testResult.result.usageMetrics?.usage,
        toolEvalResults
    };
}

/**
 * Creates a failed UseCase result from error information
 */
export function createFailedUsecaseResult(useCase: TestUseCase, reason: unknown): UsecaseResult {
    const errorMessage = (reason as { message?: string })?.message || 'Unknown error';

    return {
        usecase: useCase.usecase,
        diagnostics: [{ message: errorMessage }],
        files: [{ fileName: FILES.ERROR_TXT, content: errorMessage }],
        compiled: false,
        duration: undefined,
        timestamp: Date.now()
    };
}

/**
 * Generates comprehensive summary from use case results
 */
export function generateComprehensiveSummary(results: readonly UsecaseResult[], totalIterations?: number): Summary {
    const totalUsecases = results.length;
    const totalCompiled = results.filter(r => r.compiled).length;
    const totalFailed = totalUsecases - totalCompiled;
    const accuracy = totalUsecases > 0 ? (totalCompiled * 100) / totalUsecases : 0;

    const durations = results.filter(r => r.duration).map(r => r.duration!);
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const averageDuration = durations.length > 0 ? totalDuration / durations.length : 0;

    let iterationResults: IterationSummary[] | undefined;
    let perTestCaseAccuracy: TestCaseAccuracy[] | undefined;

    // Calculate iteration-specific summaries if iterations are present
    if (totalIterations && totalIterations > 1) {
        iterationResults = calculateIterationSummaries(results, totalIterations);
        perTestCaseAccuracy = calculatePerTestCaseAccuracy(results, totalIterations);
    }


    const aggregatedUsage = calculateAggregatedUsage(results);
    const aggregatedToolEvalResults = calculateAggregatedToolEvalResults(results);
    const overallCacheValidation = calculateOverallCacheValidation(results, aggregatedUsage);

    return {
        results: results,
        totalUsecases,
        totalCompiled,
        totalFailed,
        accuracy: Math.round(accuracy * 100) / 100,
        totalDuration,
        averageDuration: Math.round(averageDuration),
        timestamp: Date.now(),
        aggregatedToolEvalResults,
        iterations: totalIterations,
        iterationResults,
        perTestCaseAccuracy,
        aggregatedUsage,
        overallCacheValidation
    };
}

/**
 * Generates summary for a single iteration
 */
export function generateIterationSummary(iterationResults: readonly UsecaseResult[], iterationNumber: number): IterationSummary {
    const totalUsecases = iterationResults.length;
    const totalCompiled = iterationResults.filter(r => r.compiled).length;
    const totalFailed = totalUsecases - totalCompiled;
    const accuracy = totalUsecases > 0 ? (totalCompiled * 100) / totalUsecases : 0;

    const durations = iterationResults.filter(r => r.duration).map(r => r.duration!);
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const averageDuration = durations.length > 0 ? totalDuration / durations.length : 0;

    return {
        iteration: iterationNumber,
        totalUsecases,
        totalCompiled,
        totalFailed,
        accuracy: Math.round(accuracy * 100) / 100,
        totalDuration,
        averageDuration: Math.round(averageDuration),
        timestamp: Date.now(),
        results: iterationResults
    };
}

/**
 * Calculates summary for each iteration
 */
function calculateIterationSummaries(results: readonly UsecaseResult[], totalIterations: number): IterationSummary[] {
    const summaries: IterationSummary[] = [];

    for (let i = 1; i <= totalIterations; i++) {
        const iterationResults = results.filter(r => r.iteration === i);
        const totalUsecases = iterationResults.length;
        const totalCompiled = iterationResults.filter(r => r.compiled).length;
        const totalFailed = totalUsecases - totalCompiled;
        const accuracy = totalUsecases > 0 ? (totalCompiled * 100) / totalUsecases : 0;

        const durations = iterationResults.filter(r => r.duration).map(r => r.duration!);
        const totalDuration = durations.reduce((sum, d) => sum + d, 0);
        const averageDuration = durations.length > 0 ? totalDuration / durations.length : 0;

        summaries.push({
            iteration: i,
            totalUsecases,
            totalCompiled,
            totalFailed,
            accuracy: Math.round(accuracy * 100) / 100,
            totalDuration,
            averageDuration: Math.round(averageDuration),
            timestamp: Date.now(),
            results: iterationResults
        });
    }

    return summaries;
}

/**
 * Calculates per-test-case accuracy across all iterations
 */
function calculatePerTestCaseAccuracy(results: readonly UsecaseResult[], totalIterations: number): TestCaseAccuracy[] {
    // Group results by test case index (assuming results are ordered)
    const testCaseCount = results.length / totalIterations;
    const accuracyMap: Map<number, TestCaseAccuracy> = new Map();

    for (let testIndex = 0; testIndex < testCaseCount; testIndex++) {
        const testResults = results.filter((_, idx) => idx % testCaseCount === testIndex);
        const successCount = testResults.filter(r => r.compiled).length;
        const accuracy = (successCount * 100) / totalIterations;

        accuracyMap.set(testIndex, {
            testCaseIndex: testIndex,
            usecase: testResults[0]?.usecase || '',
            successCount,
            totalAttempts: totalIterations,
            accuracy: Math.round(accuracy * 100) / 100
        });
    }

    return Array.from(accuracyMap.values());
}


/**
 * Calculates aggregated usage metrics from all results
 */
function calculateAggregatedUsage(results: readonly UsecaseResult[]): AggregatedUsageMetrics | undefined {
    const resultsWithUsage = results.filter(r => r.usage);

    if (resultsWithUsage.length === 0) {
        return undefined;
    }

    const totalUseCases = resultsWithUsage.length;

    // Track initial generation cache stats
    let initialHits = 0;
    let initialCreations = 0;

    // Track repair stats by iteration
    const repairStats: { [iteration: number]: { count: number; hits: number; creation: number } } = {};
    const repairCounts: { [iteration: number]: Set<string> } = {}; // Track which use cases reached each repair

    for (const result of resultsWithUsage) {
        if (result.usage) {
            // Count initial generation cache usage
            if (result.usage.initial.cacheReadInputTokens > 0) {
                initialHits++;
            }
            if (result.usage.initial.cacheCreationInputTokens > 0) {
                initialCreations++;
            }

            // Count repair cache usage by iteration
            result.usage.repairs.forEach((repair) => {
                const iteration = repair.iteration;
                const useCaseKey = result.usecase; // Use usecase as unique identifier

                if (!repairStats[iteration]) {
                    repairStats[iteration] = { count: 0, hits: 0, creation: 0 };
                }
                if (!repairCounts[iteration]) {
                    repairCounts[iteration] = new Set();
                }

                // Track which use cases reached this repair iteration
                repairCounts[iteration].add(useCaseKey);

                if (repair.cacheReadInputTokens > 0) {
                    repairStats[iteration].hits++;
                }
                if (repair.cacheCreationInputTokens > 0) {
                    repairStats[iteration].creation++;
                }
            });
        }
    }

    // Update count based on unique use cases that reached each repair iteration
    Object.keys(repairStats).forEach(iteration => {
        const iterationNum = parseInt(iteration);
        repairStats[iterationNum].count = repairCounts[iterationNum]?.size || 0;
    });

    // Build the repairs object with dynamic repair keys
    const repairs: { [repairIteration: string]: { count: number; hits: number; creation: number } } = {};
    Object.keys(repairStats).forEach(iteration => {
        const repairKey = `repair${iteration}`;
        repairs[repairKey] = repairStats[parseInt(iteration)];
    });

    return {
        totalUseCases,
        initialGeneration: {
            hits: initialHits,
            creation: initialCreations
        },
        repairs
    };
}

/**
 * Calculate comprehensive cache validation across all use cases
 */
function calculateOverallCacheValidation(results: readonly UsecaseResult[], aggregatedUsage?: AggregatedUsageMetrics) {
    if (!aggregatedUsage) {
        return undefined;
    }

    // 1. Initial generation validation: No more than 1 use case should create fresh cache
    const InitialGenCacheCreation = aggregatedUsage.initialGeneration.creation;
    const initialGenerationValidation: "pass" | "fail" = InitialGenCacheCreation > 1 ? "fail" : "pass";

    // 2. First repair validation: All use cases should have cache reads (can have writes)
    const firstRepairStats = aggregatedUsage.repairs.repair1;
    let firstRepairValidation: "pass" | "fail" | "not_applicable" = "not_applicable";
    if (firstRepairStats) {
        firstRepairValidation = firstRepairStats.hits === firstRepairStats.count ? "pass" : "fail";
    }
    // 3. Subsequent repairs validation: Should not have any cache writes
    let subsequentRepairsValidation: "pass" | "fail" | "not_applicable" = "not_applicable";
    const subsequentRepairKeys = Object.keys(aggregatedUsage.repairs)
        .filter(key => key !== 'repair1')
        .sort((a, b) => {
            const aNum = parseInt(a.replace('repair', ''));
            const bNum = parseInt(b.replace('repair', ''));
            return aNum - bNum;
        });

    if (subsequentRepairKeys.length > 0) {
        const hasSubsequentWrites = subsequentRepairKeys.some(key =>
            aggregatedUsage.repairs[key].creation > 0
        );
        subsequentRepairsValidation = hasSubsequentWrites ? "fail" : "pass";
    }

    // Build repair iteration counts
    const repairIterationCounts: { [repairIteration: string]: number } = {};
    Object.entries(aggregatedUsage.repairs).forEach(([repairKey, repairData]) => {
        repairIterationCounts[repairKey] = repairData.count;
    });

    // Collect validation issues
    const validationIssues: string[] = [];
    if (initialGenerationValidation === "fail") {
        validationIssues.push(`Multiple use cases (${InitialGenCacheCreation}) creating fresh cache in initial generation - indicates poor cache pre-warming`);
    }
    if (firstRepairValidation === "fail") {
        validationIssues.push(`First repair iteration has cache reads less than use cases that reached it (${firstRepairStats?.hits}/${firstRepairStats?.count}) - all should have reads`);
    }
    if (subsequentRepairsValidation === "fail") {
        const writeCounts = subsequentRepairKeys.map(key =>
            `${key}: ${aggregatedUsage.repairs[key].creation}`
        ).filter(count => !count.endsWith(': 0'));
        validationIssues.push(`Subsequent repairs have cache writes - ${writeCounts.join(', ')}`);
    }

    // Overall status
    const overallStatus: "pass" | "fail" = (initialGenerationValidation === "fail" ||
                                           firstRepairValidation === "fail" ||
                                           subsequentRepairsValidation === "fail") ? "fail" : "pass";

    return {
        initialCacheEfficiency: initialGenerationValidation,
        firstRepairAllReads: firstRepairValidation,
        subsequentRepairsNoWrites: subsequentRepairsValidation,
        overallStatus,
        InitialGenCacheCreation,
        repairIterationCounts,
        validationIssues
    };
}

function calculateAggregatedToolEvalResults(results: readonly UsecaseResult[]): AggregatedToolEvalResult[] | undefined {
    const toolMap: Map<string, ToolEvalResult[]> = new Map();

    results.forEach((result) => {
        result.toolEvalResults?.forEach((toolEvalResult) => {
            if (!toolMap.has(toolEvalResult.toolName)) {
                toolMap.set(toolEvalResult.toolName, []);
            }
            toolMap.get(toolEvalResult.toolName)!.push(toolEvalResult);
        });
    });

    if (toolMap.size === 0) {
        return undefined;
    }

    return Array.from(toolMap.entries()).map(([toolName, evalResults]) => {
        const totalCases = evalResults.length;
        const efficiencyScoreSum = evalResults.reduce((sum, current) => sum + current.efficiencyScore, 0);
        const averageEfficiencyScore = totalCases > 0 ? efficiencyScoreSum / totalCases : 0;

        const expectedUsageCases = evalResults.filter((current) => current.isExpectedToBeUsed).length;
        const notUnderusedCases = evalResults.filter((current) => current.isExpectedToBeUsed && !current.isUnderused).length;
        const notOverusedCases = evalResults.filter((current) => !current.isOverused).length;

        const toolUsageRecall = expectedUsageCases > 0 ? notUnderusedCases / expectedUsageCases : 0;
        const notOverusedCaseRate = totalCases > 0 ? notOverusedCases / totalCases : 0;

        const successRateSum = evalResults.reduce((sum, current) => {
            const rate = current.totalCalls > 0 ? current.successCount / current.totalCalls : 0;
            return sum + rate;
        }, 0);
        const averageSuccessRate = totalCases > 0 ? successRateSum / totalCases : 0;

        return {
            toolName,
            averageEfficiencyScore,
            averageSuccessRate,
            toolUsageRecall,
            notOverusedCaseRate,
            totalCases,
            expectedUsageCases,
            notUnderusedCases,
            notOverusedCases
        };
    });
}


function isToolResultSuccess(res: { toolName: string; toolOutput?: any; output?: any }): boolean {
    const toolOutput = res.toolOutput ?? res.output;
    // Decide success for each tool based on its output structure
    switch (res.toolName) {
        case 'curlRequest':{
            if (typeof toolOutput === 'object' && toolOutput !== null) {
                const curlOutput = toolOutput.output;
                if (typeof curlOutput === 'object' && curlOutput !== null) {
                    if (curlOutput.error === true) {
                        return false;
                    }

                    if (typeof curlOutput.status === 'number') {
                        return curlOutput.status >= 200 && curlOutput.status < 400;
                    }
                }
            }
            return false;
        }
        case 'hurlRunnerTool': {
            if (typeof toolOutput === 'object' && toolOutput !== null) {
                const runOutput = toolOutput.runResult?.output;
                if (runOutput && typeof runOutput === 'object') {
                    const warnings = Array.isArray(runOutput.warnings) ? runOutput.warnings : [];
                    const hasFailureWarning = warnings.some((w: string) =>
                        w.includes('Failed to execute Hurl script.') ||
                        w.includes('the HTTP method <> is not valid')
                    );
                    if (hasFailureWarning) {
                        return false;
                    }

                    const entries = Array.isArray(runOutput.entries) ? runOutput.entries : [];
                    const hasEntryFailure = entries.some((entry: { status?: string; errorMessage?: string }) =>
                        entry.status === 'error' ||
                        (typeof entry.errorMessage === 'string' && (
                            entry.errorMessage.includes('the HTTP method <> is not valid') ||
                            entry.errorMessage.includes('Failed to execute Hurl script.') ||
                            entry.errorMessage.includes('can not be read')
                        ))
                    );
                    if (hasEntryFailure) {
                        return false;
                    }

                    return true;
                }
            }
            return false;
        }
        default:
            // If no specific criteria, assume success if toolOutput is not empty
            return !!toolOutput;
    }
}

function calculateTrapezoidalEfficiency(calls: number, minCalls: number, maxCalls: number) {
    // Ideally we want calls to be greater than or equal to minCalls and less than or equal to maxCalls
    if (calls < minCalls) {
        return calls / minCalls; // Linear increase from 0 to 1 as calls approach minCalls
    } else if (calls > maxCalls) {
        return Math.max(0, 1 - (calls - maxCalls) / maxCalls); // Linear decrease from 1 to 0 as calls exceed maxCalls
    } else {
        return 1; // Full efficiency within the ideal range
    }
}

