/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { calculateCost, DEFAULT_DEEPSEEK_MODELS } from '../common/agentConfiguration.js';
import { DeepSeekProvider } from '../providers/deepseekProvider.js';
import { OpenAiCompatibleProvider } from '../providers/openAiCompatibleProvider.js';
import { ModelProviderRegistry } from '../providers/providerRegistry.js';

suite('Contrib Agents - Providers & Registry', () => {
	test('DeepSeekProvider lists default models', async () => {
		const provider = new DeepSeekProvider({ apiKey: 'test-key' });
		const models = await provider.listModels();
		assert.strictEqual(models.length, 2);
		assert.strictEqual(models[0].id, 'deepseek-chat');
		assert.strictEqual(models[1].id, 'deepseek-reasoner');
	});

	test('Cost calculation is accurate', () => {
		const model = DEFAULT_DEEPSEEK_MODELS[0]; // deepseek-chat
		const usage = { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 };
		const cost = calculateCost(model, usage);

		// 1000 / 1000000 * 0.14 = 0.00014
		// 500 / 1000000 * 0.28 = 0.00014
		// total = 0.00028
		assert.strictEqual(cost.totalCost, 0.00028);
	});

	test('ModelProviderRegistry registers and retrieves providers', async () => {
		const registry = ModelProviderRegistry.getInstance();
		const provider = new OpenAiCompatibleProvider({
			baseUrl: 'http://localhost:11434/v1',
			id: 'ollama-test'
		});

		registry.registerProvider(provider);
		const retrieved = registry.getProvider('ollama-test');
		assert.ok(retrieved);
		assert.strictEqual(retrieved?.id, 'ollama-test');
	});
});
