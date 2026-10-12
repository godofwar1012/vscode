/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILlmMessage } from '../common/agentTypes.js';
import { IActionCard } from '../runtime/agentLoop.js';

export type AgentStatus = 'idle' | 'running' | 'waiting_user' | 'completed' | 'error';

export interface IAgentDiscussionItem {
	readonly id: string;
	readonly from: string;
	readonly to: string;
	readonly role: string;
	readonly message: string;
	readonly timestamp: number;
	readonly details?: string;
}

export interface IAgentInstance {
	readonly id: string;
	name: string;
	modelId: string;
	mode: 'agent' | 'ask' | 'plan';
	status: AgentStatus;
	branch?: string;
	worktreePath?: string;
	stepCount: number;
	totalTokens: number;
	totalCost: number;
	lastActivity: number;
	messages: ILlmMessage[];
	actionCards: IActionCard[];
	discussions?: IAgentDiscussionItem[];
	waitingReason?: string;
}

