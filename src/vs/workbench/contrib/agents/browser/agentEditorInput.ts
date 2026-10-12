/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IAgentInstance } from './agentState.js';
import { ParallelAgentManager } from './parallelAgentManager.js';

export class AgentEditorInput extends EditorInput {
	static readonly ID: string = 'workbench.editors.agentEditorInput';

	override get typeId(): string {
		return AgentEditorInput.ID;
	}

	override get resource(): URI {
		return URI.from({ scheme: 'zerri-agent', path: `/${this.agentId}` });
	}

	constructor(
		readonly agentId: string,
		private readonly _agentManager: ParallelAgentManager = ParallelAgentManager.getInstance()
	) {
		super();
		this._register(this._agentManager.onDidChangeAgents(() => {
			this._onDidChangeLabel.fire();
		}));
	}

	get agent(): IAgentInstance | undefined {
		return this._agentManager.getAgent(this.agentId);
	}

	override getName(): string {
		const agent = this.agent;
		return agent ? `Agent: ${agent.name}` : `Agent (${this.agentId})`;
	}

	override getDescription(): string | undefined {
		const agent = this.agent;
		if (!agent) {
			return undefined;
		}
		const statusText = agent.status === 'running' ? 'En cours' : agent.status === 'waiting_user' ? 'En attente' : 'Inactif';
		return `${agent.modelId} • ${statusText}`;
	}

	override getIcon(): ThemeIcon {
		const agent = this.agent;
		if (agent?.status === 'running') {
			return Codicon.loading;
		}
		if (agent?.status === 'waiting_user') {
			return Codicon.bell;
		}
		return Codicon.hubot;
	}

	override matches(other: unknown): boolean {
		if (other instanceof AgentEditorInput) {
			return other.agentId === this.agentId;
		}
		return false;
	}
}
