/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ModelProviderRegistry } from '../providers/providerRegistry.js';
import { TabCompletionProvider } from './tabCompletionProvider.js';
import { DEFAULT_GEMINI_MODELS } from '../common/agentConfiguration.js';

export class TabCompletionContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.zerriTabCompletion';

	constructor(
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IConfigurationService configurationService: IConfigurationService
	) {
		super();

		const enabled = configurationService.getValue<boolean>('zerri.tabCompletion.enabled') !== false;
		if (!enabled) {
			return;
		}

		const registry = ModelProviderRegistry.getInstance();
		// Modèle ultra-rapide par défaut pour la complétion : gemini-3.5-flash-lite ou gemini-3.8-flash (palier gratuit)
		const fastModel = DEFAULT_GEMINI_MODELS.find(m => m.id === 'gemini-3.5-flash-lite') || DEFAULT_GEMINI_MODELS[0];
		const geminiProvider = registry.getProvider('gemini');

		if (geminiProvider) {
			const provider = new TabCompletionProvider(geminiProvider, fastModel);
			this._register(
				languageFeaturesService.inlineCompletionsProvider.register(
					{ pattern: '**' },
					provider
				)
			);
		}
	}
}
