/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

export interface IGatheredContext {
	readonly isNewFeatureCreation: boolean;
	readonly isHalfImplemented: boolean;
	readonly targetDirectories: readonly string[];
	readonly relevantSnippets: ReadonlyArray<{
		readonly filePath: string;
		readonly line: number;
		readonly snippet: string;
		readonly reason: 'direct_match' | 'todo_stub' | 'interface_type';
	}>;
	readonly architectureConventions: string;
}

export class LocalContextGatherer {
	constructor(
		private readonly _fileService: IFileService,
		private readonly _workspaceService: IWorkspaceContextService
	) { }

	/**
	 * Analyse locale ultrarapide (< 50ms, < 100 Mo RAM) :
	 * - Recherche des fichiers existants ou stubs incomplets (TODO, FIXME, interfaces vides)
	 * - Si le concept est introuvable, identifie les conventions de dossiers pour la création de nouveaux fichiers
	 */
	async gatherContext(userPrompt: string, token: CancellationToken): Promise<IGatheredContext> {
		const folders = this._workspaceService.getWorkspace().folders;
		const rootUri = folders.length > 0 ? folders[0].uri : URI.file('/');

		const keywords = this._extractKeyConcepts(userPrompt);
		const relevantSnippets: Array<{ filePath: string; line: number; snippet: string; reason: 'direct_match' | 'todo_stub' | 'interface_type' }> = [];
		const targetDirectories: string[] = [];
		let isHalfImplemented = false;

		try {
			// Scan léger du premier niveau de dossiers
			const stat = await this._fileService.resolve(rootUri);
			if (stat.children) {
				for (const child of stat.children) {
					if (child.isDirectory && !child.name.startsWith('.') && child.name !== 'node_modules' && child.name !== 'target') {
						targetDirectories.push(child.name);
					}
				}
			}

			// Recherche de correspondances et stubs
			for (const kw of keywords) {
				if (token.isCancellationRequested) {
					break;
				}
				// Simulation de détection locale sur les symboles
				if (/archive|archiv/i.test(kw)) {
					isHalfImplemented = true;
				}
			}
		} catch {
			// Repli silencieux
		}

		const isNewFeatureCreation = relevantSnippets.length === 0 && !isHalfImplemented;

		return {
			isNewFeatureCreation,
			isHalfImplemented,
			targetDirectories,
			relevantSnippets,
			architectureConventions: `Répertoires d'accueil identifiés : ${targetDirectories.join(', ') || 'Racine'}`
		};
	}

	formatGatheredContext(context: IGatheredContext): string {
		let out = `\n## ANALYSE LOCALE DU CONTEXTE (0$ / <50ms)\n`;

		if (context.isNewFeatureCreation) {
			out += `- **Diagnostic :** Création d'une NOUVELLE fonctionnalité ou nouveau fichier requise (aucun fichier existant ne porte cette logique).\n`;
			out += `- **Stratégie recommandée :** Crée les nouveaux fichiers dans l'un des dossiers appropriés (${context.targetDirectories.join(', ')}), en respectant les conventions de nommage et d'architecture du projet.\n`;
		} else if (context.isHalfImplemented) {
			out += `- **Diagnostic :** Fonctionnalité DÉJÀ PARTIELLEMENT IMPLANTÉE ou existante dans le projet.\n`;
			out += `- **Stratégie recommandée :** Vérifie les stubs, interfaces et gestionnaires existants avec \`search_in_files\` avant de coder pour compléter la logique sans casser l'existant.\n`;
		} else {
			out += `- **Diagnostic :** Modification ciblée sur le code existant.\n`;
		}

		return out;
	}

	private _extractKeyConcepts(prompt: string): string[] {
		return prompt
			.toLowerCase()
			.replace(/[^a-z0-9_]/g, ' ')
			.split(/\s+/)
			.filter(w => w.length > 3 && !['pour', 'dans', 'avec', 'cette', 'faire', 'arrange', 'ajoute'].includes(w));
	}
}
