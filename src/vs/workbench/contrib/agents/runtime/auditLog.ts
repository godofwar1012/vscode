/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IAuditEntry {
	readonly id: string;
	readonly timestamp: number;
	readonly agentId: string;
	readonly actionType: 'tool_call' | 'file_edit' | 'terminal_command' | 'permission_prompt' | 'error';
	readonly description: string;
	readonly details?: Record<string, unknown>;
	readonly status: 'pending' | 'success' | 'rejected' | 'failed';
}

export class AuditLog {
	private readonly _entries: IAuditEntry[] = [];

	log(entry: Omit<IAuditEntry, 'id' | 'timestamp'>): IAuditEntry {
		const fullEntry: IAuditEntry = {
			id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
			timestamp: Date.now(),
			...entry
		};
		this._entries.push(fullEntry);
		return fullEntry;
	}

	getEntriesForAgent(agentId: string): readonly IAuditEntry[] {
		return this._entries.filter(e => e.agentId === agentId);
	}

	getAllEntries(): readonly IAuditEntry[] {
		return this._entries;
	}
}
