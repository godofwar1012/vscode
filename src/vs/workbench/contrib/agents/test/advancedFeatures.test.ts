/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { DEFAULT_DEEPSEEK_MODELS } from '../common/agentConfiguration.js';
import { CodebaseIndexer } from '../runtime/codebaseIndexer.js';
import { ProjectRulesLoader } from '../runtime/projectRulesLoader.js';
import { SelfCorrectionEngine } from '../runtime/selfCorrectionEngine.js';
import { DuoModelOrchestrator } from '../runtime/speculativeReasoner.js';

suite('Contrib Agents - Advanced Cursor-Grade Features', () => {
	test('ProjectRulesLoader reads AGENTS.md and creates prompt section', async () => {
		const loader = new ProjectRulesLoader(async (path) => {
			if (path === 'AGENTS.md') {
				return '# Règles de codage : utiliser TypeScript strict';
			}
			return null;
		});

		const rules = await loader.loadRules();
		assert.strictEqual(rules.length, 1);
		assert.strictEqual(rules[0].source, 'AGENTS.md');

		const formatted = loader.formatRulesPrompt(rules);
		assert.ok(formatted.includes('Règles de codage'));
	});

	test('CodebaseIndexer indexes chunks and performs BM25 retrieval', () => {
		const indexer = new CodebaseIndexer();
		indexer.indexFile('src/auth.ts', 'export class Authenticator { login() { return true; } }');
		indexer.indexFile('src/database.ts', 'export class DatabaseClient { connect() { return true; } }');

		assert.ok(indexer.getChunkCount() >= 2);

		const searchAuth = indexer.search('Authenticator login');
		assert.ok(searchAuth.length > 0);
		assert.strictEqual(searchAuth[0].chunk.filePath, 'src/auth.ts');
	});

	test('SelfCorrectionEngine detects failing check', async () => {
		const engine = new SelfCorrectionEngine();
		engine.addVerificationCommand('npm test');

		const cts = new CancellationTokenSource();
		const result = await engine.runVerification(async (cmd) => {
			return { success: false, exitCode: 1, output: 'AssertionError: test failed' };
		}, cts.token);

		assert.strictEqual(result.allPassed, false);
		assert.ok(result.failedOutput?.includes('AssertionError'));
	});

	test('DuoModelOrchestrator shifts to deep reasoner on errors', () => {
		const dummyProvider: any = {};
		const orchestrator = new DuoModelOrchestrator(
			dummyProvider,
			DEFAULT_DEEPSEEK_MODELS[0], // deepseek-chat (fast)
			dummyProvider,
			DEFAULT_DEEPSEEK_MODELS[1]  // deepseek-reasoner (R1)
		);

		const normal = orchestrator.selectModelForStep(false, false);
		assert.strictEqual(normal.strategy, 'fast_executor');

		const afterFailure = orchestrator.selectModelForStep(false, true);
		assert.strictEqual(afterFailure.strategy, 'deep_reasoner');
	});
});
