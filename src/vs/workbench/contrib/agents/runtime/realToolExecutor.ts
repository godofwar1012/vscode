/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { SurgicalPatcher } from './surgicalPatcher.js';

export interface IToolExecutionEnvironment {
	readonly fileService: IFileService;
	readonly workspaceService: IWorkspaceContextService;
	readonly runCommandHost?: (command: string, token: CancellationToken) => Promise<string>;
}

export class RealToolExecutor {
	constructor(private readonly _env: IToolExecutionEnvironment) { }

	private _resolveUri(rawPath: string): URI {
		const trimmed = rawPath.trim();
		// Si chemin URI direct (file://...)
		if (trimmed.startsWith('file://')) {
			return URI.parse(trimmed);
		}

		const folders = this._env.workspaceService.getWorkspace().folders;
		const rootUri = folders.length > 0 ? folders[0].uri : URI.file('/');

		// Normalisation des séparateurs sous Windows / Unix
		const cleanRelative = trimmed.replace(/^[\\/]+/, '').replace(/\\/g, '/');
		return URI.joinPath(rootUri, cleanRelative);
	}

	async execute(toolName: string, args: Record<string, unknown>, token: CancellationToken): Promise<string> {
		switch (toolName) {
			case 'read_file': {
				const pathStr = String(args.path || '');
				if (!pathStr) {
					throw new Error('Paramètre `path` requis pour `read_file`.');
				}
				const uri = this._resolveUri(pathStr);
				const content = await this._env.fileService.readFile(uri, undefined, token);
				return content.value.toString();
			}

			case 'write_file': {
				const pathStr = String(args.path || '');
				const contentStr = typeof args.content === 'string' ? args.content : String(args.content ?? '');
				if (!pathStr) {
					throw new Error('Paramètre `path` requis pour `write_file`.');
				}
				const uri = this._resolveUri(pathStr);
				const buffer = new TextEncoder().encode(contentStr);
				// Crée le fichier ou l'écrase
				await this._env.fileService.writeFile(uri, {
					buffer: buffer,
					byteLength: buffer.byteLength
				} as any);
				return `Fichier écrit avec succès (${contentStr.length} caractères) : ${pathStr}`;
			}

			case 'edit_file': {
				const pathStr = String(args.path || '');
				const oldText = typeof args.old_text === 'string' ? args.old_text : '';
				const newText = typeof args.new_text === 'string' ? args.new_text : '';
				if (!pathStr) {
					throw new Error('Paramètre `path` requis pour `edit_file`.');
				}
				const uri = this._resolveUri(pathStr);
				const currentFile = await this._env.fileService.readFile(uri, undefined, token);
				const currentContent = currentFile.value.toString();

				let updatedContent: string;
				if (oldText) {
					if (!currentContent.includes(oldText)) {
						// Tenter un patch chirurgical avec Aider block si old_text est un bloc de patch
						const patchRes = SurgicalPatcher.applyPatch(currentContent, oldText);
						if (patchRes.success) {
							updatedContent = patchRes.modifiedContent;
						} else {
							throw new Error(`Le texte cible à remplacer est introuvable dans ${pathStr}.`);
						}
					} else {
						updatedContent = currentContent.replace(oldText, newText);
					}
				} else {
					throw new Error('Paramètre `old_text` manquant pour `edit_file`.');
				}

				const buffer = new TextEncoder().encode(updatedContent);
				await this._env.fileService.writeFile(uri, {
					buffer: buffer,
					byteLength: buffer.byteLength
				} as any);
				return `Fichier modifié avec succès : ${pathStr}`;
			}

			case 'list_dir': {
				const pathStr = String(args.path || '.');
				const uri = this._resolveUri(pathStr);
				const stat = await this._env.fileService.resolve(uri);
				if (!stat.children || stat.children.length === 0) {
					return `(Répertoire vide ou sans fichiers : ${pathStr})`;
				}
				const items = stat.children.map(child => `${child.isDirectory ? '[DIR] ' : '      '}${child.name}`);
				return items.join('\n');
			}

			case 'run_command': {
				const cmd = String(args.command || '').trim();
				if (!cmd) {
					throw new Error('Paramètre `command` manquant pour `run_command`.');
				}
				if (this._env.runCommandHost) {
					return await this._env.runCommandHost(cmd, token);
				}
				return `Commande simulée : ${cmd} (exécuteur de terminal natif non configuré).`;
			}

			default:
				throw new Error(`Outil inconnu : ${toolName}`);
		}
	}
}
