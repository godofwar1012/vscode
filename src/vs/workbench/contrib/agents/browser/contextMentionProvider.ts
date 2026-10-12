/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type ContextMentionType = 'file' | 'symbol' | 'terminal' | 'git_diff' | 'codebase';

export interface IContextMention {
	readonly type: ContextMentionType;
	readonly label: string;
	readonly description?: string;
	readonly data: string; // Contenu textuel injecté dans la conversation
}

export class ContextMentionProvider {
	constructor(
		private readonly _fileProvider: (query: string) => Promise<string[]>,
		private readonly _fileContentReader: (path: string) => Promise<string>,
		private readonly _terminalOutputProvider?: () => Promise<string>,
		private readonly _gitDiffProvider?: () => Promise<string>
	) { }

	async resolveMention(type: ContextMentionType, identifier: string): Promise<IContextMention | null> {
		switch (type) {
			case 'file': {
				try {
					const content = await this._fileContentReader(identifier);
					return {
						type: 'file',
						label: `@file:${identifier}`,
						description: `Contenu du fichier ${identifier}`,
						data: `\n[FICHIER: ${identifier}]\n\`\`\`\n${content}\n\`\`\`\n`
					};
				} catch {
					return null;
				}
			}

			case 'terminal': {
				if (this._terminalOutputProvider) {
					const termOutput = await this._terminalOutputProvider();
					return {
						type: 'terminal',
						label: '@terminal',
						description: 'Dernière sortie du terminal',
						data: `\n[TERMINAL OUTPUT]:\n\`\`\`\n${termOutput}\n\`\`\`\n`
					};
				}
				return null;
			}

			case 'git_diff': {
				if (this._gitDiffProvider) {
					const diff = await this._gitDiffProvider();
					return {
						type: 'git_diff',
						label: '@git',
						description: 'Modifications Git en cours',
						data: `\n[GIT DIFF]:\n\`\`\`diff\n${diff}\n\`\`\`\n`
					};
				}
				return null;
			}

			default:
				return null;
		}
	}

	async getAutocompleteSuggestions(query: string): Promise<Array<{ type: ContextMentionType; label: string; description: string }>> {
		const suggestions: Array<{ type: ContextMentionType; label: string; description: string }> = [
			{ type: 'codebase', label: '@codebase', description: 'Recherche sémantique dans l\'ensemble du projet' },
			{ type: 'terminal', label: '@terminal', description: 'Injecte les dernières logs et erreurs du terminal' },
			{ type: 'git_diff', label: '@git', description: 'Injecte le diff des modifications actuelles' }
		];

		if (query.trim().length > 0) {
			const files = await this._fileProvider(query);
			for (const file of files.slice(0, 5)) {
				suggestions.push({
					type: 'file',
					label: `@file:${file}`,
					description: `Inclure le fichier ${file}`
				});
			}
		}

		return suggestions;
	}
}
