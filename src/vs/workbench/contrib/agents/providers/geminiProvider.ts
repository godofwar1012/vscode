/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DEFAULT_GEMINI_MODELS } from '../common/agentConfiguration.js';
import {
	ILlmMessage,
	IModelDefinition,
	IModelProvider,
	IModelRequest,
	IModelStreamChunk,
	IToolDefinition
} from '../common/agentTypes.js';

export interface IGeminiConfig {
	/** Clé d'API Google AI Studio (gratuite : https://aistudio.google.com/apikey). */
	readonly apiKey: string;
	readonly baseUrl?: string;
	readonly customModels?: readonly IModelDefinition[];
}

interface IGeminiPart {
	text?: string;
	thought?: boolean;
	thoughtSignature?: string;
	functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
	functionResponse?: { name: string; response: Record<string, unknown> };
}

interface IGeminiContent {
	role: 'user' | 'model';
	parts: IGeminiPart[];
}

interface IGeminiChunk {
	candidates?: Array<{ content?: { parts?: IGeminiPart[] }; finishReason?: string }>;
	usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };
	error?: { code?: number; message?: string; status?: string };
}

/**
 * Google Gemini (API Gemini Developer, clé d'API uniquement).
 * Les modèles Flash disposent d'un palier gratuit : il suffit de saisir la clé.
 */
export class GeminiProvider implements IModelProvider {
	readonly id = 'gemini';
	readonly displayName = 'Google Gemini';

	private readonly _apiKey: string;
	private readonly _baseUrl: string;
	private readonly _models: readonly IModelDefinition[];

	constructor(config: IGeminiConfig) {
		this._apiKey = config.apiKey;
		this._baseUrl = (config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
		this._models = config.customModels && config.customModels.length > 0 ? config.customModels : DEFAULT_GEMINI_MODELS;
	}

	async listModels(): Promise<IModelDefinition[]> {
		return [...this._models];
	}

	async countTokens(text: string): Promise<number> {
		return Math.ceil(text.length / 4);
	}

	async testConnection(): Promise<{ success: boolean; error?: string }> {
		if (!this._apiKey || this._apiKey.trim().length === 0) {
			return { success: false, error: 'La clé API Gemini est manquante. Créez-en une gratuitement sur https://aistudio.google.com/apikey' };
		}
		try {
			const res = await fetch(`${this._baseUrl}/models?pageSize=1`, { headers: { 'x-goog-api-key': this._apiKey } });
			if (!res.ok) {
				return { success: false, error: await this._describeError(res) };
			}
			return { success: true };
		} catch (err: unknown) {
			return { success: false, error: `Erreur réseau Gemini : ${err instanceof Error ? err.message : String(err)}` };
		}
	}

	async *streamChat(request: IModelRequest, token: CancellationToken): AsyncIterable<IModelStreamChunk> {
		if (!this._apiKey) {
			yield { type: 'error', error: 'Clé API Gemini non configurée.' };
			return;
		}

		const systemText = request.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
		const generationConfig: Record<string, unknown> = {
			temperature: request.temperature ?? 0.7,
			thinkingConfig: { includeThoughts: true }
		};
		if (typeof request.maxTokens === 'number') {
			generationConfig.maxOutputTokens = request.maxTokens;
		}

		const body: Record<string, unknown> = { contents: this._toContents(request.messages), generationConfig };
		if (systemText) {
			body.systemInstruction = { parts: [{ text: systemText }] };
		}
		if (request.tools && request.tools.length > 0) {
			body.tools = [{ functionDeclarations: request.tools.map(t => this._toDeclaration(t)) }];
		}

		const abortController = new AbortController();
		const listener = token.onCancellationRequested(() => abortController.abort());

		try {
			const url = `${this._baseUrl}/models/${encodeURIComponent(request.modelId)}:streamGenerateContent?alt=sse`;
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'x-goog-api-key': this._apiKey, 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: abortController.signal
			});

			if (!res.ok) {
				yield { type: 'error', error: await this._describeError(res, request.modelId) };
				return;
			}
			if (!res.body) {
				yield { type: 'error', error: 'Aucun flux de réponse reçu de Gemini.' };
				return;
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder('utf-8');
			let buffer = '';
			let toolIndex = 0;
			let sawToolCall = false;
			let finishReason = 'stop';
			// usageMetadata est cumulatif dans chaque chunk : on n'émet que la dernière valeur.
			let lastUsage: IGeminiChunk['usageMetadata'];

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
					if (!trimmed.startsWith('data:')) {
						continue;
					}
					let chunk: IGeminiChunk;
					try {
						chunk = JSON.parse(trimmed.substring(5).trim()) as IGeminiChunk;
					} catch {
						continue;
					}

					if (chunk.error) {
						yield { type: 'error', error: `Erreur Gemini (${chunk.error.status ?? chunk.error.code}) : ${chunk.error.message ?? ''}` };
						return;
					}
					if (chunk.usageMetadata) {
						lastUsage = chunk.usageMetadata;
					}

					const candidate = chunk.candidates?.[0];
					for (const part of candidate?.content?.parts ?? []) {
						if (part.functionCall) {
							sawToolCall = true;
							yield {
								type: 'tool_call',
								toolCall: {
									index: toolIndex,
									id: part.functionCall.id ?? `call-${toolIndex}`,
									name: part.functionCall.name,
									argumentChunk: JSON.stringify(part.functionCall.args ?? {}),
									thoughtSignature: part.thoughtSignature
								}
							};
							toolIndex++;
						} else if (part.text) {
							yield part.thought ? { type: 'reasoning', reasoning: part.text } : { type: 'text', text: part.text };
						}
					}
					if (candidate?.finishReason) {
						finishReason = candidate.finishReason;
					}
				}
			}

			if (lastUsage) {
				const prompt = lastUsage.promptTokenCount ?? 0;
				const completion = (lastUsage.candidatesTokenCount ?? 0) + (lastUsage.thoughtsTokenCount ?? 0);
				yield { type: 'usage', usage: { promptTokens: prompt, completionTokens: completion, totalTokens: lastUsage.totalTokenCount ?? (prompt + completion) } };
			}
			yield { type: 'finish', finishReason: token.isCancellationRequested ? 'cancelled' : (sawToolCall ? 'tool_calls' : finishReason.toLowerCase()) };
		} catch (err: unknown) {
			if (token.isCancellationRequested) {
				yield { type: 'finish', finishReason: 'cancelled' };
				return;
			}
			yield { type: 'error', error: `Erreur de communication Gemini : ${err instanceof Error ? err.message : String(err)}` };
		} finally {
			listener.dispose();
		}
	}

	/** Gemini n'accepte qu'un sous-ensemble d'OpenAPI : on retire les mots-clés JSON Schema non supportés. */
	private _sanitizeSchema(schema: unknown): unknown {
		if (Array.isArray(schema)) {
			return schema.map(s => this._sanitizeSchema(s));
		}
		if (schema && typeof schema === 'object') {
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
				if (k === 'additionalProperties' || k === '$schema' || k === 'default') {
					continue;
				}
				out[k] = this._sanitizeSchema(v);
			}
			return out;
		}
		return schema;
	}

	private _toDeclaration(tool: IToolDefinition): unknown {
		return { name: tool.function.name, description: tool.function.description, parameters: this._sanitizeSchema(tool.function.parameters) };
	}

	private _toContents(messages: readonly ILlmMessage[]): IGeminiContent[] {
		const result: IGeminiContent[] = [];
		const toolNames = new Map<string, string>();
		const push = (role: 'user' | 'model', part: IGeminiPart) => {
			const last = result[result.length - 1];
			if (last && last.role === role) {
				last.parts.push(part);
			} else {
				result.push({ role, parts: [part] });
			}
		};

		for (const m of messages) {
			if (m.role === 'system') {
				continue;
			}
			if (m.role === 'assistant') {
				if (m.content) {
					push('model', { text: m.content });
				}
				for (const tc of m.tool_calls ?? []) {
					toolNames.set(tc.id, tc.function.name);
					let args: Record<string, unknown> = {};
					try {
						args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
					} catch {
						args = {};
					}
					// La signature doit être renvoyée dans la partie exacte où elle a été reçue.
					push('model', { functionCall: { name: tc.function.name, args }, thoughtSignature: tc.thoughtSignature });
				}
			} else if (m.role === 'tool') {
				const name = m.name ?? toolNames.get(m.tool_call_id ?? '') ?? 'unknown_tool';
				push('user', { functionResponse: { name, response: { result: m.content } } });
			} else {
				push('user', { text: m.content || '(vide)' });
			}
		}
		return result;
	}

	private async _describeError(res: Response, modelId?: string): Promise<string> {
		let detail = '';
		try {
			const data = await res.json() as IGeminiChunk;
			detail = data.error?.message ?? '';
		} catch {
			// corps non JSON
		}
		switch (res.status) {
			case 400:
				return /api key/i.test(detail)
					? `Clé API Gemini invalide. Créez-en une gratuitement sur https://aistudio.google.com/apikey. Détail : ${detail}`
					: `Requête refusée par Gemini${modelId ? ` (${modelId})` : ''}. Détail : ${detail}`;
			case 403: return `Accès refusé par Gemini (clé sans droit ou région non prise en charge). Détail : ${detail}`;
			case 404: return `Modèle introuvable${modelId ? ` : ${modelId}` : ''}. Vérifiez l'identifiant du modèle. Détail : ${detail}`;
			case 429: return `Limite du palier gratuit Gemini atteinte (requêtes ou tokens par minute/jour). Attendez un peu ou passez en palier payant. Détail : ${detail}`;
			default: return `Erreur Gemini HTTP ${res.status}${detail ? ` : ${detail}` : ''}`;
		}
	}
}
