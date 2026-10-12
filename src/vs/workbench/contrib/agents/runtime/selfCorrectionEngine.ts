/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';

export interface IVerificationCommand {
	readonly command: string;
	readonly description: string;
}

export interface IVerificationResult {
	readonly success: boolean;
	readonly exitCode: number;
	readonly output: string;
}

export class SelfCorrectionEngine {
	private readonly _commands: IVerificationCommand[] = [];

	addVerificationCommand(command: string, description: string = 'Vérification de compilation/tests'): void {
		this._commands.push({ command, description });
	}

	async runVerification(
		commandRunner: (cmd: string, token: CancellationToken) => Promise<IVerificationResult>,
		token: CancellationToken
	): Promise<{ allPassed: boolean; failedOutput?: string; failedCommand?: string }> {
		for (const check of this._commands) {
			if (token.isCancellationRequested) {
				return { allPassed: false, failedOutput: 'Vérification annulée.' };
			}

			try {
				const result = await commandRunner(check.command, token);
				if (!result.success || result.exitCode !== 0) {
					return {
						allPassed: false,
						failedCommand: check.command,
						failedOutput: result.output
					};
				}
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					allPassed: false,
					failedCommand: check.command,
					failedOutput: `Exception lors du test: ${msg}`
				};
			}
		}

		return { allPassed: true };
	}
}
