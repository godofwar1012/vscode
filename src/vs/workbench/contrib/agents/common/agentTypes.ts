/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export interface IToolCall {
	readonly id: string;
	readonly type: 'function';
	readonly function: {
		readonly name: string;
		readonly arguments: string;
	};
}

export interface ILlmMessage {
	readonly role: LlmRole;
	readonly content: string;
	readonly name?: string;
	readonly tool_call_id?: string;
	readonly tool_calls?: readonly IToolCall[];
}

export interface IToolParameterSchema {
	readonly type: string;
	readonly description?: string;
	readonly properties?: Record<string, unknown>;
	readonly required?: readonly string[];
	readonly [key: string]: unknown;
}

export interface IToolDefinition {
	readonly type: 'function';
	readonly function: {
		readonly name: string;
		readonly description: string;
		readonly parameters: IToolParameterSchema;
	};
}

export interface ITokenUsage {
	readonly promptTokens: number;
	readonly completionTokens: number;
	readonly totalTokens: number;
}

export interface ICostEstimate {
	readonly inputCost: number;
	readonly outputCost: number;
	readonly totalCost: number;
	readonly currency: string;
}

export interface IModelDefinition {
	readonly id: string;
	readonly name: string;
	readonly providerId: string;
	readonly maxContextTokens: number;
	readonly maxOutputTokens?: number;
	readonly supportsStreaming: boolean;
	readonly supportsTools: boolean;
	readonly supportsReasoning: boolean;
	readonly inputPricePerMillion: number;
	readonly outputPricePerMillion: number;
}

export interface IModelStreamChunk {
	readonly type: 'text' | 'reasoning' | 'tool_call' | 'usage' | 'finish' | 'error';
	readonly text?: string;
	readonly reasoning?: string;
	readonly toolCall?: {
		readonly index?: number;
		readonly id?: string;
		readonly name?: string;
		readonly argumentChunk?: string;
	};
	readonly usage?: ITokenUsage;
	readonly finishReason?: string;
	readonly error?: string;
}

export interface IModelRequest {
	readonly modelId: string;
	readonly messages: readonly ILlmMessage[];
	readonly tools?: readonly IToolDefinition[];
	readonly temperature?: number;
	readonly maxTokens?: number;
	readonly reasoningEffort?: 'low' | 'medium' | 'high';
}

export interface IModelProvider {
	readonly id: string;
	readonly displayName: string;
	listModels(): Promise<IModelDefinition[]>;
	streamChat(request: IModelRequest, token: CancellationToken): AsyncIterable<IModelStreamChunk>;
	countTokens(text: string): Promise<number>;
	testConnection(): Promise<{ success: boolean; error?: string }>;
}
