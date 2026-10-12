/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
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

export class NativeCoreBridge implements IDisposable {
	private _process: cp.ChildProcess | null = null;
	private _requestId = 0;
	private readonly _pendingRequests = new Map<number, { resolve: (res: any) => void; reject: (err: any) => void }>();
	private readonly _fallbackIndexer = new CodebaseIndexer();
	private _isNativeActive = false;

	constructor(binaryPath?: string) {
		if (binaryPath) {
			this._spawnDaemon(binaryPath);
		}
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
						// Ignorer les fragments incomplets
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
	}
}
