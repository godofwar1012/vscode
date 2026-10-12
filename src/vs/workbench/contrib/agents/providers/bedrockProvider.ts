/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DEFAULT_BEDROCK_MODELS } from '../common/agentConfiguration.js';
import {
	ILlmMessage,
	IModelDefinition,
	IModelProvider,
	IModelRequest,
	IModelStreamChunk,
	IToolDefinition
} from '../common/agentTypes.js';
import { EventStreamError, EventStreamParser } from './awsEventStream.js';
import { signRequest } from './awsSigV4.js';

export interface IBedrockConfig {
	readonly region: string;
	readonly accessKeyId?: string;
	readonly secretAccessKey?: string;
	readonly sessionToken?: string;
	readonly customModels?: readonly IModelDefinition[];
}

interface IBedrockContentBlock {
	text?: string;
	toolUse?: { toolUseId: string; name: string; input: unknown };
	toolResult?: { toolUseId: string; content: Array<{ text: string }> };
}

interface IBedrockMessage {
	role: 'user' | 'assistant';
	content: IBedrockContentBlock[];
}

interface IStreamEvent {
	contentBlockIndex?: number;
	start?: { toolUse?: { toolUseId: string; name: string } };
	delta?: { text?: string; toolUse?: { input?: string }; reasoningContent?: { text?: string } };
	stopReason?: string;
	usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
	message?: string;
}

/**
 * Amazon Bedrock via l'API ConverseStream (flux binaire `application/vnd.amazon.eventstream`),
 * requêtes signées en AWS Signature V4.
 */
export class BedrockProvider implements IModelProvider {
	readonly id = 'bedrock';
	readonly displayName = 'Amazon Bedrock';

	private readonly _region: string;
	private readonly _accessKeyId?: string;
	private readonly _secretAccessKey?: string;
	private readonly _sessionToken?: string;
	private readonly _models: readonly IModelDefinition[];

	constructor(config: IBedrockConfig) {
		this._region = config.region || 'us-east-1';
		this._accessKeyId = config.accessKeyId;
		this._secretAccessKey = config.secretAccessKey;
		this._sessionToken = config.sessionToken;
		this._models = config.customModels && config.customModels.length > 0
			? config.customModels
			: DEFAULT_BEDROCK_MODELS;
	}

	async listModels(): Promise<IModelDefinition[]> {
		return [...this._models];
	}

	async countTokens(text: string): Promise<number> {
		return Math.ceil(text.length / 4);
	}

	async testConnection(): Promise<{ success: boolean; error?: string }> {
		if (!this._accessKeyId || !this._secretAccessKey) {
			return { success: false, error: 'Identifiants AWS manquants (AccessKeyId ou SecretAccessKey).' };
		}
		try {
			const res = await this._signedFetch('GET', `bedrock.${this._region}.amazonaws.com`, '/foundation-models', undefined);
			if (!res.ok) {
				return { success: false, error: await this._describeError(res) };
			}
			return { success: true };
		} catch (err: unknown) {
			return { success: false, error: `Erreur réseau Bedrock : ${err instanceof Error ? err.message : String(err)}` };
		}
	}

	async *streamChat(request: IModelRequest, token: CancellationToken): AsyncIterable<IModelStreamChunk> {
		if (!this._accessKeyId || !this._secretAccessKey) {
			yield { type: 'error', error: 'Amazon Bedrock nécessite une paire AccessKeyId / SecretAccessKey.' };
			return;
		}

		const systemBlocks = request.messages.filter(m => m.role === 'system').map(m => ({ text: m.content }));
		const body: Record<string, unknown> = {
			messages: this._toBedrockMessages(request.messages),
			inferenceConfig: { temperature: request.temperature ?? 0.7, maxTokens: request.maxTokens ?? 4096 }
		};
		if (systemBlocks.length > 0) {
			body.system = systemBlocks;
		}
		if (request.tools && request.tools.length > 0) {
			body.toolConfig = { tools: request.tools.map(t => this._toToolSpec(t)) };
		}

		const abortController = new AbortController();
		const listener = token.onCancellationRequested(() => abortController.abort());

		try {
			const host = `bedrock-runtime.${this._region}.amazonaws.com`;
			const path = `/model/${encodeURIComponent(request.modelId)}/converse-stream`;
			const res = await this._signedFetch('POST', host, path, JSON.stringify(body), abortController.signal);

			if (!res.ok) {
				yield { type: 'error', error: await this._describeError(res, request.modelId) };
				return;
			}
			if (!res.body) {
				yield { type: 'error', error: 'Aucun flux de réponse reçu de Bedrock.' };
				return;
			}

			const parser = new EventStreamParser();
			const decoder = new TextDecoder('utf-8');
			const reader = res.body.getReader();
			// Les arguments d'outil arrivent par fragments : on mémorise id et nom par bloc.
			const toolBlocks = new Map<number, { id: string; name: string; order: number }>();
			let finishReason = 'stop';

			while (!token.isCancellationRequested) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				for (const message of parser.feed(value)) {
					const messageType = message.headers[':message-type'];
					const eventType = String(message.headers[':event-type'] ?? message.headers[':exception-type'] ?? '');
					let event: IStreamEvent = {};
					try {
						event = JSON.parse(decoder.decode(message.payload)) as IStreamEvent;
					} catch {
						// charge utile vide ou non JSON
					}

					if (messageType === 'exception' || messageType === 'error') {
						yield { type: 'error', error: this._describeStreamException(eventType, event.message, request.modelId) };
						return;
					}

					switch (eventType) {
						case 'contentBlockStart': {
							const tool = event.start?.toolUse;
							if (tool && event.contentBlockIndex !== undefined) {
								toolBlocks.set(event.contentBlockIndex, { id: tool.toolUseId, name: tool.name, order: toolBlocks.size });
								yield { type: 'tool_call', toolCall: { index: toolBlocks.size - 1, id: tool.toolUseId, name: tool.name } };
							}
							break;
						}
						case 'contentBlockDelta': {
							if (event.delta?.text) {
								yield { type: 'text', text: event.delta.text };
							}
							if (event.delta?.reasoningContent?.text) {
								yield { type: 'reasoning', reasoning: event.delta.reasoningContent.text };
							}
							const input = event.delta?.toolUse?.input;
							if (input !== undefined && event.contentBlockIndex !== undefined) {
								const block = toolBlocks.get(event.contentBlockIndex);
								if (block) {
									yield { type: 'tool_call', toolCall: { index: block.order, argumentChunk: input } };
								}
							}
							break;
						}
						case 'messageStop':
							finishReason = event.stopReason === 'tool_use' ? 'tool_calls' : (event.stopReason ?? 'stop');
							break;
						case 'metadata':
							if (event.usage) {
								yield {
									type: 'usage',
									usage: {
										promptTokens: event.usage.inputTokens ?? 0,
										completionTokens: event.usage.outputTokens ?? 0,
										totalTokens: event.usage.totalTokens ?? ((event.usage.inputTokens ?? 0) + (event.usage.outputTokens ?? 0))
									}
								};
							}
							break;
					}
				}
			}

			yield { type: 'finish', finishReason: token.isCancellationRequested ? 'cancelled' : finishReason };
		} catch (err: unknown) {
			if (token.isCancellationRequested) {
				yield { type: 'finish', finishReason: 'cancelled' };
				return;
			}
			const message = err instanceof EventStreamError
				? `Flux Bedrock corrompu : ${err.message}`
				: `Erreur Amazon Bedrock : ${err instanceof Error ? err.message : String(err)}`;
			yield { type: 'error', error: message };
		} finally {
			listener.dispose();
		}
	}

	private _toToolSpec(tool: IToolDefinition): unknown {
		return { toolSpec: { name: tool.function.name, description: tool.function.description, inputSchema: { json: tool.function.parameters } } };
	}

	/**
	 * Convertit l'historique au format Converse. Bedrock exige l'alternance user/assistant :
	 * les messages `tool` consécutifs sont fusionnés dans un seul message `user`.
	 */
	private _toBedrockMessages(messages: readonly ILlmMessage[]): IBedrockMessage[] {
		const result: IBedrockMessage[] = [];
		const push = (role: 'user' | 'assistant', block: IBedrockContentBlock) => {
			const last = result[result.length - 1];
			if (last && last.role === role) {
				last.content.push(block);
			} else {
				result.push({ role, content: [block] });
			}
		};

		for (const m of messages) {
			if (m.role === 'system') {
				continue;
			}
			if (m.role === 'tool') {
				push('user', { toolResult: { toolUseId: m.tool_call_id ?? '', content: [{ text: m.content || '(vide)' }] } });
			} else if (m.role === 'assistant') {
				if (m.content) {
					push('assistant', { text: m.content });
				}
				for (const tc of m.tool_calls ?? []) {
					let input: unknown = {};
					try {
						input = JSON.parse(tc.function.arguments || '{}');
					} catch {
						input = {};
					}
					push('assistant', { toolUse: { toolUseId: tc.id, name: tc.function.name, input } });
				}
			} else {
				push('user', { text: m.content || '(vide)' });
			}
		}
		return result;
	}

	private _describeStreamException(type: string, detail: string | undefined, modelId: string): string {
		const suffix = detail ? ` Détail : ${detail}` : '';
		switch (type) {
			case 'throttlingException': return `Quota Bedrock dépassé (trop de requêtes). Réessayez plus tard.${suffix}`;
			case 'validationException': return `Requête refusée par Bedrock (paramètres invalides pour ${modelId}).${suffix}`;
			case 'modelStreamErrorException': return `Erreur du modèle ${modelId} pendant la génération.${suffix}`;
			case 'modelTimeoutException': return `Le modèle ${modelId} a dépassé le délai de réponse.${suffix}`;
			case 'serviceUnavailableException': return `Service Bedrock indisponible dans la région ${this._region}.${suffix}`;
			default: return `Exception Bedrock (${type}).${suffix}`;
		}
	}

	private async _describeError(res: Response, modelId?: string): Promise<string> {
		let detail = '';
		try {
			const data = await res.json() as IStreamEvent;
			detail = data.message ?? '';
		} catch {
			// corps non JSON
		}
		if (res.status === 403 && /model|access/i.test(detail)) {
			return `Accès refusé${modelId ? ` au modèle ${modelId}` : ''} : activez ce modèle dans la console AWS Bedrock (« Model access ») pour la région ${this._region}. Détail : ${detail}`;
		}
		if (res.status === 403) {
			return `Identifiants AWS refusés ou droits IAM insuffisants (bedrock:InvokeModel). Détail : ${detail}`;
		}
		if (res.status === 429) {
			return 'Quota Bedrock dépassé (trop de requêtes). Réessayez plus tard.';
		}
		return `Erreur Bedrock HTTP ${res.status}${detail ? ` : ${detail}` : ''}`;
	}

	private async _signedFetch(method: string, host: string, path: string, body: string | undefined, signal?: AbortSignal): Promise<Response> {
		const signed = await signRequest({
			method,
			host,
			path,
			body,
			headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
			region: this._region,
			service: 'bedrock',
			accessKeyId: this._accessKeyId!,
			secretAccessKey: this._secretAccessKey!,
			sessionToken: this._sessionToken
		});
		return fetch(`https://${host}${path}`, { method, headers: signed.headers, body, signal });
	}
}
