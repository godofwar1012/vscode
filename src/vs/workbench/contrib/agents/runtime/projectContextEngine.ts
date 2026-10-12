/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

export interface IProjectTopology {
	readonly rootPath: string;
	readonly projectType: string;
	readonly frameworks: readonly string[];
	readonly keyFiles: readonly string[];
	readonly directoryOverview: readonly string[];
	readonly rules: string;
}

export class ProjectContextEngine {
	constructor(
		private readonly _fileService: IFileService,
		private readonly _workspaceService: IWorkspaceContextService
	) { }

	/**
	 * Analyse automatiquement le projet en arrière-plan et extrait :
	 * - Le type de projet (Node/TS, Rust, Python, Go, C++, etc.)
	 * - Les fichiers clés d'architecture (package.json, Cargo.toml, etc.)
	 * - L'arborescence des dossiers principaux
	 * - Les règles de projet (.cursorrules, AGENTS.md, etc.)
	 */
	async buildProjectOverview(token: CancellationToken): Promise<IProjectTopology> {
		const folders = this._workspaceService.getWorkspace().folders;
		const rootUri = folders.length > 0 ? folders[0].uri : URI.file('/');
		const rootPath = rootUri.fsPath;

		let projectType = 'Inconnu';
		const frameworks: string[] = [];
		const keyFiles: string[] = [];
		const directoryOverview: string[] = [];
		let rules = '';

		try {
			const stat = await this._fileService.resolve(rootUri);
			if (stat.children) {
				for (const child of stat.children) {
					if (child.isDirectory && !child.name.startsWith('.') && child.name !== 'node_modules' && child.name !== 'target') {
						directoryOverview.push(`📁 ${child.name}/`);
					} else if (!child.isDirectory) {
						keyFiles.push(child.name);
					}
				}
			}

			// Détection des fichiers manifestes
			if (keyFiles.includes('package.json')) {
				projectType = 'Node.js / TypeScript / JavaScript';
				try {
					const pkgContent = await this._fileService.readFile(URI.joinPath(rootUri, 'package.json'), undefined, token);
					const pkgJson = JSON.parse(pkgContent.value.toString());
					const deps = { ...(pkgJson.dependencies || {}), ...(pkgJson.devDependencies || {}) };
					if (deps['react']) { frameworks.push('React'); }
					if (deps['vue']) { frameworks.push('Vue'); }
					if (deps['electron']) { frameworks.push('Electron'); }
					if (deps['express']) { frameworks.push('Express'); }
					if (deps['vite']) { frameworks.push('Vite'); }
					if (deps['typescript']) { frameworks.push('TypeScript'); }
				} catch {
					// Poursuivre
				}
			}

			if (keyFiles.includes('Cargo.toml')) {
				projectType = projectType === 'Inconnu' ? 'Rust' : `${projectType} + Rust (Hybride)`;
				frameworks.push('Cargo/Rust');
			}

			if (keyFiles.includes('go.mod')) {
				projectType = 'Go';
				frameworks.push('Go Module');
			}

			if (keyFiles.includes('CMakeLists.txt') || keyFiles.includes('Makefile')) {
				projectType = projectType === 'Inconnu' ? 'C / C++' : `${projectType} + C/C++`;
			}

			// Détection des règles de projet (.cursorrules, AGENTS.md, etc.)
			const ruleCandidates = ['AGENTS.md', '.cursorrules', 'ZERRI.md', 'CONTRIBUTING.md'];
			for (const r of ruleCandidates) {
				if (keyFiles.includes(r)) {
					try {
						const ruleContent = await this._fileService.readFile(URI.joinPath(rootUri, r), undefined, token);
						rules += `\n[Règles trouvées dans ${r}]:\n${ruleContent.value.toString().trim()}\n`;
					} catch {
						// Ignorer
					}
				}
			}
		} catch {
			// Repli silencieux
		}

		return {
			rootPath,
			projectType,
			frameworks,
			keyFiles: keyFiles.slice(0, 30),
			directoryOverview: directoryOverview.slice(0, 20),
			rules
		};
	}

	formatContextPrompt(topology: IProjectTopology): string {
		return `
## CARTOGRAPHIE DU PROJET (COMPRÉHENSION CONTEXTUELLE)
- Type de projet : ${topology.projectType}
- Technologies & Frameworks : ${topology.frameworks.length > 0 ? topology.frameworks.join(', ') : 'Standards'}
- Racine du dépôt : ${topology.rootPath}
- Structure des répertoires :
${topology.directoryOverview.join('\n')}
${topology.rules ? `\n## RÈGLES SPÉCIFIQUES AU PROJET :\n${topology.rules}` : ''}
`;
	}
}
