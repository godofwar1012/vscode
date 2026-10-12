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
import { DEFAULT_BEDROCK_MODELS, DEFAULT_GEMINI_MODELS } from '../common/agentConfiguration.js';
import { ModelProviderRegistry } from '../providers/providerRegistry.js';
import { AgentLoop } from '../runtime/agentLoop.js';
import { buildAgentSystemPrompt } from '../runtime/agentPromptBuilder.js';
import { LocalContextGatherer } from '../runtime/localContextGatherer.js';
import { MultiAgentSwarmCoordinator, ISpecificationData, ISwarmEvents } from '../runtime/multiAgentCoordinator.js';
import { ProjectContextEngine } from '../runtime/projectContextEngine.js';
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
	private readonly _projectContextEngine: ProjectContextEngine;
	private readonly _localContextGatherer: LocalContextGatherer;

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
		this._projectContextEngine = new ProjectContextEngine(fileService, workspaceService);
		this._localContextGatherer = new LocalContextGatherer(fileService, workspaceService);
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

		// 3. Footer Flottant en Verre Liquide (Frosted Glass style iOS / Telegram Pro)
		const footer = DOM.append(this._container, DOM.$('.zerri-agent-footer'));
		footer.style.position = 'relative';
		footer.style.display = 'flex';
		footer.style.flexDirection = 'column';
		footer.style.gap = '8px';
		footer.style.padding = '12px 14px';
		footer.style.borderRadius = '16px';
		footer.style.background = 'rgba(25, 27, 34, 0.75)';
		footer.style.backdropFilter = 'blur(20px) saturate(180%)';
		(footer.style as any).webkitBackdropFilter = 'blur(20px) saturate(180%)';
		footer.style.border = '1px solid rgba(255, 255, 255, 0.12)';
		footer.style.boxShadow = '0 12px 36px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.12)';

		const controlsRow = DOM.append(footer, DOM.$('.zerri-agent-mode-row'));
		controlsRow.style.display = 'flex';
		controlsRow.style.gap = '6px';
		controlsRow.style.alignItems = 'center';
		controlsRow.innerHTML = `
			<button class="zerri-btn-mode active" data-mode="agent" style="padding:4px 10px; border-radius:20px; background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none; cursor:pointer; font-size:11px; font-weight:500;">Agent</button>
			<button class="zerri-btn-mode" data-mode="ask" style="padding:4px 10px; border-radius:20px; background:rgba(255,255,255,0.06); color:var(--vscode-editor-foreground); border:1px solid rgba(255,255,255,0.08); cursor:pointer; font-size:11px; font-weight:500;">Demander</button>
			<button class="zerri-btn-mode" data-mode="plan" style="padding:4px 10px; border-radius:20px; background:rgba(255,255,255,0.06); color:var(--vscode-editor-foreground); border:1px solid rgba(255,255,255,0.08); cursor:pointer; font-size:11px; font-weight:500;">Plan</button>
			<button class="zerri-btn-spec" style="padding:4px 12px; border-radius:20px; background:rgba(255,255,255,0.08); color:var(--vscode-editor-foreground); border:1px solid rgba(255,255,255,0.12); cursor:pointer; margin-left:auto; display:flex; align-items:center; gap:6px; font-size:11px; font-weight:500; transition:all 0.15s ease;">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
				<span>Cahier des Charges & Options</span>
			</button>
		`;

		const buttons = controlsRow.querySelectorAll<HTMLButtonElement>('.zerri-btn-mode');
		buttons.forEach(btn => {
			btn.addEventListener('click', () => {
				buttons.forEach(b => {
					b.style.background = 'rgba(255,255,255,0.06)';
					b.style.color = 'var(--vscode-editor-foreground)';
				});
				btn.style.background = 'var(--vscode-button-background)';
				btn.style.color = 'var(--vscode-button-foreground)';
				if (this._currentAgent) {
					this._currentAgent.mode = (btn.dataset.mode as any) || 'agent';
				}
			});
		});

		const specBtn = controlsRow.querySelector<HTMLButtonElement>('.zerri-btn-spec');
		specBtn?.addEventListener('click', () => {
			this._openSpecificationModal();
		});

		const inputContainer = DOM.append(footer, DOM.$('.zerri-input-container'));
		inputContainer.style.display = 'flex';
		inputContainer.style.flexDirection = 'column';
		inputContainer.style.gap = '6px';
		inputContainer.style.width = '100%';

		this._inputElement = DOM.append(inputContainer, DOM.$('textarea.zerri-agent-input')) as HTMLTextAreaElement;
		this._inputElement.placeholder = 'Demandez à Zerri : décrivez votre besoin ou collez une erreur... (Ctrl+Entrée)';
		this._inputElement.style.width = '100%';
		this._inputElement.style.minHeight = '56px';
		this._inputElement.style.maxHeight = '180px';
		this._inputElement.style.padding = '4px 0';
		this._inputElement.style.boxSizing = 'border-box';
		this._inputElement.style.background = 'transparent';
		this._inputElement.style.color = 'var(--vscode-editor-foreground)';
		this._inputElement.style.border = 'none';
		this._inputElement.style.outline = 'none';
		this._inputElement.style.resize = 'none';
		this._inputElement.style.fontSize = '13px';
		this._inputElement.style.lineHeight = '1.5';
		this._inputElement.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

		const actionRow = DOM.append(inputContainer, DOM.$('.zerri-action-row'));
		actionRow.style.display = 'flex';
		actionRow.style.justifyContent = 'space-between';
		actionRow.style.alignItems = 'center';
		actionRow.style.paddingTop = '4px';

		const statusChip = DOM.append(actionRow, DOM.$('.zerri-status-chip'));
		statusChip.style.display = 'flex';
		statusChip.style.alignItems = 'center';
		statusChip.style.gap = '6px';
		statusChip.style.fontSize = '11px';
		statusChip.style.opacity = '0.75';
		statusChip.innerHTML = `
			<span style="width:6px; height:6px; border-radius:50%; background:#4ec9b0; box-shadow:0 0 6px #4ec9b0;"></span>
			<span>Noyau Rust & Bedrock Nova Pro</span>
		`;

		this._sendButton = DOM.append(actionRow, DOM.$('button.zerri-send-btn')) as HTMLButtonElement;
		this._sendButton.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
		this._sendButton.title = 'Envoyer (Ctrl+Entrée)';
		this._sendButton.style.width = '34px';
		this._sendButton.style.height = '34px';
		this._sendButton.style.borderRadius = '10px';
		this._sendButton.style.background = 'var(--vscode-button-background)';
		this._sendButton.style.color = 'var(--vscode-button-foreground)';
		this._sendButton.style.border = 'none';
		this._sendButton.style.cursor = 'pointer';
		this._sendButton.style.display = 'flex';
		this._sendButton.style.alignItems = 'center';
		this._sendButton.style.justifyContent = 'center';
		this._sendButton.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
		this._sendButton.style.transition = 'transform 0.1s ease';

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

		this._cts = new CancellationTokenSource();

		// Injection du Prompt Système enrichi au début de la session s'il n'est pas déjà présent
		if (!this._currentAgent.messages.some(m => m.role === 'system')) {
			const rootFolder = this._workspaceService.getWorkspace().folders[0];
			const rootPath = rootFolder ? rootFolder.uri.fsPath : undefined;

			// Scanner l'architecture et les règles du projet
			const topology = await this._projectContextEngine.buildProjectOverview(this._cts.token);
			const topologyPrompt = this._projectContextEngine.formatContextPrompt(topology);

			// Analyse locale ultrarapide (<50ms, <100Mo RAM) sur la création vs complétion partielle
			const localContext = await this._localContextGatherer.gatherContext(text, this._cts.token);
			const localGathererPrompt = this._localContextGatherer.formatGatheredContext(localContext);

			const systemPrompt = buildAgentSystemPrompt({
				workspaceRoot: rootPath,
				projectTopology: topologyPrompt + '\n' + localGathererPrompt,
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

		const bedrockProvider = registry.getProvider('bedrock');

		try {
			// Vérifier si la demande nécessite l'essaim multi-agents (Frontend x2, Backend, Sécurité, Reviewer)
			if (bedrockProvider && this._currentAgent.mode === 'agent') {
				const coordinator = new MultiAgentSwarmCoordinator(
					provider,
					modelDef,
					bedrockProvider,
					DEFAULT_BEDROCK_MODELS,
					(tool, args, tok) => this._toolExecutor.execute(tool, args, tok)
				);

				const evaluation = await coordinator.evaluateTask(text, this._cts.token);
				if (evaluation.needsSwarm && evaluation.plan.length > 0) {
					this._currentAgent.discussions = this._currentAgent.discussions || [];
					const swarmEvents: ISwarmEvents = {
						onTextChunk: () => {
							this._renderAgentContent();
						},
						onActionCardCreated: (card) => {
							this._currentAgent?.actionCards.push(card);
							this._renderAgentContent();
						},
						onActionCardUpdated: () => {
							this._renderAgentContent();
						},
						onAgentDiscussion: (disc) => {
							this._currentAgent?.discussions?.push(disc);
							this._renderAgentContent();
						}
					};

					const swarmRes = await coordinator.runSwarm(
						text,
						evaluation.plan,
						swarmEvents,
						this._cts.token
					);

					this._currentAgent.messages.push({
						role: 'assistant',
						content: swarmRes.finalSummary
					});
					this._currentAgent.status = 'completed';
					this._renderAgentContent();
					return;
				}
			}

			// Sinon : Résolution directe rapide via Gemini
			const loop = new AgentLoop({
				agentId: this._currentAgent.id,
				mode: this._currentAgent.mode,
				provider,
				model: modelDef,
				toolExecutor: (tool, args, tok) => this._toolExecutor.execute(tool, args, tok)
			});

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
				<button id="zerri-btn-stop" style="background:var(--vscode-errorForeground); color:#fff; border:none; border-radius:4px; padding:3px 8px; cursor:pointer; display:flex; align-items:center; gap:4px; font-size:11px;">
					<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
					<span>Arrêter</span>
				</button>
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
			emptyMsg.innerText = 'Prêt. Décrivez votre besoin ou collez une erreur pour lancer l\'agent.';
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
				<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
					<div style="display:flex; align-items:center; gap:6px;">
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
						<strong>${card.toolName}</strong>
					</div>
					<span style="color:${statusColor}; font-weight:600; font-size:11px;">${card.status}</span>
				</div>
				<pre style="margin:0; background:rgba(0,0,0,0.1); padding:4px; border-radius:3px; overflow-x:auto;">${JSON.stringify(card.arguments, null, 2)}</pre>
			`;
		}

		// Échanges Vivants Entre Agents (Peer-to-Peer Inter-Agent Chat)
		if (this._currentAgent.discussions && this._currentAgent.discussions.length > 0) {
			const teamSection = DOM.append(this._bodyElement, DOM.$('.zerri-team-chat-section'));
			teamSection.style.margin = '10px 0';
			teamSection.style.padding = '10px';
			teamSection.style.borderRadius = '6px';
			teamSection.style.background = 'var(--vscode-sideBar-background, rgba(0,0,0,0.15))';
			teamSection.style.border = '1px solid var(--vscode-widget-border)';

			const teamHeader = DOM.append(teamSection, DOM.$('.zerri-team-chat-header'));
			teamHeader.style.display = 'flex';
			teamHeader.style.alignItems = 'center';
			teamHeader.style.gap = '8px';
			teamHeader.style.marginBottom = '8px';
			teamHeader.innerHTML = `
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
				<strong style="font-size:12px; text-transform:uppercase; letter-spacing:0.5px;">Échanges Vivants Entre Agents (Swarm)</strong>
				<span style="font-size:11px; opacity:0.7; margin-left:auto;">${this._currentAgent.discussions.length} messages</span>
			`;

			for (const disc of this._currentAgent.discussions) {
				const msgEl = DOM.append(teamSection, DOM.$('.zerri-interagent-msg'));
				msgEl.style.padding = '8px 10px';
				msgEl.style.borderRadius = '4px';
				msgEl.style.marginBottom = '6px';
				msgEl.style.background = 'var(--vscode-editorWidget-background)';
				msgEl.style.border = '1px solid var(--vscode-widget-border)';
				msgEl.style.fontSize = '12px';

				const roleBadgeColor = disc.role.includes('security') ? 'var(--vscode-errorForeground, #f48771)' :
					disc.role.includes('contract') ? 'var(--vscode-terminal-ansiCyan, #4ec9b0)' :
					disc.role.includes('verdict') ? 'var(--vscode-terminal-ansiGreen, #89d185)' : 'var(--vscode-badge-background)';

				msgEl.innerHTML = `
					<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
						<div style="display:flex; align-items:center; gap:6px;">
							<span style="font-weight:600; color:${roleBadgeColor};">${disc.from}</span>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5;"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
							<span style="font-weight:600;">${disc.to}</span>
						</div>
						<span style="font-size:10px; opacity:0.6;">${new Date(disc.timestamp).toLocaleTimeString()}</span>
					</div>
					<div style="line-height:1.4;">${disc.message}</div>
					${disc.details ? `<pre style="margin-top:6px; padding:6px; background:rgba(0,0,0,0.2); border-radius:3px; font-size:11px; overflow-x:auto;">${disc.details.slice(0, 400)}...</pre>` : ''}
				`;
			}
		}
	}

	private async _openSpecificationModal(): Promise<void> {
		const promptText = this._inputElement.value.trim() || 'Ajouter et structurer la fonctionnalité demandée';

		// Création de l'overlay modal
		const overlay = DOM.append(this._container, DOM.$('.zerri-spec-modal-overlay'));
		overlay.style.position = 'absolute';
		overlay.style.top = '0';
		overlay.style.left = '0';
		overlay.style.width = '100%';
		overlay.style.height = '100%';
		overlay.style.background = 'rgba(0, 0, 0, 0.75)';
		overlay.style.zIndex = '1000';
		overlay.style.display = 'flex';
		overlay.style.alignItems = 'center';
		overlay.style.justifyContent = 'center';
		overlay.style.backdropFilter = 'blur(4px)';

		const modal = DOM.append(overlay, DOM.$('.zerri-spec-modal'));
		modal.style.width = '90%';
		modal.style.maxWidth = '900px';
		modal.style.maxHeight = '90%';
		modal.style.background = 'var(--vscode-editor-background)';
		modal.style.color = 'var(--vscode-editor-foreground)';
		modal.style.borderRadius = '8px';
		modal.style.border = '1px solid var(--vscode-widget-border)';
		modal.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.5)';
		modal.style.display = 'flex';
		modal.style.flexDirection = 'column';
		modal.style.overflow = 'hidden';

		modal.innerHTML = `
			<div style="padding:40px; text-align:center;">
				<div style="margin-bottom:12px; display:flex; justify-content:center;">
					<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4ec9b0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
				</div>
				<h3 style="margin:0 0 8px 0; font-size:15px; font-weight:600;">Gemini Orchestrator génère le Cahier des Charges d'Élite...</h3>
				<p style="opacity:0.8; font-size:12px; margin:0;">Analyse de l'architecture, échafaudage de fichiers, disposition des composants et options d'ingénierie logicielle...</p>
			</div>
		`;

		const registry = ModelProviderRegistry.getInstance();
		const provider = registry.getProvider('gemini') || registry.getAllProviders()[0];
		const modelDef = DEFAULT_GEMINI_MODELS.find(m => m.id === this._currentAgent?.modelId) || DEFAULT_GEMINI_MODELS[0];
		const bedrockProvider = registry.getProvider('bedrock');

		if (!provider) {
			modal.innerHTML = `
				<div style="padding:20px;">
					<h3 style="color:var(--vscode-errorForeground);">Fournisseur Gemini non disponible</h3>
					<p>Veuillez configurer votre clé d'API Gemini.</p>
					<button class="zerri-modal-close" style="padding:6px 12px; background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none; border-radius:3px; cursor:pointer;">Fermer</button>
				</div>
			`;
			modal.querySelector('.zerri-modal-close')?.addEventListener('click', () => overlay.remove());
			return;
		}

		const coordinator = new MultiAgentSwarmCoordinator(
			provider,
			modelDef,
			bedrockProvider,
			DEFAULT_BEDROCK_MODELS,
			(tool, args, tok) => this._toolExecutor.execute(tool, args, tok)
		);

		const cts = new CancellationTokenSource();
		try {
			const spec = await coordinator.generateSpecification(promptText, cts.token);
			this._renderSpecificationModalContent(overlay, modal, spec, promptText);
		} catch (err: unknown) {
			modal.innerHTML = `
				<div style="padding:20px;">
					<h3 style="color:var(--vscode-errorForeground);">Erreur lors de la génération du cahier des charges</h3>
					<p>${err instanceof Error ? err.message : String(err)}</p>
					<button class="zerri-modal-close" style="padding:6px 12px; background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none; border-radius:3px; cursor:pointer;">Fermer</button>
				</div>
			`;
			modal.querySelector('.zerri-modal-close')?.addEventListener('click', () => overlay.remove());
		}
	}

	private _renderSpecificationModalContent(
		overlay: HTMLElement,
		modal: HTMLElement,
		spec: ISpecificationData,
		originalPrompt: string
	): void {
		DOM.clearNode(modal);

		// Header
		const header = DOM.append(modal, DOM.$('.zerri-modal-header'));
		header.style.padding = '16px 20px';
		header.style.borderBottom = '1px solid var(--vscode-widget-border)';
		header.style.display = 'flex';
		header.style.justifyContent = 'space-between';
		header.style.alignItems = 'center';
		header.innerHTML = `
			<div>
				<div style="display:flex; align-items:center; gap:8px;">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
					<h2 style="margin:0; font-size:15px; font-weight:600;">${spec.title}</h2>
					<span style="font-size:11px; padding:2px 8px; border-radius:12px; background:var(--vscode-badge-background); color:var(--vscode-badge-foreground);">Gemini Orchestrator</span>
				</div>
				<p style="margin:4px 0 0 0; font-size:12px; opacity:0.8;">${spec.summary}</p>
			</div>
			<button class="zerri-modal-close-btn" style="background:none; border:none; font-size:18px; color:var(--vscode-editor-foreground); cursor:pointer; padding:4px 8px;">✕</button>
		`;

		header.querySelector('.zerri-modal-close-btn')?.addEventListener('click', () => overlay.remove());

		// Body with scroll
		const body = DOM.append(modal, DOM.$('.zerri-modal-body'));
		body.style.padding = '20px';
		body.style.overflowY = 'auto';
		body.style.flex = '1';
		body.style.display = 'flex';
		body.style.flexDirection = 'column';
		body.style.gap = '20px';

		// Section 1: Échafaudage de fichiers
		const scaffoldSec = DOM.append(body, DOM.$('.zerri-spec-section'));
		scaffoldSec.innerHTML = `
			<div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
				<h4 style="margin:0; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; opacity:0.9;">Échafaudage de Fichiers Cibles</h4>
			</div>
			<div style="display:flex; flex-wrap:wrap; gap:6px;">
				${spec.scaffoldingFiles.map(f => `<span style="font-size:11px; font-family:monospace; padding:3px 8px; border-radius:4px; background:var(--vscode-textCodeBlock-background, rgba(0,0,0,0.2)); border:1px solid var(--vscode-widget-border);">${f}</span>`).join('')}
			</div>
		`;

		// Section 2: Options cochables avec description du flux et transitions au clic
		const optionsSec = DOM.append(body, DOM.$('.zerri-spec-section'));
		optionsSec.innerHTML = `
			<div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
				<h4 style="margin:0; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; opacity:0.9;">Options d'Architecture, UI & Comportement au Clic</h4>
			</div>
			<p style="margin:0 0 12px 0; font-size:12px; opacity:0.75;">Sélectionnez ou désélectionnez les options souhaitées :</p>
			<div class="zerri-options-list" style="display:flex; flex-direction:column; gap:10px;">
				${spec.options.map(opt => `
					<label style="display:flex; gap:10px; align-items:flex-start; padding:10px; border-radius:6px; background:var(--vscode-editorWidget-background); border:1px solid var(--vscode-widget-border); cursor:pointer;">
						<input type="checkbox" class="zerri-opt-checkbox" data-id="${opt.id}" ${opt.checked ? 'checked' : ''} style="margin-top:3px; cursor:pointer;" />
						<div style="flex:1;">
							<div style="display:flex; align-items:center; gap:8px;">
								<strong style="font-size:13px;">${opt.title}</strong>
								<span style="font-size:10px; padding:1px 6px; border-radius:8px; background:var(--vscode-badge-background); color:var(--vscode-badge-foreground);">${opt.category}</span>
							</div>
							<div style="font-size:12px; margin-top:2px; opacity:0.85;">${opt.description}</div>
							<div style="font-size:11px; margin-top:6px; padding:4px 8px; border-radius:4px; background:rgba(0,120,212,0.1); border-left:3px solid var(--vscode-button-background); color:var(--vscode-editor-foreground);">
								<strong style="color:var(--vscode-terminal-ansiCyan, #4ec9b0);">Flux au clic :</strong> ${opt.clickOutcome}
							</div>
						</div>
					</label>
				`).join('')}
			</div>
		`;

		// Section 3: Questions de clarification posées par Gemini
		if (spec.questions.length > 0) {
			const questionsSec = DOM.append(body, DOM.$('.zerri-spec-section'));
			questionsSec.innerHTML = `
				<div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
					<h4 style="margin:0; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; opacity:0.9;">Questions de Précision de Gemini</h4>
				</div>
				<p style="margin:0 0 12px 0; font-size:12px; opacity:0.75;">Gemini a formulé ces questions pour aligner l'équipe à vos préférences exactes :</p>
				<div class="zerri-questions-list" style="display:flex; flex-direction:column; gap:10px;">
					${spec.questions.map(q => `
						<div style="padding:10px; border-radius:6px; background:var(--vscode-editorWidget-background); border:1px solid var(--vscode-widget-border);">
							<div style="font-size:12px; font-weight:bold; margin-bottom:4px;">${q.question}</div>
							<div style="font-size:11px; opacity:0.75; margin-bottom:6px;"><em>Contexte : ${q.context}</em></div>
							<input type="text" class="zerri-question-input" data-id="${q.id}" value="${q.userAnswer}" style="width:100%; box-sizing:border-box; padding:6px 8px; border-radius:4px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border);" />
						</div>
					`).join('')}
				</div>
			`;
		}

		// Section 4: Cahier d'Innovations & Gains Techniques
		const roadmapSec = DOM.append(body, DOM.$('.zerri-spec-section'));
		roadmapSec.innerHTML = `
			<div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/></svg>
				<h4 style="margin:0; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; opacity:0.9;">Cahier d'Idées & Innovations (Gains en Vitesse & Sécurité)</h4>
			</div>
			<div style="padding:12px; border-radius:6px; background:var(--vscode-editorWidget-background); border:1px solid var(--vscode-widget-border); font-size:12px; line-height:1.6; white-space:pre-wrap;">${spec.innovationRoadmap}</div>
		`;

		// Section 5: Exigences & Préférences supplémentaires libres
		const extraSec = DOM.append(body, DOM.$('.zerri-spec-section'));
		extraSec.innerHTML = `
			<div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
				<h4 style="margin:0; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; opacity:0.9;">Préférences ou Instructions Supplémentaires</h4>
			</div>
			<textarea class="zerri-extra-instructions" placeholder="Ajoutez vos précisions particulières, contraintes ou remarques pour l'équipe..." style="width:100%; min-height:60px; box-sizing:border-box; padding:8px; border-radius:4px; background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border);"></textarea>
		`;

		// Footer avec bouton de soumission
		const modalFooter = DOM.append(modal, DOM.$('.zerri-modal-footer'));
		modalFooter.style.padding = '14px 20px';
		modalFooter.style.borderTop = '1px solid var(--vscode-widget-border)';
		modalFooter.style.display = 'flex';
		modalFooter.style.justifyContent = 'flex-end';
		modalFooter.style.gap = '10px';
		modalFooter.innerHTML = `
			<button class="zerri-btn-cancel" style="padding:8px 16px; border-radius:6px; background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); border:none; cursor:pointer;">Annuler</button>
			<button class="zerri-btn-submit-swarm" style="padding:8px 18px; border-radius:6px; background:var(--vscode-button-background); color:var(--vscode-button-foreground); border:none; cursor:pointer; font-weight:600; display:flex; align-items:center; gap:6px;">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
				<span>Valider & Lancer l'Équipe</span>
			</button>
		`;

		modalFooter.querySelector('.zerri-btn-cancel')?.addEventListener('click', () => overlay.remove());
		modalFooter.querySelector('.zerri-btn-submit-swarm')?.addEventListener('click', () => {
			const checkboxes = modal.querySelectorAll<HTMLInputElement>('.zerri-opt-checkbox');
			const selectedOptions = Array.from(checkboxes).filter(cb => cb.checked).map(cb => {
				const id = cb.dataset.id;
				const opt = spec.options.find(o => o.id === id);
				return opt ? `- [x] ${opt.title} (${opt.category}) : ${opt.description}. Au clic : ${opt.clickOutcome}` : '';
			}).filter(Boolean);

			const questionInputs = modal.querySelectorAll<HTMLInputElement>('.zerri-question-input');
			const userAnswers = Array.from(questionInputs).map(inp => {
				const id = inp.dataset.id;
				const q = spec.questions.find(item => item.id === id);
				return q ? `- Q: ${q.question} -> Réponse: ${inp.value.trim()}` : '';
			}).filter(Boolean);

			const extraText = (modal.querySelector<HTMLTextAreaElement>('.zerri-extra-instructions')?.value || '').trim();

			let fullPrompt = `Demande initiale : "${originalPrompt}".\n\n`;
			fullPrompt += `### CAHIER DES CHARGES VALIDÉ PAR L'UTILISATEUR :\n`;
			fullPrompt += `**Titre :** ${spec.title}\n`;
			fullPrompt += `**Fichiers cibles d'échafaudage :**\n${spec.scaffoldingFiles.map(f => `- ${f}`).join('\n')}\n\n`;
			fullPrompt += `**Options et comportements validés :**\n${selectedOptions.join('\n')}\n\n`;
			if (userAnswers.length > 0) {
				fullPrompt += `**Clarifications utilisateur :**\n${userAnswers.join('\n')}\n\n`;
			}
			if (extraText) {
				fullPrompt += `**Notes & Préférences particulières :**\n${extraText}\n\n`;
			}
			fullPrompt += `**Innovations techniques retenues :**\n${spec.innovationRoadmap.slice(0, 500)}`;

			overlay.remove();
			this._inputElement.value = fullPrompt;
			this._handleUserSubmit();
		});
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
