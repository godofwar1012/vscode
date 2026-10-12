/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { BudgetGuard, SecretSanitizer } from '../common/agentSecurity.js';

suite('Contrib Agents - Security & Budgets', () => {
	test('BudgetGuard halts when cost exceeds limit', () => {
		const guard = new BudgetGuard({ maxCostUSD: 1.00 });

		const ok = guard.checkBudget({ tokens: 1000, costUSD: 0.50, steps: 2, elapsedMs: 5000 });
		assert.strictEqual(ok.exceeded, false);

		const exceeded = guard.checkBudget({ tokens: 1000, costUSD: 1.05, steps: 4, elapsedMs: 10000 });
		assert.strictEqual(exceeded.exceeded, true);
		assert.ok(exceeded.reason?.includes('Budget maximal en dollars atteint'));
	});

	test('SecretSanitizer blocks sensitive file paths', () => {
		assert.strictEqual(SecretSanitizer.isFileRestricted('.env'), true);
		assert.strictEqual(SecretSanitizer.isFileRestricted('.env.local'), true);
		assert.strictEqual(SecretSanitizer.isFileRestricted('id_rsa'), true);
		assert.strictEqual(SecretSanitizer.isFileRestricted('server.pem'), true);
		assert.strictEqual(SecretSanitizer.isFileRestricted('app.ts'), false);
	});

	test('SecretSanitizer strips tokens from text', () => {
		const text = 'Bearer token: ghp_123456789012345678901234567890123456';
		const sanitized = SecretSanitizer.sanitizeText(text);
		assert.strictEqual(sanitized.includes('ghp_'), false);
		assert.ok(sanitized.includes('[SECRET_MASQUÉ]'));
	});
});
