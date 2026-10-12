/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IAgentBudget {
	readonly maxTokens?: number;
	readonly maxCostUSD?: number;
	readonly maxExecutionTimeMs?: number;
	readonly maxSteps?: number;
}

export class BudgetGuard {
	constructor(private readonly _budget: IAgentBudget) { }

	checkBudget(currentUsage: { tokens: number; costUSD: number; steps: number; elapsedMs: number }): {
		exceeded: boolean;
		reason?: string;
	} {
		if (this._budget.maxTokens && currentUsage.tokens >= this._budget.maxTokens) {
			return {
				exceeded: true,
				reason: `Plafond de tokens atteint (${currentUsage.tokens} / ${this._budget.maxTokens})`
			};
		}

		if (this._budget.maxCostUSD && currentUsage.costUSD >= this._budget.maxCostUSD) {
			return {
				exceeded: true,
				reason: `Budget maximal en dollars atteint ($${currentUsage.costUSD.toFixed(4)} / $${this._budget.maxCostUSD.toFixed(2)})`
			};
		}

		if (this._budget.maxSteps && currentUsage.steps >= this._budget.maxSteps) {
			return {
				exceeded: true,
				reason: `Nombre maximal d'étapes atteint (${currentUsage.steps} / ${this._budget.maxSteps})`
			};
		}

		if (this._budget.maxExecutionTimeMs && currentUsage.elapsedMs >= this._budget.maxExecutionTimeMs) {
			return {
				exceeded: true,
				reason: `Temps d'exécution maximal dépassé (${Math.round(currentUsage.elapsedMs / 1000)}s)`
			};
		}

		return { exceeded: false };
	}
}

export class SecretSanitizer {
	private static readonly SECRET_PATTERNS = [
		/ghp_[a-zA-Z0-9]{36}/g,                     // GitHub Personal Access Token
		/sk-[a-zA-Z0-9]{32,64}/g,                    // OpenAI / DeepSeek API Keys
		/AKIA[0-9A-Z]{16}/g,                         // AWS Access Key ID
		/(bearer\s+)[a-zA-Z0-9_\-\.]{30,}/gi        // Generic Bearer tokens
	];

	private static readonly EXCLUDED_FILES = [
		/^\.env(\..+)?$/i,
		/\.pem$/i,
		/\.key$/i,
		/^id_rsa(\.pub)?$/i,
		/^credentials$/i
	];

	static isFileRestricted(fileName: string): boolean {
		const base = fileName.split(/[/\\]/).pop() || fileName;
		return this.EXCLUDED_FILES.some(pattern => pattern.test(base));
	}

	static sanitizeText(input: string): string {
		let result = input;
		for (const pattern of this.SECRET_PATTERNS) {
			result = result.replace(pattern, '[SECRET_MASQUÉ]');
		}
		return result;
	}
}
