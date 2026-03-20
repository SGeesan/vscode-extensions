import { DiagnosticEntry, Diagnostics } from '@wso2/ballerina-core';
import { checkProjectDiagnostics, isModuleNotFoundDiagsExist as resolveModuleNotFoundDiagnostics } from '../../../../rpc-managers/ai-panel/repair-utils';
import { StateMachine } from '../../../../stateMachine';
import * as path from 'path';
import * as fs from 'fs';
import { Uri } from 'vscode';

export const DIAGNOSTICS_TOOL_NAME = "getCompilationErrors";

/**
 * Diagnostic entry enriched with resolving hints
 */
export interface EnrichedDiagnostic extends DiagnosticEntry {
    hint?: string;
}

/**
 * Result of diagnostic checking
 */
export interface DiagnosticsCheckResult {
    diagnostics: EnrichedDiagnostic[];
    message: string;
}

function toErrorDetails(error: unknown): string {
    if (error instanceof Error) {
        const rpcMeta = error as Error & { code?: unknown; data?: unknown };
        const codePart = rpcMeta.code !== undefined ? ` [code=${String(rpcMeta.code)}]` : '';
        const dataPart = rpcMeta.data !== undefined
            ? ` [data=${String(rpcMeta.data).replace(/\s+/g, ' ').slice(0, 300)}]`
            : '';
        return `${error.message}${codePart}${dataPart}`;
    }

    if (error && typeof error === 'object') {
        const rpcMeta = error as { message?: unknown; code?: unknown; data?: unknown };
        const message = rpcMeta.message ? String(rpcMeta.message) : String(error);
        const codePart = rpcMeta.code !== undefined ? ` [code=${String(rpcMeta.code)}]` : '';
        const dataPart = rpcMeta.data !== undefined
            ? ` [data=${String(rpcMeta.data).replace(/\s+/g, ' ').slice(0, 300)}]`
            : '';
        return `${message}${codePart}${dataPart}`;
    }

    return String(error);
}

/**
 * Map of Ballerina diagnostic codes to resolving hints
 *
 * Each entry maps a diagnostic code (e.g., "BCE2000") to a helpful hint on how to resolve it.
 * These hints are shown alongside the diagnostic message to help developers fix issues quickly.
 *
 * TODO: Populate this map with actual Ballerina diagnostic codes and their corresponding hints.
 * Example structure:
 * {
 *   "BCE2000": "Add missing import statement for the module",
 *   "BCE2001": "Check variable type compatibility",
 *   "BCE2002": "Ensure function return type matches declaration",
 * }
 */
const DIAGNOSTIC_HINTS: Record<string, string> = {
    // Diagnostic code mappings to be populated
    "BCE2000": "This usually indicates a missing import statement. Please ensure that all necessary modules are imported in each file where they are used.",
};

/**
 * Converts language server Diagnostics to EnrichedDiagnostic entries with hints
 * Filters for error-level diagnostics (severity === 1) only
 */
function transformDiagnosticsToEnriched(diagnostics: Diagnostics[]): EnrichedDiagnostic[] {
    const enrichedDiags: EnrichedDiagnostic[] = [];

    for (const diagParam of diagnostics) {
        for (const diag of diagParam.diagnostics) {
            // Only include error-level diagnostics
            if (diag.severity === 1) {
                const fileName = path.basename(diagParam.uri);
                const msgPrefix = `[${fileName}:${diag.range.start.line},${diag.range.start.character}:${diag.range.end.line},${diag.range.end.character}] `;

                const diagnosticEntry: EnrichedDiagnostic = {
                    code: diag.code.toString(),
                    message: msgPrefix + diag.message
                };

                // Add hint if available for this diagnostic code
                const hint = DIAGNOSTIC_HINTS[diag.code.toString()];
                if (hint) {
                    diagnosticEntry.hint = hint;
                }

                enrichedDiags.push(diagnosticEntry);
            }
        }
    }

    return enrichedDiags;
}

/**
 * Checks the Ballerina package for compilation errors using the language server
 *
 * This function:
 * 1. Gets the current project from the state machine
 * 2. Calls the language server to get package-level diagnostics
 * 3. Enriches diagnostics with resolving hints based on diagnostic codes
 *
 * Note: In Ballerina, diagnostics are generated at the package level, so this checks
 * the entire package/project in the current workspace.
 *
 * @param updatedSourceFiles - Array of source files in the current session (not used, kept for compatibility)
 * @param updatedFileNames - Array of file names in the current session (not used, kept for compatibility)
 * @returns DiagnosticsCheckResult with enriched diagnostics
 */
export async function checkCompilationErrors(
    tempProjectPath: string
): Promise<DiagnosticsCheckResult> {
    try {
        if (!tempProjectPath) {
            throw new Error('Diagnostics check failed: tempProjectPath is empty.');
        }

        if (!fs.existsSync(tempProjectPath)) {
            throw new Error(`Diagnostics check failed: path does not exist: ${tempProjectPath}`);
        }

        // Get language client from state machine
        const langClient = StateMachine.langClient();
        if (!langClient) {
            throw new Error('Diagnostics check failed: language client is not initialized.');
        }

        // Get diagnostics from language server for the current project
        console.log(`[DiagnosticsUtils] Calling language server for diagnostics on ${tempProjectPath}`);
        let diagnostics: Diagnostics[] = [];
        let diagnosticsUseAISchema = true;

        const getDiagnostics = async (useAISchema: boolean): Promise<Diagnostics[]> => {
            return checkProjectDiagnostics(langClient, tempProjectPath, useAISchema);
        };

        try {
            diagnostics = await getDiagnostics(true);
            // HACK: When the generated code includes `import ballerinax/client.config;` (without the quoted
            // identifier), the language server returns diagnostics with the module name stripped to
            // `ballerinax/.config` — omitting "client". As a workaround, we detect this and
            // instruct the agent to use the correct quoted form `import ballerinax/'client.config;`
            // instead of attempting to resolve the dependency automatically.
            const enrichedDiagnosticsTry = transformDiagnosticsToEnriched(diagnostics);
            const hasInvalidClientModuleImport = enrichedDiagnosticsTry.some(
                d => d.code === "BCE2003" && d.message.includes("ballerinax/.config")
            );
            if (hasInvalidClientModuleImport) {
                console.log(`[DiagnosticsUtils] Detected invalid client module import 'ballerinax/client.config'.`);
                return {
                    diagnostics: enrichedDiagnosticsTry,
                    message: `Found a module resolution error: the import 'import ballerinax/client.config;' is invalid. ` +
                        `Fix this by replacing the import statement with 'import ballerinax/'client.config;'. ` +
                        `After applying the fix, call the ${DIAGNOSTICS_TOOL_NAME} tool again to verify there are no remaining errors.`
                };
            }
        } catch (diagError) {
            console.warn('[DiagnosticsUtils] Initial diagnostics call failed, attempting dependency resolve fallback.', {
                tempProjectPath,
                reason: toErrorDetails(diagError)
            });

            // First fallback: try file-scheme diagnostics directly.
            try {
                diagnostics = await getDiagnostics(false);
                diagnosticsUseAISchema = false;
                console.warn('[DiagnosticsUtils] Falling back to file-scheme diagnostics succeeded.', {
                    tempProjectPath,
                });
            } catch (fileDiagError) {
                // Second fallback: resolve dependencies using ai scheme and retry.
                const aiUri = Uri.file(tempProjectPath).with({ scheme: 'ai' }).toString();
                let aiResolveReason: string | undefined;
                let fileResolveReason: string | undefined;

                try {
                    await langClient.resolveModuleDependencies({
                        documentIdentifier: {
                            uri: aiUri
                        }
                    });
                    diagnostics = await getDiagnostics(true);
                    diagnosticsUseAISchema = true;
                } catch (resolveError) {
                    aiResolveReason = toErrorDetails(resolveError);

                    // Third fallback: resolve dependencies using file scheme and retry file-scheme diagnostics.
                    const fileUri = Uri.file(tempProjectPath).toString();
                    try {
                        await langClient.resolveModuleDependencies({
                            documentIdentifier: {
                                uri: fileUri
                            }
                        });
                        diagnostics = await getDiagnostics(false);
                        diagnosticsUseAISchema = false;
                    } catch (fileResolveError) {
                        fileResolveReason = toErrorDetails(fileResolveError);
                        throw new Error(
                            `Diagnostics fallback failed. initialAiDiag=${toErrorDetails(diagError)}; fileDiag=${toErrorDetails(fileDiagError)}; aiResolve=${aiResolveReason}; fileResolve=${fileResolveReason}`
                        );
                    }
                }
            }
        }
        // Check if there are module not found diagnostics and attempt to resolve them
        const isDiagsChanged = await resolveModuleNotFoundDiagnostics(diagnostics, langClient);
        if (isDiagsChanged) {
            diagnostics = await checkProjectDiagnostics(langClient, tempProjectPath, diagnosticsUseAISchema);
        }

        // Transform and enrich diagnostics with hints
        const enrichedDiagnostics = transformDiagnosticsToEnriched(diagnostics);

        const errorCount = enrichedDiagnostics.length;
        console.log(`[DiagnosticsUtils] Found ${errorCount} compilation error(s).`);

        if (errorCount === 0) {
            console.log(`[DiagnosticsUtils] No compilation errors found.`);
            return {
                diagnostics: [],
                message: "No compilation errors found. Code compiles successfully.",
            };
        }

        console.log(`[DiagnosticsUtils] Enriched Diagnostics:`, enrichedDiagnostics);
        return {
            diagnostics: enrichedDiagnostics,
            message: `Found ${errorCount} compilation error(s). Review and fix the errors before proceeding.`
        };
    } catch (error) {
        const reason = toErrorDetails(error);
        console.error("[DiagnosticsUtils] Error checking compilation errors:", {
            tempProjectPath,
            reason,
            error,
        });
        return {
            diagnostics: [{
                message: "Internal error occurred while checking compilation errors."
            }],
            message: `<CRITICAL_ERROR> Failed to check compilation errors due to an internal error. Avoid try to resolve this with code changes. Acknowledge the failure, consider the task is done.
Reason: ${reason}
</CRITICAL_ERROR>`,
        };
    }
}
