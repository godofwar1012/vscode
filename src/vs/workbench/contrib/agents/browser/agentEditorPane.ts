/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { DEFAULT_GEMINI_MODELS } from '../common/agentConfiguration.js';
import { ModelProviderRegistry } from '../providers/providerRegistry.js';
import { AgentLoop } from '../runtime/agentLoop.js';
import { buildAgentSystemPrompt } from '../runtime/agentPromptBuilder.js';
import { RealToolExecutor } from '../runtime/realToolExecutor.js';
import { AgentEditorInput } from './agentEditorInput.js';
import { IAgentInstance } from './agentState.js';
import { ParallelAgentManager } from './parallelAgentManager.js';

export class AgentEditorPane extends EditorPane {
	static readonly ID: string = 'workbench.editors.agentEditorPane';

	private _container!: HTMLElement;
	private _headerElement!: HTMLElement;
	private _bodyElement!: HTMLElement;
	private _inputElement!: HTMLTextAreaElement;
	private _sendButton!: HTMLButtonElement;
	private _currentAgent?: IAgentInstance;
	private _cts: CancellationTokenSource | null = null;
	private readonly _agentManager: ParallelAgentManager = ParallelAgentManager.getInstance();
	private readonly _workspaceService: IWorkspaceContextService;
	private readonly _toolExecutor: RealToolExecutor;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IFileService fileService: IFileService,
		@IWorkspaceContextService workspaceService: IWorkspaceContextService
	) {
		super(AgentEditorPane.ID, group, telemetryService, themeService, storageService);
		this._workspaceService = workspaceService;
		this._toolExecutor = new RealToolExecutor({
			fileService,
			workspaceService
		});
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
		controlsRow.style.alignItems = 'center';
		controlsRow.innerHTML = `
			<button class="zerri-btn-mode active" data-mode="agent" style="padding:4px 8px; border-radius:3px; background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none; cursor:pointer;">Mode Agent</button>
			<button class="zerri-btn-mode" data-mode="ask" style="padding:4px 8px; border-radius:3px; background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); border:none; cursor:pointer;">Demander</button>
			<button class="zerri-btn-mode" data-mode="plan" style="padding:4px 8px; border-radius:3px; background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); border:none; cursor:pointer;">Plan</button>
		`;

		const buttons = controlsRow.querySelectorAll<HTMLButtonElement>('.zerri-btn-mode');
		buttons.forEach(btn => {
			btn.addEventListener('click', () => {
				buttons.forEach(b => {
					b.style.background = 'var(--vscode-button-secondaryBackground)';
					b.style.color = 'var(--vscode-button-secondaryForeground)';
				});
				btn.style.background = 'var(--vscode-button-background)';
				btn.style.color = 'var(--vscode-button-foreground)';
				if (this._currentAgent) {
					this._currentAgent.mode = (btn.dataset.mode as any) || 'agent';
				}
			});
		});

		const inputContainer = DOM.append(footer, DOM.$('.zerri-input-container'));
		inputContainer.style.display = 'flex';
		inputContainer.style.gap = '8px';
		inputContainer.style.alignItems = 'flex-end';

		this._inputElement = DOM.append(inputContainer, DOM.$('textarea.zerri-agent-input')) as HTMLTextAreaElement;
		this._inputElement.placeholder = 'Demandez à Zerri : écrivez une consigne ou posez une question (Ctrl+Entrée pour envoyer)...';
		this._inputElement.style.flex = '1';
		this._inputElement.style.minHeight = '70px';
		this._inputElement.style.padding = '8px';
		this._inputElement.style.boxSizing = 'border-box';
		this._inputElement.style.borderRadius = '4px';
		this._inputElement.style.background = 'var(--vscode-input-background)';
		this._inputElement.style.color = 'var(--vscode-input-foreground)';
		this._inputElement.style.border = '1px solid var(--vscode-input-border)';

		this._sendButton = DOM.append(inputContainer, DOM.$('button.zerri-send-btn')) as HTMLButtonElement;
		this._sendButton.innerText = 'Envoyer';
		this._sendButton.style.padding = '8px 16px';
		this._sendButton.style.height = '40px';
		this._sendButton.style.borderRadius = '4px';
		this._sendButton.style.background = 'var(--vscode-button-background)';
		this._sendButton.style.color = 'var(--vscode-button-foreground)';
		this._sendButton.style.border = 'none';
		this._sendButton.style.cursor = 'pointer';

		this._sendButton.addEventListener('click', () => this._handleUserSubmit());
		this._inputElement.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				this._handleUserSubmit();
			}
		});
	}

	private async _handleUserSubmit(): Promise<void> {
		const text = this._inputElement.value.trim();
		if (!text || !this._currentAgent || this._currentAgent.status === 'running') {
			return;
		}

		this._inputElement.value = '';

		// Injection du Prompt Système au début de la session s'il n'est pas déjà présent
		if (!this._currentAgent.messages.some(m => m.role === 'system')) {
			const rootFolder = this._workspaceService.getWorkspace().folders[0];
			const rootPath = rootFolder ? rootFolder.uri.fsPath : undefined;
			const systemPrompt = buildAgentSystemPrompt({
				workspaceRoot: rootPath,
				mode: this._currentAgent.mode
			});
			this._currentAgent.messages.unshift({
				role: 'system',
				content: systemPrompt
			});
		}

		this._currentAgent.messages.push({
			role: 'user',
			content: text
		});
		this._currentAgent.status = 'running';
		this._renderAgentContent();

		this._cts = new CancellationTokenSource();

		const registry = ModelProviderRegistry.getInstance();
		const provider = registry.getProvider('gemini') || (await registry.getProviderForModel(this._currentAgent.modelId)) || registry.getAllProviders()[0];
		const modelDef = DEFAULT_GEMINI_MODELS.find(m => m.id === this._currentAgent?.modelId) || DEFAULT_GEMINI_MODELS[0];

		if (!provider) {
			this._currentAgent.status = 'error';
			this._currentAgent.messages.push({
				role: 'assistant',
				content: 'Erreur : aucun fournisseur d\'IA configuré. Configurez votre clé d\'API Gemini via la palette de commandes ("Zerri: Configurer la clé API Gemini").'
			});
			this._renderAgentContent();
			return;
		}

		const loop = new AgentLoop({
			agentId: this._currentAgent.id,
			mode: this._currentAgent.mode,
			provider,
			model: modelDef,
			toolExecutor: (tool, args, tok) => this._toolExecutor.execute(tool, args, tok)
		});

		try {
			const res = await loop.run(
				this._currentAgent.messages,
				{
					onTextChunk: () => {
						// Mise à jour fluide du rendu
					},
					onActionCardCreated: (card) => {
						this._currentAgent?.actionCards.push(card);
						this._renderAgentContent();
					},
					onActionCardUpdated: () => {
						this._renderAgentContent();
					},
					onStepCompleted: (step, usage, cost) => {
						if (this._currentAgent) {
							this._currentAgent.stepCount = step;
							this._currentAgent.totalTokens = usage.totalTokens;
							this._currentAgent.totalCost = cost.totalCost;
							this._renderAgentContent();
						}
					}
				},
				this._cts.token
			);

			this._currentAgent.messages = [...res.messages];
			this._currentAgent.status = 'completed';
		} catch (err: unknown) {
			this._currentAgent.status = 'error';
			this._currentAgent.messages.push({
				role: 'assistant',
				content: `Erreur d'exécution de l'agent : ${err instanceof Error ? err.message : String(err)}`
			});
		} finally {
			this._renderAgentContent();
		}
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
			if (this._cts) {
				this._cts.cancel();
			}
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

	override dispose(): void {
		if (this._cts) {
			this._cts.cancel();
			this._cts.dispose();
		}
		super.dispose();
	}
}
