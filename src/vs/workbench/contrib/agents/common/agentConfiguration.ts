/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICostEstimate, IModelDefinition, ITokenUsage } from './agentTypes.js';

export const DEFAULT_DEEPSEEK_MODELS: readonly IModelDefinition[] = [
	{
		id: 'deepseek-chat',
		name: 'DeepSeek-V3',
		providerId: 'deepseek',
		maxContextTokens: 64000,
		maxOutputTokens: 8192,
		supportsStreaming: true,
		supportsTools: true,
		supportsReasoning: false,
		inputPricePerMillion: 0.14,
		outputPricePerMillion: 0.28
	},
	{
		id: 'deepseek-reasoner',
		name: 'DeepSeek-R1 (Reasoning)',
		providerId: 'deepseek',
		maxContextTokens: 64000,
		maxOutputTokens: 8192,
		supportsStreaming: true,
		supportsTools: true,
		supportsReasoning: true,
		inputPricePerMillion: 0.55,
		outputPricePerMillion: 2.19
	}
];

export const DEFAULT_BEDROCK_MODELS: readonly IModelDefinition[] = [
	{
		id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
		name: 'Claude 3.5 Sonnet (Bedrock)',
		providerId: 'bedrock',
		maxContextTokens: 200000,
		maxOutputTokens: 8192,
		supportsStreaming: true,
		supportsTools: true,
		supportsReasoning: true,
		inputPricePerMillion: 3.00,
		outputPricePerMillion: 15.00
	},
	{
		id: 'amazon.nova-pro-v1:0',
		name: 'Amazon Nova Pro',
		providerId: 'bedrock',
		maxContextTokens: 300000,
		maxOutputTokens: 5000,
		supportsStreaming: true,
		supportsTools: true,
		supportsReasoning: false,
		inputPricePerMillion: 0.80,
		outputPricePerMillion: 3.20
	}
];

export function calculateCost(model: IModelDefinition, usage: ITokenUsage): ICostEstimate {
	const inputCost = (usage.promptTokens / 1_000_000) * model.inputPricePerMillion;
	const completionCost = (usage.completionTokens / 1_000_000) * model.outputPricePerMillion;
	return {
		inputCost,
		outputCost: completionCost,
		totalCost: inputCost + completionCost,
		currency: 'USD'
	};
}
