/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { CodebaseIndexer } from './codebaseIndexer.js';

export interface INativeSearchHit {
	readonly snippet: {
		readonly filePath: string;
		readonly startLine: number;
		readonly endLine: number;
		readonly content: string;
		readonly symbols: readonly string[];
	};
	readonly score: number;
}

export interface INativeAstSummary {
	readonly filesCount: number;
	readonly totalSymbols: number;
	readonly dependenciesCount: number;
}

export class NativeCoreBridge implements IDisposable {
	private static _instance: NativeCoreBridge | null = null;

	private _process: cp.ChildProcess | null = null;
	private _requestId = 0;
	private readonly _pendingRequests = new Map<number, { resolve: (res: any) => void; reject: (err: any) => void }>();
	private readonly _fallbackIndexer = new CodebaseIndexer();
	private _isNativeActive = false;

	static getInstance(binaryPath?: string): NativeCoreBridge {
		if (!NativeCoreBridge._instance) {
			NativeCoreBridge._instance = new NativeCoreBridge(binaryPath);
		}
		return NativeCoreBridge._instance;
	}

	constructor(binaryPath?: string) {
		const targetPath = binaryPath || this._findBinaryPath();
		if (targetPath) {
			this._spawnDaemon(targetPath);
		}
	}

	private _findBinaryPath(): string | undefined {
		const candidates = [
			path.join(process.cwd(), 'src/zerri-core/target/release/zerri-core.exe'),
			path.join(process.cwd(), 'src/zerri-core/target/debug/zerri-core.exe'),
			path.join(process.cwd(), 'src/zerri-core/target/release/zerri-core'),
			path.join(process.cwd(), 'src/zerri-core/target/debug/zerri-core'),
		];

		for (const candidate of candidates) {
			try {
				if (fs.existsSync(candidate)) {
					return candidate;
				}
			} catch {
				// Continuer la recherche
			}
		}
		return undefined;
	}

	private _spawnDaemon(binaryPath: string): void {
		try {
			this._process = cp.spawn(binaryPath, [], {
				stdio: ['pipe', 'pipe', 'inherit']
			});

			this._process.stdout?.on('data', (data: Buffer) => {
				const lines = data.toString('utf8').split('\n');
				for (const line of lines) {
					if (!line.trim()) {
						continue;
					}
					try {
						const response = JSON.parse(line) as { id: number; result?: any; error?: string };
						const pending = this._pendingRequests.get(response.id);
						if (pending) {
							this._pendingRequests.delete(response.id);
							if (response.error) {
								pending.reject(new Error(response.error));
							} else {
								pending.resolve(response.result);
							}
						}
					} catch {
						// Ignorer les fragments JSON incomplets
					}
				}
			});

			this._process.on('error', () => {
				this._isNativeActive = false;
			});

			this._process.on('exit', () => {
				this._isNativeActive = false;
			});

			this._isNativeActive = true;
		} catch {
			this._isNativeActive = false;
		}
	}

	get isNativeActive(): boolean {
		return this._isNativeActive;
	}

	async scanAndIndex(root: string): Promise<{ filesIndexed: number; snippetsTotal: number; astSummary: any }> {
		if (this._isNativeActive && this._process) {
			try {
				return await this._sendRpc('scan_and_index', { root });
			} catch {
				// Repli
			}
		}
		return { filesIndexed: 0, snippetsTotal: 0, astSummary: {} };
	}

	async findDefinition(symbol: string): Promise<any[]> {
		if (this._isNativeActive && this._process) {
			try {
				const res = await this._sendRpc('ast_find_definition', { symbol });
				return res?.definitions || [];
			} catch {
				// Repli
			}
		}
		return [];
	}

	async getFileDependencies(file: string): Promise<string[]> {
		if (this._isNativeActive && this._process) {
			try {
				const res = await this._sendRpc('ast_get_dependencies', { file });
				return res?.dependencies || [];
			} catch {
				// Repli
			}
		}
		return [];
	}

	async findRootCauseFiles(errorText: string, currentFile?: string): Promise<{ suspiciousFiles: string[]; definitionsFound: any[] }> {
		const suspiciousFiles = new Set<string>();
		const definitionsFound: any[] = [];

		if (currentFile) {
			const deps = await this.getFileDependencies(currentFile);
			for (const d of deps) {
				suspiciousFiles.add(d);
			}
		}

		// Extraire les noms de symboles, classes ou interfaces mentionnés dans l'erreur (ex: 'MyClass', "getUserData", Property 'x')
		const symbolMatches = errorText.match(/['"`]([A-Za-z0-9_$]+)['"`]/g) || [];
		for (const m of symbolMatches) {
			const cleanSym = m.replace(/['"`]/g, '').trim();
			if (cleanSym.length > 2) {
				const defs = await this.findDefinition(cleanSym);
				for (const def of defs) {
					definitionsFound.push(def);
					if (def.filePath) {
						suspiciousFiles.add(def.filePath);
					}
				}
			}
		}

		return {
			suspiciousFiles: Array.from(suspiciousFiles),
			definitionsFound
		};
	}

	async searchCodebase(query: string, topK: number = 8): Promise<readonly INativeSearchHit[]> {
		if (this._isNativeActive && this._process) {
			try {
				const res = await this._sendRpc('search_codebase', { query, topK });
				return res.hits || [];
			} catch {
				// Repli transparent
			}
		}

		// Repli sur l'indexeur TypeScript
		const fallbackHits = this._fallbackIndexer.search(query, topK);
		return fallbackHits.map(h => ({
			snippet: {
				filePath: h.chunk.filePath,
				startLine: h.chunk.startLine,
				endLine: h.chunk.endLine,
				content: h.chunk.content,
				symbols: h.chunk.symbols
			},
			score: h.score
		}));
	}

	async setSecret(key: string, secret: string): Promise<boolean> {
		if (this._isNativeActive && this._process) {
			try {
				const res = await this._sendRpc('vault_set', { key, secret });
				return res.success === true;
			} catch {
				return false;
			}
		}
		return true;
	}

	async getSecret(key: string): Promise<string | null> {
		if (this._isNativeActive && this._process) {
			try {
				const res = await this._sendRpc('vault_get', { key });
				return res.secret || null;
			} catch {
				return null;
			}
		}
		return null;
	}

	indexFileInMemory(path: string, content: string): void {
		this._fallbackIndexer.indexFile(path, content);
	}

	private _sendRpc(method: string, params?: Record<string, unknown>): Promise<any> {
		return new Promise((resolve, reject) => {
			const id = ++this._requestId;
			this._pendingRequests.set(id, { resolve, reject });

			const payload = JSON.stringify({ id, method, params }) + '\n';
			this._process?.stdin?.write(payload);
		});
	}

	dispose(): void {
		if (this._process) {
			this._process.kill();
			this._process = null;
		}
		this._isNativeActive = false;
	}
}
