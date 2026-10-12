/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { IModelDefinition, IModelProvider } from '../common/agentTypes.js';

export interface IInlineEditRequest {
	readonly filePath: string;
	readonly selectedText: string;
	readonly surroundingText: string;
	readonly prompt: string;
}

export class InlineEditController {
	private _widgetElement: HTMLElement | null = null;
	private _inputElement: HTMLInputElement | null = null;
	private _cts: CancellationTokenSource | null = null;

	constructor(
		private readonly _provider: IModelProvider,
		private readonly _model: IModelDefinition,
		private readonly _onApplyEdit: (newText: string) => void
	) { }

	show(parent: HTMLElement, selectedText: string, surroundingText: string, filePath: string): void {
		this.hide();

		this._widgetElement = DOM.append(parent, DOM.$('.zerri-inline-edit-widget'));
		this._widgetElement.style.position = 'absolute';
		this._widgetElement.style.zIndex = '1000';
		this._widgetElement.style.display = 'flex';
		this._widgetElement.style.flexDirection = 'column';
		this._widgetElement.style.padding = '8px 12px';
		this._widgetElement.style.borderRadius = '6px';
		this._widgetElement.style.background = 'var(--vscode-editorWidget-background)';
		this._widgetElement.style.border = '1px solid var(--vscode-editorWidget-border)';
		this._widgetElement.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
		this._widgetElement.style.minWidth = '420px';

		const header = DOM.append(this._widgetElement, DOM.$('.zerri-inline-header'));
		header.style.display = 'flex';
		header.style.justifyContent = 'space-between';
		header.style.fontSize = '11px';
		header.style.marginBottom = '6px';
		header.style.opacity = '0.8';
		header.innerHTML = `
			<span><strong>Ctrl+K</strong> • Zerri Inline Edit</span>
			<span>Entrée : Valider • Échap : Fermer</span>
		`;

		this._inputElement = DOM.append(this._widgetElement, DOM.$('input.zerri-inline-input')) as HTMLInputElement;
		this._inputElement.placeholder = 'Que voulez-vous modifier dans ce bloc de code ?';
		this._inputElement.style.width = '100%';
		this._inputElement.style.padding = '6px 8px';
		this._inputElement.style.boxSizing = 'border-box';
		this._inputElement.style.borderRadius = '4px';
		this._inputElement.style.border = '1px solid var(--vscode-input-border)';
		this._inputElement.style.background = 'var(--vscode-input-background)';
		this._inputElement.style.color = 'var(--vscode-input-foreground)';

		this._inputElement.focus();

		this._inputElement.addEventListener('keydown', async (e) => {
			if (e.key === 'Escape') {
				this.hide();
			} else if (e.key === 'Enter' && !e.shiftKey) {
				const userPrompt = this._inputElement?.value;
				if (userPrompt && userPrompt.trim().length > 0) {
					await this._generateInlineEdit({
						filePath,
						selectedText,
						surroundingText,
						prompt: userPrompt.trim()
					});
				}
			}
		});
	}

	hide(): void {
		if (this._cts) {
			this._cts.cancel();
			this._cts.dispose();
			this._cts = null;
		}
		if (this._widgetElement && this._widgetElement.parentElement) {
			this._widgetElement.parentElement.removeChild(this._widgetElement);
			this._widgetElement = null;
			this._inputElement = null;
		}
	}

	private async _generateInlineEdit(request: IInlineEditRequest): Promise<void> {
		this._cts = new CancellationTokenSource();

		if (this._inputElement) {
			this._inputElement.disabled = true;
			this._inputElement.value = 'Génération de la modification en direct...';
		}

		const promptMessages = [
			{
				role: 'system' as const,
				content: `Tu es un assistant de modification de code inline. Tu reçois un extrait de code sélectionné et une consigne. Renvoie UNIQUEMENT le code de remplacement, sans explications, sans balises markdown markdown.`
			},
			{
				role: 'user' as const,
				content: `Fichier: ${request.filePath}\nCode actuel :\n${request.selectedText}\n\nConsigne de modification : ${request.prompt}`
			}
		];

		let resultText = '';
		try {
			const stream = this._provider.streamChat({
				modelId: this._model.id,
				messages: promptMessages,
				temperature: 0.1
			}, this._cts.token);

			for await (const chunk of stream) {
				if (chunk.type === 'text' && chunk.text) {
					resultText += chunk.text;
				}
			}

			this._onApplyEdit(resultText.trim());
			this.hide();
		} catch {
			if (this._inputElement) {
				this._inputElement.disabled = false;
				this._inputElement.value = 'Erreur lors de la génération. Réessayez.';
			}
		}
	}
}
