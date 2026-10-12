/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IModelDefinition, IModelProvider } from '../common/agentTypes.js';

export class ModelProviderRegistry {
	private static _instance: ModelProviderRegistry;
	private readonly _providers = new Map<string, IModelProvider>();

	static getInstance(): ModelProviderRegistry {
		if (!ModelProviderRegistry._instance) {
			ModelProviderRegistry._instance = new ModelProviderRegistry();
		}
		return ModelProviderRegistry._instance;
	}

	registerProvider(provider: IModelProvider): void {
		this._providers.set(provider.id, provider);
	}

	getProvider(providerId: string): IModelProvider | undefined {
		return this._providers.get(providerId);
	}

	getAllProviders(): IModelProvider[] {
		return Array.from(this._providers.values());
	}

	async getAllModels(): Promise<IModelDefinition[]> {
		const models: IModelDefinition[] = [];
		for (const provider of this._providers.values()) {
			try {
				const list = await provider.listModels();
				models.push(...list);
			} catch {
				// Continue sur les autres fournisseurs en cas d'erreur isolée
			}
		}
		return models;
	}

	async getProviderForModel(modelId: string): Promise<IModelProvider | undefined> {
		for (const provider of this._providers.values()) {
			try {
				const models = await provider.listModels();
				if (models.some(m => m.id === modelId)) {
					return provider;
				}
			} catch {
				// Continue
			}
		}
		return undefined;
	}
}
