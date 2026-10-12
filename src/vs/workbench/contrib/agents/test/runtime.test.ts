/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { DEFAULT_DEEPSEEK_MODELS } from '../common/agentConfiguration.js';
import { IModelProvider, IModelRequest, IModelStreamChunk } from '../common/agentTypes.js';
import { AgentLoop } from '../runtime/agentLoop.js';
import { AuditLog } from '../runtime/auditLog.js';
import { CheckpointManager } from '../runtime/checkpoints.js';
import { PermissionManager } from '../runtime/permissions.js';

class MockProvider implements IModelProvider {
	readonly id = 'mock';
	readonly displayName = 'Mock';
	async listModels() { return [...DEFAULT_DEEPSEEK_MODELS]; }
	async countTokens() { return 10; }
	async testConnection() { return { success: true }; }
	async *streamChat(request: IModelRequest): AsyncIterable<IModelStreamChunk> {
		const lastMsg = request.messages[request.messages.length - 1];
		if (lastMsg.role === 'tool') {
			yield { type: 'text', text: 'Tâche terminée avec succès.' };
			yield { type: 'finish', finishReason: 'stop' };
		} else {
			yield {
				type: 'tool_call',
				toolCall: {
					index: 0,
					id: 'call-1',
					name: 'read_file',
					argumentChunk: JSON.stringify({ path: 'test.txt' })
				}
			};
			yield { type: 'finish', finishReason: 'tool_calls' };
		}
	}
}

suite('Contrib Agents - Runtime & Loop', () => {
	test('CheckpointManager captures and lists snapshots', () => {
		const mgr = new CheckpointManager();
		const cp = mgr.createCheckpoint('cp-1', 'Initial snapshot');
		mgr.recordFileState('cp-1', 'index.ts', 'const a = 1;');

		assert.strictEqual(mgr.listCheckpoints().length, 1);
		assert.strictEqual(cp.snapshots.get('index.ts')?.content, 'const a = 1;');
	});

	test('PermissionManager flags dangerous commands', () => {
		const mgr = new PermissionManager();
		mgr.setPermissionLevel('allow_safe');

		const safeCheck = mgr.evaluateToolCall('read_file', { path: 'file.txt' });
		assert.strictEqual(safeCheck.requiresPrompt, false);

		const dangerousCheck = mgr.evaluateToolCall('run_command', { command: 'git push origin main' });
		assert.strictEqual(dangerousCheck.requiresPrompt, true);
	});

	test('AuditLog records operations', () => {
		const log = new AuditLog();
		const entry = log.log({
			agentId: 'agent-1',
			actionType: 'tool_call',
			description: 'Read file',
			status: 'success'
		});
		assert.strictEqual(log.getAllEntries().length, 1);
		assert.strictEqual(entry.status, 'success');
	});

	test('AgentLoop runs autonomous tool execution step', async () => {
		const provider = new MockProvider();
		const loop = new AgentLoop({
			agentId: 'test-agent',
			mode: 'agent',
			provider,
			model: DEFAULT_DEEPSEEK_MODELS[0],
			toolExecutor: async (name, args) => `Contenu lu de ${String(args.path)}`
		});

		const cts = new CancellationTokenSource();
		const result = await loop.run([{ role: 'user', content: 'Lis le fichier test.txt' }], {}, cts.token);

		assert.ok(result.messages.length >= 3);
		assert.strictEqual(result.messages[result.messages.length - 1].content, 'Tâche terminée avec succès.');
	});
});
