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

interface IConverseResponse {
	output?: { message?: { role: string; content: IBedrockContentBlock[] } };
	stopReason?: string;
	usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
	message?: string;
}

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: string): Promise<string> {
	return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(data)));
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
	const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

/**
 * Amazon Bedrock via l'API Converse, signature AWS SigV4.
 *
 * Limite connue : la réponse est reçue en un seul bloc (endpoint `converse`) puis
 * ré-émise comme flux. Le vrai streaming (`converse-stream`) utilise le format binaire
 * `application/vnd.amazon.eventstream` et reste à implémenter.
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
			const host = `bedrock.${this._region}.amazonaws.com`;
			const res = await this._signedFetch('GET', host, '/foundation-models', '', undefined);
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

		const systemBlocks = request.messages
			.filter(m => m.role === 'system')
			.map(m => ({ text: m.content }));

		const body: Record<string, unknown> = {
			messages: this._toBedrockMessages(request.messages),
			inferenceConfig: {
				temperature: request.temperature ?? 0.7,
				maxTokens: request.maxTokens ?? 4096
			}
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
			const path = `/model/${encodeURIComponent(request.modelId)}/converse`;
			const res = await this._signedFetch('POST', host, path, '', JSON.stringify(body), abortController.signal);

			if (!res.ok) {
				yield { type: 'error', error: await this._describeError(res, request.modelId) };
				return;
			}

			const data = await res.json() as IConverseResponse;
			let toolIndex = 0;
			for (const block of data.output?.message?.content ?? []) {
				if (block.text) {
					yield { type: 'text', text: block.text };
				}
				if (block.toolUse) {
					yield {
						type: 'tool_call',
						toolCall: {
							index: toolIndex++,
							id: block.toolUse.toolUseId,
							name: block.toolUse.name,
							argumentChunk: JSON.stringify(block.toolUse.input ?? {})
						}
					};
				}
			}

			if (data.usage) {
				yield {
					type: 'usage',
					usage: {
						promptTokens: data.usage.inputTokens ?? 0,
						completionTokens: data.usage.outputTokens ?? 0,
						totalTokens: data.usage.totalTokens ?? ((data.usage.inputTokens ?? 0) + (data.usage.outputTokens ?? 0))
					}
				};
			}
			yield { type: 'finish', finishReason: data.stopReason === 'tool_use' ? 'tool_calls' : (data.stopReason ?? 'stop') };
		} catch (err: unknown) {
			if (token.isCancellationRequested) {
				yield { type: 'finish', finishReason: 'cancelled' };
				return;
			}
			yield { type: 'error', error: `Erreur Amazon Bedrock : ${err instanceof Error ? err.message : String(err)}` };
		} finally {
			listener.dispose();
		}
	}

	private _toToolSpec(tool: IToolDefinition): unknown {
		return {
			toolSpec: {
				name: tool.function.name,
				description: tool.function.description,
				inputSchema: { json: tool.function.parameters }
			}
		};
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

	private async _describeError(res: Response, modelId?: string): Promise<string> {
		let detail = '';
		try {
			const data = await res.json() as IConverseResponse;
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

	/** Requête signée AWS Signature Version 4. */
	private async _signedFetch(method: string, host: string, path: string, query: string, body: string | undefined, signal?: AbortSignal): Promise<Response> {
		const payload = body ?? '';
		const now = new Date();
		const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
		const dateStamp = amzDate.substring(0, 8);
		const service = 'bedrock';

		const headers: Record<string, string> = {
			'host': host,
			'x-amz-date': amzDate
		};
		if (body !== undefined) {
			headers['content-type'] = 'application/json';
		}
		if (this._sessionToken) {
			headers['x-amz-security-token'] = this._sessionToken;
		}

		const signedHeaderNames = Object.keys(headers).sort();
		const canonicalHeaders = signedHeaderNames.map(h => `${h}:${headers[h].trim()}\n`).join('');
		const signedHeaders = signedHeaderNames.join(';');

		// Hors S3, chaque segment du chemin est encodé une seconde fois dans la requête canonique.
		const canonicalUri = path.split('/').map(seg => encodeURIComponent(seg)).join('/');
		const canonicalRequest = [method, canonicalUri, query, canonicalHeaders, signedHeaders, await sha256Hex(payload)].join('\n');

		const scope = `${dateStamp}/${this._region}/${service}/aws4_request`;
		const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');

		const kDate = await hmac(encoder.encode(`AWS4${this._secretAccessKey}`), dateStamp);
		const kRegion = await hmac(new Uint8Array(kDate), this._region);
		const kService = await hmac(new Uint8Array(kRegion), service);
		const kSigning = await hmac(new Uint8Array(kService), 'aws4_request');
		const signature = toHex(await hmac(new Uint8Array(kSigning), stringToSign));

		const requestHeaders: Record<string, string> = {
			'x-amz-date': amzDate,
			'Authorization': `AWS4-HMAC-SHA256 Credential=${this._accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
		};
		if (body !== undefined) {
			requestHeaders['Content-Type'] = 'application/json';
		}
		if (this._sessionToken) {
			requestHeaders['x-amz-security-token'] = this._sessionToken;
		}

		return fetch(`https://${host}${path}${query ? `?${query}` : ''}`, {
			method,
			headers: requestHeaders,
			body: body !== undefined ? body : undefined,
			signal
		});
	}
}
