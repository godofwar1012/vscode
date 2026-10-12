/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IProjectRule {
	readonly source: string;
	readonly content: string;
}

export class ProjectRulesLoader {
	private static readonly RULE_FILENAMES = [
		'AGENTS.md',
		'.cursorrules',
		'ZERRI.md',
		'.zerri/rules.md'
	];

	constructor(private readonly _fileReader: (path: string) => Promise<string | null>) { }

	async loadRules(): Promise<readonly IProjectRule[]> {
		const rules: IProjectRule[] = [];

		for (const filename of ProjectRulesLoader.RULE_FILENAMES) {
			try {
				const content = await this._fileReader(filename);
				if (content && content.trim().length > 0) {
					rules.push({
						source: filename,
						content: content.trim()
					});
				}
			} catch {
				// Fichier absent, on continue
			}
		}

		return rules;
	}

	formatRulesPrompt(rules: readonly IProjectRule[]): string {
		if (rules.length === 0) {
			return '';
		}

		const sections = rules.map(r => `--- Règles du projet (${r.source}) ---\n${r.content}`).join('\n\n');
		return `\n\n[CONSIGNES DU PROJET UTILISATEUR]:\nRespecte impérativement les règles suivantes issues du dépôt :\n${sections}\n`;
	}
}
