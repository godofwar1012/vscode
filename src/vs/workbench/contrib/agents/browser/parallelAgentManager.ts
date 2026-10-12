/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { IAgentInstance } from './agentState.js';

export class ParallelAgentManager {
	private static _instance: ParallelAgentManager;
	private readonly _agents = new Map<string, IAgentInstance>();
	private readonly _activeFileLocks = new Map<string, string>(); // filePath -> agentId

	private readonly _onDidChangeAgents = new Emitter<void>();
	readonly onDidChangeAgents: Event<void> = this._onDidChangeAgents.event;

	private readonly _onDidRequestValidation = new Emitter<{ agent: IAgentInstance; reason: string }>();
	readonly onDidRequestValidation: Event<{ agent: IAgentInstance; reason: string }> = this._onDidRequestValidation.event;

	static getInstance(): ParallelAgentManager {
		if (!ParallelAgentManager._instance) {
			ParallelAgentManager._instance = new ParallelAgentManager();
		}
		return ParallelAgentManager._instance;
	}

	createAgent(name: string, modelId: string = 'deepseek-chat', mode: 'agent' | 'ask' | 'plan' = 'agent'): IAgentInstance {
		const id = `agent-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
		const agent: IAgentInstance = {
			id,
			name,
			modelId,
			mode,
			status: 'idle',
			branch: `agent/${id}`,
			stepCount: 0,
			totalTokens: 0,
			totalCost: 0,
			lastActivity: Date.now(),
			messages: [],
			actionCards: []
		};
		this._agents.set(id, agent);
		this._onDidChangeAgents.fire();
		return agent;
	}

	getAgent(id: string): IAgentInstance | undefined {
		return this._agents.get(id);
	}

	getAllAgents(): readonly IAgentInstance[] {
		return Array.from(this._agents.values());
	}

	renameAgent(id: string, newName: string): void {
		const agent = this._agents.get(id);
		if (agent) {
			agent.name = newName;
			this._onDidChangeAgents.fire();
		}
	}

	duplicateAgent(id: string): IAgentInstance | undefined {
		const source = this._agents.get(id);
		if (!source) {
			return undefined;
		}

		const clone = this.createAgent(`${source.name} (copie)`, source.modelId, source.mode);
		clone.messages = JSON.parse(JSON.stringify(source.messages));
		this._onDidChangeAgents.fire();
		return clone;
	}

	stopAgent(id: string): void {
		const agent = this._agents.get(id);
		if (agent && agent.status === 'running') {
			agent.status = 'idle';
			agent.lastActivity = Date.now();
			this.releaseFilesForAgent(id);
			this._onDidChangeAgents.fire();
		}
	}

	deleteAgent(id: string): void {
		this.releaseFilesForAgent(id);
		this._agents.delete(id);
		this._onDidChangeAgents.fire();
	}

	checkFileCollision(agentId: string, filePath: string): { hasCollision: boolean; conflictingAgentName?: string } {
		const existingHolder = this._activeFileLocks.get(filePath);
		if (existingHolder && existingHolder !== agentId) {
			const other = this._agents.get(existingHolder);
			return {
				hasCollision: true,
				conflictingAgentName: other?.name || existingHolder
			};
		}
		this._activeFileLocks.set(filePath, agentId);
		return { hasCollision: false };
	}

	releaseFilesForAgent(agentId: string): void {
		for (const [file, holder] of this._activeFileLocks.entries()) {
			if (holder === agentId) {
				this._activeFileLocks.delete(file);
			}
		}
	}

	requestUserValidation(agentId: string, reason: string): void {
		const agent = this._agents.get(agentId);
		if (agent) {
			agent.status = 'waiting_user';
			agent.waitingReason = reason;
			this._onDidChangeAgents.fire();
			this._onDidRequestValidation.fire({ agent, reason });
		}
	}
}
