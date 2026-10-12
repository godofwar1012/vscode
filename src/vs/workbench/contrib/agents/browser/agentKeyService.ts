/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { DEFAULT_GEMINI_MODELS } from '../common/agentConfiguration.js';
import { GeminiProvider } from '../providers/geminiProvider.js';
import { DeepSeekProvider } from '../providers/deepseekProvider.js';
import { BedrockProvider } from '../providers/bedrockProvider.js';
import { ModelProviderRegistry } from '../providers/providerRegistry.js';

export const GEMINI_API_KEY_SECRET = 'zerri.gemini.apiKey';
export const DEEPSEEK_API_KEY_SECRET = 'zerri.deepseek.apiKey';
export const AWS_ACCESS_KEY_SECRET = 'zerri.bedrock.accessKeyId';
export const AWS_SECRET_KEY_SECRET = 'zerri.bedrock.secretAccessKey';
export const AWS_REGION_SECRET = 'zerri.bedrock.region';

export class AgentKeyService {
	constructor(
		@ISecretStorageService private readonly _secretStorageService: ISecretStorageService
	) { }

	async initProviders(): Promise<void> {
		const registry = ModelProviderRegistry.getInstance();

		// 1. Initialiser le fournisseur Google Gemini
		const geminiKey = (await this._secretStorageService.get(GEMINI_API_KEY_SECRET)) || '';
		const geminiProvider = new GeminiProvider({
			apiKey: geminiKey,
			customModels: DEFAULT_GEMINI_MODELS
		});
		registry.registerProvider(geminiProvider);

		// 2. Initialiser le fournisseur DeepSeek
		const deepseekKey = (await this._secretStorageService.get(DEEPSEEK_API_KEY_SECRET)) || '';
		const deepseekProvider = new DeepSeekProvider({
			apiKey: deepseekKey
		});
		registry.registerProvider(deepseekProvider);

		// 3. Initialiser le fournisseur Bedrock
		const awsAccessKey = (await this._secretStorageService.get(AWS_ACCESS_KEY_SECRET)) || '';
		const awsSecretKey = (await this._secretStorageService.get(AWS_SECRET_KEY_SECRET)) || '';
		const awsRegion = (await this._secretStorageService.get(AWS_REGION_SECRET)) || 'us-east-1';
		const bedrockProvider = new BedrockProvider({
			accessKeyId: awsAccessKey,
			secretAccessKey: awsSecretKey,
			region: awsRegion
		});
		registry.registerProvider(bedrockProvider);
	}

	async setGeminiKey(key: string): Promise<void> {
		await this._secretStorageService.set(GEMINI_API_KEY_SECRET, key.trim());
		await this.initProviders();
	}

	async getGeminiKey(): Promise<string | undefined> {
		return await this._secretStorageService.get(GEMINI_API_KEY_SECRET);
	}

	async setDeepSeekKey(key: string): Promise<void> {
		await this._secretStorageService.set(DEEPSEEK_API_KEY_SECRET, key.trim());
		await this.initProviders();
	}

	async setBedrockCredentials(accessKey: string, secretKey: string, region: string = 'us-east-1'): Promise<void> {
		await this._secretStorageService.set(AWS_ACCESS_KEY_SECRET, accessKey.trim());
		await this._secretStorageService.set(AWS_SECRET_KEY_SECRET, secretKey.trim());
		await this._secretStorageService.set(AWS_REGION_SECRET, region.trim());
		await this.initProviders();
	}
}
