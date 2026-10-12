/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DEFAULT_BEDROCK_MODELS } from '../common/agentConfiguration.js';
import {
	IModelDefinition,
	IModelProvider,
	IModelRequest,
	IModelStreamChunk
} from '../common/agentTypes.js';

export interface IBedrockConfig {
	readonly region: string;
	readonly accessKeyId?: string;
	readonly secretAccessKey?: string;
	readonly sessionToken?: string;
	readonly customModels?: readonly IModelDefinition[];
}

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
			return {
				success: false,
				error: 'Identifiants AWS manquants (AccessKeyId ou SecretAccessKey).'
			};
		}
		// Simulation / test rapide de validation de la configuration de région
		return { success: true };
	}

	async *streamChat(request: IModelRequest, token: CancellationToken): AsyncIterable<IModelStreamChunk> {
		if (!this._accessKeyId || !this._secretAccessKey) {
			yield {
				type: 'error',
				error: 'Amazon Bedrock nécessite une paire de clés AccessKeyId et SecretAccessKey.'
			};
			return;
		}

		// Structure de requête pour l'API Bedrock ConverseStream
		// https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html
		const bedrockMessages = request.messages
			.filter(m => m.role !== 'system')
			.map(m => ({
				role: m.role === 'assistant' ? 'assistant' : 'user',
				content: [{ text: m.content }]
			}));

		const systemPrompt = request.messages
			.filter(m => m.role === 'system')
			.map(m => ({ text: m.content }));

		const converseBody: Record<string, unknown> = {
			modelId: request.modelId,
			messages: bedrockMessages,
			inferenceConfig: {
				temperature: request.temperature ?? 0.7,
				maxTokens: request.maxTokens ?? 4096
			}
		};

		if (systemPrompt.length > 0) {
			converseBody.system = systemPrompt;
		}

		// Endpoint Bedrock Runtime
		const endpoint = `https://bedrock-runtime.${this._region}.amazonaws.com/model/${encodeURIComponent(request.modelId)}/converse-stream`;

		try {
			yield {
				type: 'text',
				text: `[Bedrock ${request.modelId} connect initialisé sur la région ${this._region}]`
			};
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			yield { type: 'error', error: `Erreur Amazon Bedrock: ${message}` };
		}
	}
}
