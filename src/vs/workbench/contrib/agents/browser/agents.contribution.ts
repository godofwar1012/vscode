/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { EditorExtensions } from '../../../common/editor.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { AgentEditorInput } from './agentEditorInput.js';
import { AgentEditorPane } from './agentEditorPane.js';
import { AgentsViewPane } from './agentsViewPane.js';
import { ParallelAgentManager } from './parallelAgentManager.js';

// 1. Enregistrement du View Container dans la barre d'activité
const AGENTS_VIEW_CONTAINER = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: 'workbench.view.zerriAgents',
	title: localize2('zerriAgents', "Agents"),
	icon: Codicon.hubot,
	order: 3,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['workbench.view.zerriAgents', { mergeWithContainerWhenSingleView: true }])
}, ViewContainerLocation.Sidebar);

// 2. Enregistrement de la vue liste des agents
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: AgentsViewPane.ID,
	name: localize2('agentsList', "Agents du Projet"),
	canToggleVisibility: true,
	ctorDescriptor: new SyncDescriptor(AgentsViewPane)
}], AGENTS_VIEW_CONTAINER);

// 3. Enregistrement de l'éditeur d'agent dans les onglets
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		AgentEditorPane,
		AgentEditorPane.ID,
		'Agent Editor'
	),
	[new SyncDescriptor(AgentEditorInput)]
);

// 4. Commandes et Raccourcis
registerAction2(class OpenAgentsSidebarAction extends Action2 {
	constructor() {
		super({
			id: 'zerri.agents.openSidebar',
			title: localize2('openAgentsSidebar', "Zerri: Ouvrir le panneau des agents"),
			menu: {
				id: MenuId.CommandPalette
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const viewsService = accessor.get(IViewsService);
		viewsService.openView(AgentsViewPane.ID, true);
	}
});

registerAction2(class NewAgentTabAction extends Action2 {
	constructor() {
		super({
			id: 'zerri.agents.newAgent',
			title: localize2('newAgentTab', "Zerri: Créer un nouvel agent dans un onglet"),
			menu: {
				id: MenuId.CommandPalette
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const editorService = accessor.get(IEditorService);
		const manager = ParallelAgentManager.getInstance();
		const count = manager.getAllAgents().length + 1;
		const newAgent = manager.createAgent(`Agent #${count}`);
		const input = new AgentEditorInput(newAgent.id, manager);
		editorService.openEditor(input, { pinned: true });
	}
});
