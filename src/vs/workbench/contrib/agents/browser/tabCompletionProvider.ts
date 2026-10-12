/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IPosition } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { InlineCompletion, InlineCompletionContext, InlineCompletions, InlineCompletionsProvider } from '../../../../editor/common/languages.js';
import { IModelDefinition, IModelProvider } from '../common/agentTypes.js';

export interface IFimPrompt {
	readonly prefix: string;
	readonly suffix: string;
}

export class TabCompletionProvider implements InlineCompletionsProvider {
	private _lastKeystrokeTime = 0;
	private readonly _debounceMs = 60; // 60ms pour réactivité instantanée sous les 100ms

	constructor(
		private readonly _provider: IModelProvider,
		private readonly _model: IModelDefinition
	) { }

	/**
	 * Formate la requête au format standard Fill-In-The-Middle (FIM) :
	 * Utilisé par DeepSeek-Coder, Qwen2.5-Coder et StarCoder
	 */
	static formatFimPrompt(prefix: string, suffix: string): string {
		return `<｜fim begin｜>${prefix}<｜fim hole｜>${suffix}<｜fim end｜>`;
	}

	async provideInlineCompletions(
		model: ITextModel,
		position: IPosition,
		context: InlineCompletionContext,
		token: CancellationToken
	): Promise<InlineCompletions | undefined> {
		const now = Date.now();
		if (now - this._lastKeystrokeTime < this._debounceMs) {
			return undefined;
		}
		this._lastKeystrokeTime = now;

		// 1. Extraction du préfixe (avant le curseur) et du suffixe (après le curseur)
		const fullText = model.getValue();
		const offset = model.getOffsetAt(position);

		// Fenêtre de contexte locale (2000 caractères avant, 1000 après) pour respecter les <100ms
		const prefix = fullText.substring(Math.max(0, offset - 2000), offset);
		const suffix = fullText.substring(offset, Math.min(fullText.length, offset + 1000));

		if (token.isCancellationRequested) {
			return undefined;
		}

		try {
			const fimFormatted = TabCompletionProvider.formatFimPrompt(prefix, suffix);
			const stream = this._provider.streamChat({
				modelId: this._model.id,
				messages: [
					{
						role: 'user',
						content: fimFormatted
					}
				],
				temperature: 0.0,
				maxTokens: 128 // Prédiction multi-lignes compacte
			}, token);

			let completionText = '';
			for await (const chunk of stream) {
				if (token.isCancellationRequested) {
					return undefined;
				}
				if (chunk.type === 'text' && chunk.text) {
					completionText += chunk.text;
					// Si on a plusieurs lignes complètes, on peut commencer à afficher
					if (completionText.includes('\n\n')) {
						break;
					}
				}
			}

			// Nettoyage des éventuels marqueurs résiduels
			const cleanCompletion = completionText
				.replace(/<｜fim begin｜>|<｜fim hole｜>|<｜fim end｜>/g, '')
				.replace(/^```[a-z]*\r?\n/, '')
				.replace(/\r?\n```$/, '');

			if (!cleanCompletion || cleanCompletion.trim().length === 0) {
				return undefined;
			}

			const insertRange = new Range(position.lineNumber, position.column, position.lineNumber, position.column);
			const item: InlineCompletion = {
				insertText: cleanCompletion,
				range: insertRange
			};

			return {
				items: [item]
			};
		} catch {
			return undefined;
		}
	}

	dispose(): void { }
}
