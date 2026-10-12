/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { AgentEditorInput } from './agentEditorInput.js';
import { ParallelAgentManager } from './parallelAgentManager.js';

export class AgentsViewPane extends ViewPane {
	static readonly ID = 'workbench.views.agentsList';

	private _listContainer!: HTMLElement;
	private readonly _agentManager: ParallelAgentManager = ParallelAgentManager.getInstance();

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IEditorService private readonly _editorService: IEditorService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		this._register(this._agentManager.onDidChangeAgents(() => {
			this._renderList();
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		const headerBar = DOM.append(container, DOM.$('.zerri-agents-sidebar-header'));
		headerBar.style.display = 'flex';
		headerBar.style.justifyContent = 'space-between';
		headerBar.style.alignItems = 'center';
		headerBar.style.padding = '8px 12px';
		headerBar.style.borderBottom = '1px solid var(--vscode-widget-border)';

		const title = DOM.append(headerBar, DOM.$('strong'));
		title.innerText = 'Agents Actifs';

		const newBtn = DOM.append(headerBar, DOM.$('button.zerri-btn-new-agent'));
		newBtn.innerText = '+ Nouvel Agent';
		newBtn.style.padding = '3px 8px';
		newBtn.style.background = 'var(--vscode-button-background)';
		newBtn.style.color = 'var(--vscode-button-foreground)';
		newBtn.style.border = 'none';
		newBtn.style.borderRadius = '3px';
		newBtn.style.cursor = 'pointer';

		newBtn.addEventListener('click', () => {
			const count = this._agentManager.getAllAgents().length + 1;
			const newAgent = this._agentManager.createAgent(`Agent #${count}`);
			this._openAgentInTab(newAgent.id);
		});

		this._listContainer = DOM.append(container, DOM.$('.zerri-agents-sidebar-list'));
		this._listContainer.style.padding = '8px';
		this._listContainer.style.display = 'flex';
		this._listContainer.style.flexDirection = 'column';
		this._listContainer.style.gap = '6px';

		this._renderList();
	}

	private _renderList(): void {
		if (!this._listContainer) {
			return;
		}

		DOM.clearNode(this._listContainer);
		const agents = this._agentManager.getAllAgents();

		if (agents.length === 0) {
			const emptyMsg = DOM.append(this._listContainer, DOM.$('div'));
			emptyMsg.style.padding = '12px';
			emptyMsg.style.textAlign = 'center';
			emptyMsg.style.opacity = '0.6';
			emptyMsg.innerText = 'Aucun agent configuré. Cliquez sur "+ Nouvel Agent" pour commencer.';
			return;
		}

		for (const agent of agents) {
			const item = DOM.append(this._listContainer, DOM.$('.zerri-agent-item'));
			item.style.padding = '8px';
			item.style.borderRadius = '4px';
			item.style.border = '1px solid var(--vscode-widget-border)';
			item.style.background = 'var(--vscode-sideBar-background)';
			item.style.display = 'flex';
			item.style.flexDirection = 'column';
			item.style.gap = '4px';
			item.style.cursor = 'pointer';

			const statusBadge = agent.status === 'running' ? '🟡 En cours'
				: agent.status === 'waiting_user' ? '🔔 Attente'
				: agent.status === 'completed' ? '🟢 Terminé'
				: '⚪ Inactif';

			item.innerHTML = `
				<div style="display:flex; justify-content:space-between; align-items:center;">
					<strong>${agent.name}</strong>
					<span style="font-size:10px;">${statusBadge}</span>
				</div>
				<div style="font-size:11px; opacity:0.8; display:flex; justify-content:space-between;">
					<span>${agent.modelId}</span>
					<span>$${agent.totalCost.toFixed(4)}</span>
				</div>
			`;

			item.addEventListener('click', () => {
				this._openAgentInTab(agent.id);
			});
		}
	}

	private _openAgentInTab(agentId: string): void {
		const input = new AgentEditorInput(agentId, this._agentManager);
		this._editorService.openEditor(input, { pinned: true });
	}
}
