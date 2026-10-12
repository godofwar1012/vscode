/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
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

	private _getWorkspaceRootPath(): string {
		const folders = this._env.workspaceService.getWorkspace().folders;
		return folders.length > 0 ? folders[0].uri.fsPath : process.cwd();
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

				// Exécution native PowerShell / Shell direct avec gestion du timeout et annulation
				return new Promise<string>((resolve, reject) => {
					const cwd = this._getWorkspaceRootPath();
					const isWindows = process.platform === 'win32';
					const shell = isWindows ? 'powershell.exe' : '/bin/bash';
					const shellArgs = isWindows ? ['-NoProfile', '-NonInteractive', '-Command', cmd] : ['-c', cmd];

					const child = cp.spawn(shell, shellArgs, {
						cwd,
						env: { ...process.env }
					});

					let stdout = '';
					let stderr = '';

					child.stdout.on('data', (d: Buffer) => {
						stdout += d.toString('utf8');
					});

					child.stderr.on('data', (d: Buffer) => {
						stderr += d.toString('utf8');
					});

					const registration = token.onCancellationRequested(() => {
						child.kill();
						reject(new Error('Commande annulée par l\'utilisateur.'));
					});

					// Sécurité : timeout de 120 secondes pour les commandes lourdes
					const timeout = setTimeout(() => {
						child.kill();
						reject(new Error('Délai d\'attente dépassé (120 secondes).'));
					}, 120_000);

					child.on('close', (code: number) => {
						clearTimeout(timeout);
						registration.dispose();

						let output = '';
						if (stdout) {
							output += stdout;
						}
						if (stderr) {
							output += (output ? '\n[STDERR]\n' : '') + stderr;
						}

						if (code !== 0) {
							resolve(`Code de sortie: ${code}\n${output.trim()}`);
						} else {
							resolve(output.trim() || `(Commande exécutée avec succès sans sortie texte)`);
						}
					});

					child.on('error', (err: Error) => {
						clearTimeout(timeout);
						registration.dispose();
						reject(err);
					});
				});
			}

			default:
				throw new Error(`Outil inconnu : ${toolName}`);
		}
	}
}
