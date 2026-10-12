/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { AgentEditorInput } from './agentEditorInput.js';
import { IAgentInstance } from './agentState.js';
import { ParallelAgentManager } from './parallelAgentManager.js';

export class AgentEditorPane extends EditorPane {
	static readonly ID: string = 'workbench.editors.agentEditorPane';

	private _container!: HTMLElement;
	private _headerElement!: HTMLElement;
	private _bodyElement!: HTMLElement;
	private _inputElement!: HTMLTextAreaElement;
	private _currentAgent?: IAgentInstance;

	constructor(
		group: any,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		private readonly _agentManager: ParallelAgentManager = ParallelAgentManager.getInstance()
	) {
		super(AgentEditorPane.ID, group, telemetryService, themeService, null as any);
	}

	protected createEditor(parent: HTMLElement): void {
		this._container = DOM.append(parent, DOM.$('.zerri-agent-editor-pane'));
		this._container.style.display = 'flex';
		this._container.style.flexDirection = 'column';
		this._container.style.height = '100%';
		this._container.style.width = '100%';
		this._container.style.padding = '12px';
		this._container.style.boxSizing = 'border-box';
		this._container.style.background = 'var(--vscode-editor-background)';
		this._container.style.color = 'var(--vscode-editor-foreground)';

		// 1. Header (Statut, Modèle, Coûts, Contrôles)
		this._headerElement = DOM.append(this._container, DOM.$('.zerri-agent-header'));
		this._headerElement.style.display = 'flex';
		this._headerElement.style.alignItems = 'center';
		this._headerElement.style.justifyContent = 'space-between';
		this._headerElement.style.borderBottom = '1px solid var(--vscode-widget-border)';
		this._headerElement.style.paddingBottom = '8px';
		this._headerElement.style.marginBottom = '12px';

		// 2. Body (Conversation, Cartes d'action, Diffs)
		this._bodyElement = DOM.append(this._container, DOM.$('.zerri-agent-body'));
		this._bodyElement.style.flex = '1';
		this._bodyElement.style.overflowY = 'auto';
		this._bodyElement.style.marginBottom = '12px';
		this._bodyElement.style.display = 'flex';
		this._bodyElement.style.flexDirection = 'column';
		this._bodyElement.style.gap = '8px';

		// 3. Footer (Sélecteur de mode, zone de saisie, validation)
		const footer = DOM.append(this._container, DOM.$('.zerri-agent-footer'));
		footer.style.display = 'flex';
		footer.style.flexDirection = 'column';
		footer.style.gap = '8px';

		const controlsRow = DOM.append(footer, DOM.$('.zerri-agent-mode-row'));
		controlsRow.style.display = 'flex';
		controlsRow.style.gap = '8px';
		controlsRow.innerHTML = `
			<button class="zerri-btn-mode active" style="padding:4px 8px; border-radius:3px; background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none; cursor:pointer;">Mode Agent</button>
			<button class="zerri-btn-mode" style="padding:4px 8px; border-radius:3px; background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); border:none; cursor:pointer;">Demander</button>
			<button class="zerri-btn-mode" style="padding:4px 8px; border-radius:3px; background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); border:none; cursor:pointer;">Plan</button>
		`;

		this._inputElement = DOM.append(footer, DOM.$('textarea.zerri-agent-input')) as HTMLTextAreaElement;
		this._inputElement.placeholder = 'Posez une question, citez un fichier avec @ ou donnez une consigne de modification...';
		this._inputElement.style.width = '100%';
		this._inputElement.style.minHeight = '70px';
		this._inputElement.style.padding = '8px';
		this._inputElement.style.boxSizing = 'border-box';
		this._inputElement.style.borderRadius = '4px';
		this._inputElement.style.background = 'var(--vscode-input-background)';
		this._inputElement.style.color = 'var(--vscode-input-foreground)';
		this._inputElement.style.border = '1px solid var(--vscode-input-border)';
	}

	override async setInput(input: EditorInput, options: any, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (input instanceof AgentEditorInput) {
			this._currentAgent = input.agent;
			this._renderAgentContent();
		}
	}

	private _renderAgentContent(): void {
		if (!this._currentAgent) {
			return;
		}

		// Rendu du Header
		const costFormatted = `$${this._currentAgent.totalCost.toFixed(5)}`;
		this._headerElement.innerHTML = `
			<div style="display:flex; align-items:center; gap:8px;">
				<strong style="font-size:14px;">${this._currentAgent.name}</strong>
				<span style="font-size:11px; padding:2px 6px; border-radius:10px; background:var(--vscode-badge-background); color:var(--vscode-badge-foreground);">${this._currentAgent.status}</span>
				<span style="font-size:11px; opacity:0.8;">${this._currentAgent.modelId}</span>
			</div>
			<div style="display:flex; align-items:center; gap:12px; font-size:11px;">
				<span>Tokens: ${this._currentAgent.totalTokens}</span>
				<span>Coût: ${costFormatted}</span>
				<span>Étape: ${this._currentAgent.stepCount}</span>
				<button id="zerri-btn-stop" style="background:var(--vscode-errorForeground); color:#fff; border:none; border-radius:3px; padding:2px 6px; cursor:pointer;">Arrêter</button>
			</div>
		`;

		const stopBtn = this._headerElement.querySelector('#zerri-btn-stop');
		stopBtn?.addEventListener('click', () => {
			if (this._currentAgent) {
				this._agentManager.stopAgent(this._currentAgent.id);
			}
		});

		// Rendu du Corps (Messages & Cartes d'action)
		DOM.clearNode(this._bodyElement);

		if (this._currentAgent.messages.length === 0) {
			const emptyMsg = DOM.append(this._bodyElement, DOM.$('.zerri-empty-state'));
			emptyMsg.style.textAlign = 'center';
			emptyMsg.style.marginTop = '40px';
			emptyMsg.style.opacity = '0.6';
			emptyMsg.innerText = 'Aucune action en cours. Entrez une consigne pour démarrer l\'agent.';
			return;
		}

		for (const msg of this._currentAgent.messages) {
			const bubble = DOM.append(this._bodyElement, DOM.$(`.zerri-bubble-${msg.role}`));
			bubble.style.padding = '8px 12px';
			bubble.style.borderRadius = '6px';
			bubble.style.maxWidth = '85%';
			bubble.style.whiteSpace = 'pre-wrap';

			if (msg.role === 'user') {
				bubble.style.alignSelf = 'flex-end';
				bubble.style.background = 'var(--vscode-button-background)';
				bubble.style.color = 'var(--vscode-button-foreground)';
				bubble.innerText = msg.content;
			} else if (msg.role === 'assistant') {
				bubble.style.alignSelf = 'flex-start';
				bubble.style.background = 'var(--vscode-editorWidget-background)';
				bubble.style.border = '1px solid var(--vscode-widget-border)';
				bubble.innerText = msg.content;
			}
		}

		// Cartes d'action en direct
		for (const card of this._currentAgent.actionCards) {
			const cardEl = DOM.append(this._bodyElement, DOM.$('.zerri-action-card'));
			cardEl.style.padding = '8px';
			cardEl.style.borderRadius = '4px';
			cardEl.style.border = '1px solid var(--vscode-widget-border)';
			cardEl.style.background = 'var(--vscode-editorWidget-background)';
			cardEl.style.fontSize = '12px';

			const statusColor = card.status === 'completed' ? 'green' : card.status === 'running' ? 'orange' : card.status === 'failed' ? 'red' : 'gray';
			cardEl.innerHTML = `
				<div style="display:flex; justify-content:space-between; margin-bottom:4px;">
					<strong>🔧 Outil : ${card.toolName}</strong>
					<span style="color:${statusColor}; font-weight:bold;">${card.status}</span>
				</div>
				<pre style="margin:0; background:rgba(0,0,0,0.1); padding:4px; border-radius:3px; overflow-x:auto;">${JSON.stringify(card.arguments, null, 2)}</pre>
			`;
		}
	}

	layout(dimension: DOM.Dimension): void {
		if (this._container) {
			this._container.style.height = `${dimension.height}px`;
			this._container.style.width = `${dimension.width}px`;
		}
	}
}
