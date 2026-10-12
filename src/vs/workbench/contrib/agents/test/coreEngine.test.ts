/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TabCompletionProvider } from '../browser/tabCompletionProvider.js';
import { IntentRouter } from '../runtime/intentRouter.js';
import { SurgicalPatcher } from '../runtime/surgicalPatcher.js';

suite('Contrib Agents - Core Engine (Intent Router, Surgical Patch, FIM Tab)', () => {
	test('IntentRouter correctly classifies zero-cost local search vs deep reasoning bug', () => {
		const router = new IntentRouter();

		const searchDecision = router.classifyIntent('Où se trouve la classe DatabaseClient ?');
		assert.strictEqual(searchDecision.intent, 'local_file_search');
		assert.strictEqual(searchDecision.recommendedRoute, 'native_rust');
		assert.strictEqual(searchDecision.estimatedCostUSD, 0.0);

		const bugDecision = router.classifyIntent('Corrige l\'erreur et le crash dans le test d\'authentification');
		assert.strictEqual(bugDecision.intent, 'complex_refactor_bug');
		assert.strictEqual(bugDecision.recommendedRoute, 'deep_reasoner');

		const syntaxDecision = router.classifyIntent('Quelle est la syntaxe pour déclarer un type Promise en TS ?');
		assert.strictEqual(syntaxDecision.intent, 'syntax_quick_lookup');
		assert.strictEqual(syntaxDecision.recommendedRoute, 'fast_llm');
	});

	test('SurgicalPatcher parses and applies Aider-style SEARCH/REPLACE blocks', () => {
		const originalCode = [
			'function calculateTotal(items: number[]) {',
			'    let sum = 0;',
			'    for (const item of items) {',
			'        sum += item;',
			'    }',
			'    return sum;',
			'}'
		].join('\n');

		const patch = [
			'<<<<<<< SEARCH',
			'    let sum = 0;',
			'    for (const item of items) {',
			'        sum += item;',
			'    }',
			'    return sum;',
			'=======',
			'    return items.reduce((acc, curr) => acc + curr, 0);',
			'>>>>>>> REPLACE'
		].join('\n');

		const result = SurgicalPatcher.applyPatch(originalCode, patch);
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.appliedBlocksCount, 1);
		assert.ok(result.modifiedContent.includes('return items.reduce((acc, curr) => acc + curr, 0);'));
		assert.ok(!result.modifiedContent.includes('let sum = 0;'));
	});

	test('TabCompletionProvider formats standard Fill-In-The-Middle prompt', () => {
		const prefix = 'function add(a: number, b: number): number {\n    return ';
		const suffix = ';\n}';
		const fimPrompt = TabCompletionProvider.formatFimPrompt(prefix, suffix);

		assert.ok(fimPrompt.includes('<｜fim begin｜>'));
		assert.ok(fimPrompt.includes('<｜fim hole｜>'));
		assert.ok(fimPrompt.includes('<｜fim end｜>'));
		assert.strictEqual(fimPrompt, `<｜fim begin｜>${prefix}<｜fim hole｜>${suffix}<｜fim end｜>`);
	});
});
