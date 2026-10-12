/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IModelDefinition, IModelProvider, IModelRequest } from '../common/agentTypes.js';

export class DuoModelOrchestrator {
	constructor(
		private readonly _fastProvider: IModelProvider,
		private readonly _fastModel: IModelDefinition,
		private readonly _deepReasoningProvider: IModelProvider,
		private readonly _deepReasoningModel: IModelDefinition
	) { }

	/**
	 * Décide dynamiquement quel modèle utiliser selon la complexité de l'étape :
	 * - Recherche / Outils simples : Modèle rapide (DeepSeek-V3)
	 * - Erreur de compilation / Planification / Raisonnement complexe : Modèle de pensée (DeepSeek-R1)
	 */
	selectModelForStep(isComplexProblem: boolean, hasPreviousFailure: boolean): {
		provider: IModelProvider;
		model: IModelDefinition;
		strategy: 'fast_executor' | 'deep_reasoner';
	} {
		if (isComplexProblem || hasPreviousFailure) {
			return {
				provider: this._deepReasoningProvider,
				model: this._deepReasoningModel,
				strategy: 'deep_reasoner'
			};
		}

		return {
			provider: this._fastProvider,
			model: this._fastModel,
			strategy: 'fast_executor'
		};
	}

	async synthesizePlan(task: string, codebaseContext: string, token: CancellationToken): Promise<string> {
		const request: IModelRequest = {
			modelId: this._deepReasoningModel.id,
			messages: [
				{
					role: 'system',
					content: 'Tu es un architecte logiciel d\'élite. Élabore un plan rigoureux, sans faille, étape par étape pour accomplir la tâche.'
				},
				{
					role: 'user',
					content: `Contexte du projet :\n${codebaseContext}\n\nTâche à résoudre :\n${task}`
				}
			],
			temperature: 0.1
		};

		let plan = '';
		const stream = this._deepReasoningProvider.streamChat(request, token);
		for await (const chunk of stream) {
			if (chunk.type === 'text' && chunk.text) {
				plan += chunk.text;
			}
		}

		return plan;
	}
}
