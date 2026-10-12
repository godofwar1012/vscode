/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import {
	IModelDefinition,
	IModelProvider,
	IModelRequest,
	IModelStreamChunk
} from '../common/agentTypes.js';

export interface IOpenAiCompatibleConfig {
	readonly id?: string;
	readonly displayName?: string;
	readonly baseUrl: string;
	readonly apiKey?: string;
	readonly models?: readonly IModelDefinition[];
}

export class OpenAiCompatibleProvider implements IModelProvider {
	readonly id: string;
	readonly displayName: string;

	private readonly _baseUrl: string;
	private readonly _apiKey?: string;
	private _models: IModelDefinition[];

	constructor(config: IOpenAiCompatibleConfig) {
		this.id = config.id || 'openai-compatible';
		this.displayName = config.displayName || 'OpenAI Compatible (Ollama / vLLM / OpenRouter)';
		this._baseUrl = config.baseUrl.replace(/\/+$/, '');
		this._apiKey = config.apiKey;
		this._models = config.models ? [...config.models] : [];
	}

	async listModels(): Promise<IModelDefinition[]> {
		if (this._models.length > 0) {
			return this._models;
		}

		try {
			const headers: Record<string, string> = { 'Content-Type': 'application/json' };
			if (this._apiKey) {
				headers['Authorization'] = `Bearer ${this._apiKey}`;
			}
			const res = await fetch(`${this._baseUrl}/models`, { headers });
			if (res.ok) {
				const data = await res.json() as { data?: Array<{ id: string }> };
				if (Array.isArray(data.data)) {
					this._models = data.data.map(m => ({
						id: m.id,
						name: m.id,
						providerId: this.id,
						maxContextTokens: 32000,
						supportsStreaming: true,
						supportsTools: true,
						supportsReasoning: false,
						inputPricePerMillion: 0,
						outputPricePerMillion: 0
					}));
					return this._models;
				}
			}
		} catch {
			// Repli sur modèle par défaut si /models échoue
		}

		return [
			{
				id: 'default',
				name: 'Default Model',
				providerId: this.id,
				maxContextTokens: 32000,
				supportsStreaming: true,
				supportsTools: true,
				supportsReasoning: false,
				inputPricePerMillion: 0,
				outputPricePerMillion: 0
			}
		];
	}

	async countTokens(text: string): Promise<number> {
		return Math.ceil(text.length / 4);
	}

	async testConnection(): Promise<{ success: boolean; error?: string }> {
		try {
			const headers: Record<string, string> = { 'Content-Type': 'application/json' };
			if (this._apiKey) {
				headers['Authorization'] = `Bearer ${this._apiKey}`;
			}
			const res = await fetch(`${this._baseUrl}/models`, { headers });
			if (!res.ok) {
				return { success: false, error: `Erreur HTTP ${res.status}` };
			}
			return { success: true };
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			return { success: false, error: message };
		}
	}

	async *streamChat(request: IModelRequest, token: CancellationToken): AsyncIterable<IModelStreamChunk> {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (this._apiKey) {
			headers['Authorization'] = `Bearer ${this._apiKey}`;
		}

		const body: Record<string, unknown> = {
			model: request.modelId,
			messages: request.messages,
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
				headers,
				body: JSON.stringify(body),
				signal: abortController.signal
			});

			if (!response.ok) {
				const errBody = await response.text();
				yield {
					type: 'error',
					error: `Erreur API (${response.status}): ${errBody}`
				};
				return;
			}

			if (!response.body) {
				yield { type: 'error', error: 'Aucun flux de réponse reçu.' };
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
						// Ignorer les fragments incomplets
					}
				}
			}
		} catch (err: unknown) {
			if (token.isCancellationRequested) {
				yield { type: 'finish', finishReason: 'cancelled' };
				return;
			}
			const message = err instanceof Error ? err.message : String(err);
			yield { type: 'error', error: `Erreur réseau: ${message}` };
		} finally {
			cancellationListener.dispose();
		}
	}
}
