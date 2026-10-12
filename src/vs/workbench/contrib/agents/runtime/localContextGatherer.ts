/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { NativeCoreBridge } from './nativeCoreBridge.js';

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

			// Connexion au Noyau Natif Rust (zerri-core)
			const nativeBridge = NativeCoreBridge.getInstance();

			// Si une erreur multi-lignes ou une trace de compilation est présente dans la demande
			if (/error|exception|cannot find|undefined|nullpointer|failed|syntax|type/i.test(userPrompt)) {
				const rootCause = await nativeBridge.findRootCauseFiles(userPrompt);
				for (const suspiciousFile of rootCause.suspiciousFiles) {
					relevantSnippets.push({
						filePath: suspiciousFile,
						line: 1,
						snippet: `[NOYAU NATIF RUST - CAUSE RACINE DÉTECTÉE] Ce fichier externe est directement lié aux symboles ou dépendances en erreur : ${suspiciousFile}`,
						reason: 'interface_type'
					});
				}
			}

			// Recherche native ultra-rapide des symboles et stubs
			for (const kw of keywords) {
				if (token.isCancellationRequested) {
					break;
				}

				const hits = await nativeBridge.searchCodebase(kw, 3);
				for (const hit of hits) {
					const isStub = /todo|fixme|unimplemented|stub/i.test(hit.snippet.content);
					if (isStub) {
						isHalfImplemented = true;
					}
					relevantSnippets.push({
						filePath: hit.snippet.filePath,
						line: hit.snippet.startLine,
						snippet: hit.snippet.content.slice(0, 300),
						reason: isStub ? 'todo_stub' : 'direct_match'
					});
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
