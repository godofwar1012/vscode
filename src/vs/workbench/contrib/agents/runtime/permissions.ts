/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type PermissionLevel = 'always_ask' | 'allow_safe' | 'allow_all';

export interface IPermissionCheckResult {
	readonly allowed: boolean;
	readonly requiresPrompt: boolean;
	readonly reason?: string;
}

export class PermissionManager {
	private _level: PermissionLevel = 'allow_safe';

	setPermissionLevel(level: PermissionLevel): void {
		this._level = level;
	}

	getPermissionLevel(): PermissionLevel {
		return this._level;
	}

	evaluateToolCall(toolName: string, args: Record<string, unknown>): IPermissionCheckResult {
		if (this._level === 'allow_all') {
			return { allowed: true, requiresPrompt: false };
		}

		if (this._level === 'always_ask') {
			return { allowed: true, requiresPrompt: true, reason: 'Niveau de permission configuré sur "Demander toujours".' };
		}

		// Mode 'allow_safe'
		const safeTools = new Set(['read_file', 'list_dir', 'search_files', 'get_file_outline']);
		if (safeTools.has(toolName)) {
			return { allowed: true, requiresPrompt: false };
		}

		if (toolName === 'run_command') {
			const command = String(args.command || '');
			const dangerousPatterns = [
				/rm\s+-rf/i,
				/del\s+\/f/i,
				/format\s+/i,
				/git\s+push/i,
				/git\s+reset\s+--hard/i,
				/npm\s+publish/i,
				/curl.*\|\s*sh/i,
				/wget.*\|\s*sh/i
			];

			for (const pattern of dangerousPatterns) {
				if (pattern.test(command)) {
					return {
						allowed: true,
						requiresPrompt: true,
						reason: `Commande à risque élevé détectée: "${command}"`
					};
				}
			}
		}

		if (toolName === 'delete_file') {
			return {
				allowed: true,
				requiresPrompt: true,
				reason: `Suppression définitive du fichier demandée: ${String(args.path)}`
			};
		}

		// Modifications de code standards autorisées avec traçabilité et diff
		return { allowed: true, requiresPrompt: false };
	}
}
