/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { AgentEditorInput } from '../browser/agentEditorInput.js';
import { ParallelAgentManager } from '../browser/parallelAgentManager.js';

suite('Contrib Agents - UI & Multi-Agent Manager', () => {
	test('ParallelAgentManager creates and manages agent instances', () => {
		const manager = ParallelAgentManager.getInstance();
		const agent1 = manager.createAgent('Agent Test Alpha', 'deepseek-chat', 'agent');

		assert.ok(agent1.id);
		assert.strictEqual(agent1.name, 'Agent Test Alpha');
		assert.strictEqual(agent1.status, 'idle');
		assert.strictEqual(agent1.branch, `agent/${agent1.id}`);

		// Renommer
		manager.renameAgent(agent1.id, 'Agent Alpha Renommé');
		assert.strictEqual(manager.getAgent(agent1.id)?.name, 'Agent Alpha Renommé');

		// Dupliquer
		const clone = manager.duplicateAgent(agent1.id);
		assert.ok(clone);
		assert.strictEqual(clone?.name, 'Agent Alpha Renommé (copie)');

		// Arrêter
		agent1.status = 'running';
		manager.stopAgent(agent1.id);
		assert.strictEqual(agent1.status, 'idle');
	});

	test('ParallelAgentManager detects file collisions between parallel agents', () => {
		const manager = ParallelAgentManager.getInstance();
		const agentA = manager.createAgent('Agent A');
		const agentB = manager.createAgent('Agent B');

		const check1 = manager.checkFileCollision(agentA.id, 'src/main.ts');
		assert.strictEqual(check1.hasCollision, false);

		// Collision détectée si agentB tente d'accéder au même fichier en cours
		const check2 = manager.checkFileCollision(agentB.id, 'src/main.ts');
		assert.strictEqual(check2.hasCollision, true);
		assert.strictEqual(check2.conflictingAgentName, 'Agent A');

		// Libération après arrêt
		manager.releaseFilesForAgent(agentA.id);
		const check3 = manager.checkFileCollision(agentB.id, 'src/main.ts');
		assert.strictEqual(check3.hasCollision, false);
	});

	test('AgentEditorInput maps to correct resource and titles', () => {
		const manager = ParallelAgentManager.getInstance();
		const agent = manager.createAgent('Editor Agent');
		const input = new AgentEditorInput(agent.id, manager);

		assert.strictEqual(input.getName(), 'Agent: Editor Agent');
		assert.strictEqual(input.resource.scheme, 'zerri-agent');
		assert.strictEqual(input.resource.path, `/${agent.id}`);
		assert.strictEqual(input.typeId, AgentEditorInput.ID);
	});
});
