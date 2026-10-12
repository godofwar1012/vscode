/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { EditorExtensions } from '../../../common/editor.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { AgentEditorInput } from './agentEditorInput.js';
import { AgentEditorPane } from './agentEditorPane.js';
import {
	AgentKeyService,
	AWS_ACCESS_KEY_SECRET,
	AWS_REGION_SECRET,
	AWS_SECRET_KEY_SECRET,
	GEMINI_API_KEY_SECRET
} from './agentKeyService.js';
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

registerAction2(class SetGeminiApiKeyAction extends Action2 {
	constructor() {
		super({
			id: 'zerri.setGeminiApiKey',
			title: localize2('setGeminiApiKey', "Zerri: Configurer la clé d'API Gemini (Gratuit)"),
			menu: {
				id: MenuId.CommandPalette
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const secretStorage = accessor.get(ISecretStorageService);
		const notificationService = accessor.get(INotificationService);

		const currentKey = (await secretStorage.get(GEMINI_API_KEY_SECRET)) || '';
		const key = await quickInputService.input({
			title: 'Clé API Google Gemini',
			prompt: 'Entrez votre clé API Google Gemini (Obtenez-en une gratuitement sur https://aistudio.google.com/apikey)',
			value: currentKey,
			password: true
		});

		if (key !== undefined) {
			const keyService = new AgentKeyService(secretStorage);
			await keyService.setGeminiKey(key);
			notificationService.info('Clé d\'API Gemini enregistrée avec succès dans Zerri Code.');
		}
	}
});

registerAction2(class SetBedrockCredentialsAction extends Action2 {
	constructor() {
		super({
			id: 'zerri.setBedrockCredentials',
			title: localize2('setBedrockCredentials', "Zerri: Configurer les identifiants AWS Bedrock"),
			menu: {
				id: MenuId.CommandPalette
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const secretStorage = accessor.get(ISecretStorageService);
		const notificationService = accessor.get(INotificationService);

		const currentAccessKey = (await secretStorage.get(AWS_ACCESS_KEY_SECRET)) || '';
		const accessKey = await quickInputService.input({
			title: 'AWS Access Key ID',
			prompt: 'Entrez votre clé d\'accès AWS (ex: AKIA...)',
			value: currentAccessKey
		});

		if (accessKey === undefined) {
			return;
		}

		const currentSecretKey = (await secretStorage.get(AWS_SECRET_KEY_SECRET)) || '';
		const secretKey = await quickInputService.input({
			title: 'AWS Secret Access Key',
			prompt: 'Entrez votre clé d\'accès secrète AWS',
			value: currentSecretKey,
			password: true
		});

		if (secretKey === undefined) {
			return;
		}

		const currentRegion = (await secretStorage.get(AWS_REGION_SECRET)) || 'us-east-1';
		const region = await quickInputService.input({
			title: 'Région AWS',
			prompt: 'Région AWS Bedrock (ex: us-east-1)',
			value: currentRegion
		});

		if (region !== undefined) {
			const keyService = new AgentKeyService(secretStorage);
			await keyService.setBedrockCredentials(accessKey, secretKey, region);
			notificationService.info('Identifiants AWS Bedrock enregistrés avec succès dans Zerri Code.');
		}
	}
});
