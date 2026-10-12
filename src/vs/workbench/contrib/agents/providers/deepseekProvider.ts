/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DEFAULT_DEEPSEEK_MODELS } from '../common/agentConfiguration.js';
import {
	IModelDefinition,
	IModelProvider,
	IModelRequest,
	IModelStreamChunk
} from '../common/agentTypes.js';

export interface IDeepSeekConfig {
	readonly apiKey: string;
	readonly baseUrl?: string;
	readonly customModels?: readonly IModelDefinition[];
}

export class DeepSeekProvider implements IModelProvider {
	readonly id = 'deepseek';
	readonly displayName = 'DeepSeek';

	private readonly _baseUrl: string;
	private readonly _apiKey: string;
	private readonly _models: readonly IModelDefinition[];

	constructor(config: IDeepSeekConfig) {
		this._apiKey = config.apiKey;
		this._baseUrl = (config.baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
		this._models = config.customModels && config.customModels.length > 0
			? config.customModels
			: DEFAULT_DEEPSEEK_MODELS;
	}

	async listModels(): Promise<IModelDefinition[]> {
		return [...this._models];
	}

	async countTokens(text: string): Promise<number> {
		// Approximatif en local (1 token ≈ 4 caractères en moyenne) sans appel réseau
		return Math.ceil(text.length / 4);
	}

	async testConnection(): Promise<{ success: boolean; error?: string }> {
		if (!this._apiKey || this._apiKey.trim().length === 0) {
			return { success: false, error: 'La clé API DeepSeek est manquante.' };
		}
		try {
			const res = await fetch(`${this._baseUrl}/models`, {
				headers: {
					'Authorization': `Bearer ${this._apiKey}`,
					'Content-Type': 'application/json'
				}
			});
			if (!res.ok) {
				const body = await res.text();
				return {
					success: false,
					error: `Échec de connexion DeepSeek (HTTP ${res.status}): ${body}`
				};
			}
			return { success: true };
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			return { success: false, error: `Erreur réseau lors du test DeepSeek: ${message}` };
		}
	}

	async *streamChat(request: IModelRequest, token: CancellationToken): AsyncIterable<IModelStreamChunk> {
		if (!this._apiKey) {
			yield { type: 'error', error: 'Clé API DeepSeek non configurée.' };
			return;
		}

		const body: Record<string, unknown> = {
			model: request.modelId,
			messages: request.messages.map(m => {
				const msg: Record<string, unknown> = {
					role: m.role,
					content: m.content
				};
				if (m.name) {
					msg.name = m.name;
				}
				if (m.tool_call_id) {
					msg.tool_call_id = m.tool_call_id;
				}
				if (m.tool_calls && m.tool_calls.length > 0) {
					msg.tool_calls = m.tool_calls;
				}
				return msg;
			}),
			stream: true
		};

		if (typeof request.temperature === 'number') {
			body.temperature = request.temperature;
		}
		if (typeof request.maxTokens === 'number') {
			body.max_tokens = request.maxTokens;
		}
		if (request.tools && request.tools.length > 0) {
			body.tools = request.tools;
		}

		const abortController = new AbortController();
		const cancellationListener = token.onCancellationRequested(() => {
			abortController.abort();
		});

		try {
			const response = await fetch(`${this._baseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this._apiKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(body),
				signal: abortController.signal
			});

			if (!response.ok) {
				const errBody = await response.text();
				yield {
					type: 'error',
					error: `Erreur API DeepSeek (HTTP ${response.status}): ${errBody}`
				};
				return;
			}

			if (!response.body) {
				yield { type: 'error', error: 'Aucun flux de réponse reçu du serveur DeepSeek.' };
				return;
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder('utf-8');
			let buffer = '';

			while (!token.isCancellationRequested) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || !trimmed.startsWith('data:')) {
						continue;
					}

					const payload = trimmed.substring(5).trim();
					if (payload === '[DONE]') {
						yield { type: 'finish', finishReason: 'stop' };
						return;
					}

					try {
						const parsed = JSON.parse(payload) as {
							choices?: Array<{
								delta?: {
									content?: string;
									reasoning_content?: string;
									tool_calls?: Array<{
										index?: number;
										id?: string;
										function?: {
											name?: string;
											arguments?: string;
										};
									}>;
								};
								finish_reason?: string;
							}>;
							usage?: {
								prompt_tokens?: number;
								completion_tokens?: number;
								total_tokens?: number;
							};
						};

						if (parsed.usage) {
							yield {
								type: 'usage',
								usage: {
									promptTokens: parsed.usage.prompt_tokens || 0,
									completionTokens: parsed.usage.completion_tokens || 0,
									totalTokens: parsed.usage.total_tokens || 0
								}
							};
						}

						const choice = parsed.choices?.[0];
						if (!choice) {
							continue;
						}

						if (choice.delta?.reasoning_content) {
							yield {
								type: 'reasoning',
								reasoning: choice.delta.reasoning_content
							};
						}

						if (choice.delta?.content) {
							yield {
								type: 'text',
								text: choice.delta.content
							};
						}

						if (choice.delta?.tool_calls) {
							for (const tc of choice.delta.tool_calls) {
								yield {
									type: 'tool_call',
									toolCall: {
										index: tc.index,
										id: tc.id,
										name: tc.function?.name,
										argumentChunk: tc.function?.arguments
									}
								};
							}
						}

						if (choice.finish_reason) {
							yield {
								type: 'finish',
								finishReason: choice.finish_reason
							};
						}
					} catch {
						// Ligne JSON partielle ignorée jusqu'au chunk suivant
					}
				}
			}
		} catch (err: unknown) {
			if (token.isCancellationRequested) {
				yield { type: 'finish', finishReason: 'cancelled' };
				return;
			}
			const message = err instanceof Error ? err.message : String(err);
			yield { type: 'error', error: `Erreur de communication DeepSeek: ${message}` };
		} finally {
			cancellationListener.dispose();
		}
	}
}
