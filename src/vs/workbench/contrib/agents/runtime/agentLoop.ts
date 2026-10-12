/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { calculateCost } from '../common/agentConfiguration.js';
import {
	ICostEstimate,
	ILlmMessage,
	IModelDefinition,
	IModelProvider,
	ITokenUsage
} from '../common/agentTypes.js';
import { STANDARD_AGENT_TOOLS } from './agentTools.js';
import { AuditLog } from './auditLog.js';
import { CheckpointManager } from './checkpoints.js';
import { PermissionManager } from './permissions.js';

export type AgentMode = 'agent' | 'ask' | 'plan';

export interface IActionCard {
	readonly id: string;
	readonly step: number;
	readonly toolName: string;
	readonly arguments: Record<string, unknown>;
	status: 'pending' | 'running' | 'completed' | 'failed' | 'requires_permission';
	result?: string;
	error?: string;
}

export interface IAgentLoopEvents {
	readonly onTextChunk?: (text: string) => void;
	readonly onReasoningChunk?: (reasoning: string) => void;
	readonly onActionCardCreated?: (card: IActionCard) => void;
	readonly onActionCardUpdated?: (card: IActionCard) => void;
	readonly onStepCompleted?: (step: number, usage: ITokenUsage, cost: ICostEstimate) => void;
	readonly onPermissionRequested?: (card: IActionCard, reason: string) => Promise<boolean>;
}

export interface IAgentLoopConfig {
	readonly agentId: string;
	readonly mode: AgentMode;
	readonly maxSteps?: number;
	readonly provider: IModelProvider;
	readonly model: IModelDefinition;
	readonly permissionManager?: PermissionManager;
	readonly checkpointManager?: CheckpointManager;
	readonly auditLog?: AuditLog;
	readonly toolExecutor: (toolName: string, args: Record<string, unknown>, token: CancellationToken) => Promise<string>;
}

export class AgentLoop {
	private readonly _agentId: string;
	private readonly _mode: AgentMode;
	private readonly _maxSteps: number;
	private readonly _provider: IModelProvider;
	private readonly _model: IModelDefinition;
	private readonly _permissionManager: PermissionManager;
	private readonly _checkpointManager: CheckpointManager;
	private readonly _auditLog: AuditLog;
	private readonly _toolExecutor: (name: string, args: Record<string, unknown>, token: CancellationToken) => Promise<string>;

	private _totalUsage: ITokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
	private _actionHistory: string[] = [];

	constructor(config: IAgentLoopConfig) {
		this._agentId = config.agentId;
		this._mode = config.mode;
		this._maxSteps = config.maxSteps || 25;
		this._provider = config.provider;
		this._model = config.model;
		this._permissionManager = config.permissionManager || new PermissionManager();
		this._checkpointManager = config.checkpointManager || new CheckpointManager();
		this._auditLog = config.auditLog || new AuditLog();
		this._toolExecutor = config.toolExecutor;
	}

	async run(initialMessages: ILlmMessage[], events: IAgentLoopEvents, token: CancellationToken): Promise<{
		messages: ILlmMessage[];
		totalUsage: ITokenUsage;
		totalCost: ICostEstimate;
	}> {
		const messages: ILlmMessage[] = [...initialMessages];
		let step = 0;

		// En mode "ask", aucun outil de modification n'est transmis au modèle
		const availableTools = this._mode === 'ask'
			? STANDARD_AGENT_TOOLS.filter(t => t.function.name === 'read_file' || t.function.name === 'list_dir')
			: STANDARD_AGENT_TOOLS;

		// Création d'un point de restauration initial si mode Agent
		if (this._mode === 'agent') {
			this._checkpointManager.createCheckpoint(`cp-start-${this._agentId}`, `Début de session de l'agent ${this._agentId}`);
		}

		while (step < this._maxSteps && !token.isCancellationRequested) {
			step++;

			let assistantText = '';
			let reasoningText = '';
			const toolCallsMap = new Map<number, { id: string; name: string; args: string; thoughtSignature?: string }>();

			const stream = this._provider.streamChat({
				modelId: this._model.id,
				messages,
				tools: availableTools,
				temperature: this._mode === 'plan' ? 0.2 : 0.4
			}, token);

			for await (const chunk of stream) {
				if (token.isCancellationRequested) {
					break;
				}

				if (chunk.type === 'text' && chunk.text) {
					assistantText += chunk.text;
					events.onTextChunk?.(chunk.text);
				} else if (chunk.type === 'reasoning' && chunk.reasoning) {
					reasoningText += chunk.reasoning;
					events.onReasoningChunk?.(chunk.reasoning);
				} else if (chunk.type === 'tool_call' && chunk.toolCall) {
					const idx = chunk.toolCall.index ?? toolCallsMap.size;
					const current = toolCallsMap.get(idx) || { id: chunk.toolCall.id || `call-${idx}`, name: '', args: '' };
					if (chunk.toolCall.id) {
						current.id = chunk.toolCall.id;
					}
					if (chunk.toolCall.name) {
						current.name = chunk.toolCall.name;
					}
					if (chunk.toolCall.argumentChunk) {
						current.args += chunk.toolCall.argumentChunk;
					}
					if (chunk.toolCall.thoughtSignature) {
						current.thoughtSignature = chunk.toolCall.thoughtSignature;
					}
					toolCallsMap.set(idx, current);
				} else if (chunk.type === 'usage' && chunk.usage) {
					this._totalUsage = {
						promptTokens: this._totalUsage.promptTokens + chunk.usage.promptTokens,
						completionTokens: this._totalUsage.completionTokens + chunk.usage.completionTokens,
						totalTokens: this._totalUsage.totalTokens + chunk.usage.totalTokens
					};
				}
			}

			// Enregistrement du message de l'assistant
			const toolCallsList = Array.from(toolCallsMap.values()).map(tc => ({
				id: tc.id,
				type: 'function' as const,
				function: { name: tc.name, arguments: tc.args },
				thoughtSignature: tc.thoughtSignature
			}));

			messages.push({
				role: 'assistant',
				content: assistantText,
				tool_calls: toolCallsList.length > 0 ? toolCallsList : undefined
			});

			// S'il n'y a aucun appel d'outil ou si token annulé, la boucle est terminée
			if (toolCallsList.length === 0 || token.isCancellationRequested) {
				break;
			}

			// Exécution des outils avec cartes d'action et gestion des permissions
			for (const tc of toolCallsList) {
				let parsedArgs: Record<string, unknown> = {};
				try {
					parsedArgs = JSON.parse(tc.function.arguments || '{}');
				} catch {
					parsedArgs = {};
				}

				// Détection de boucle infinie : vérifie si l'action exacte est répétée 3 fois
				const actionSignature = `${tc.function.name}:${tc.function.arguments}`;
				this._actionHistory.push(actionSignature);
				const occurrences = this._actionHistory.filter(sig => sig === actionSignature).length;
				if (occurrences >= 3) {
					this._auditLog.log({
						agentId: this._agentId,
						actionType: 'error',
						description: `Arrêt automatique : répétition en boucle de ${tc.function.name}`,
						status: 'failed'
					});
					messages.push({
						role: 'tool',
						tool_call_id: tc.id,
						content: `Erreur: action répétée plusieurs fois consécutivement. Arrêt de sécurité.`
					});
					break;
				}

				const card: IActionCard = {
					id: tc.id,
					step,
					toolName: tc.function.name,
					arguments: parsedArgs,
					status: 'pending'
				};
				events.onActionCardCreated?.(card);

				// Évaluation des permissions
				const permCheck = this._permissionManager.evaluateToolCall(tc.function.name, parsedArgs);
				if (permCheck.requiresPrompt) {
					card.status = 'requires_permission';
					events.onActionCardUpdated?.(card);

					const userApproved = events.onPermissionRequested
						? await events.onPermissionRequested(card, permCheck.reason || 'Action nécessitant confirmation')
						: false;

					if (!userApproved) {
						card.status = 'failed';
						card.error = 'Action refusée par l\'utilisateur.';
						events.onActionCardUpdated?.(card);
						this._auditLog.log({
							agentId: this._agentId,
							actionType: 'permission_prompt',
							description: `Action ${tc.function.name} refusée par l'utilisateur`,
							status: 'rejected'
						});
						messages.push({
							role: 'tool',
							tool_call_id: tc.id,
							content: 'Action annulée : l\'utilisateur a rejeté cette opération.'
						});
						continue;
					}
				}

				card.status = 'running';
				events.onActionCardUpdated?.(card);

				try {
					const toolOutput = await this._toolExecutor(tc.function.name, parsedArgs, token);
					card.status = 'completed';
					card.result = toolOutput;
					events.onActionCardUpdated?.(card);

					this._auditLog.log({
						agentId: this._agentId,
						actionType: 'tool_call',
						description: `Exécution de ${tc.function.name}`,
						status: 'success'
					});

					messages.push({
						role: 'tool',
						tool_call_id: tc.id,
						content: toolOutput
					});
				} catch (err: unknown) {
					const errorMsg = err instanceof Error ? err.message : String(err);
					card.status = 'failed';
					card.error = errorMsg;
					events.onActionCardUpdated?.(card);

					this._auditLog.log({
						agentId: this._agentId,
						actionType: 'error',
						description: `Échec de ${tc.function.name}: ${errorMsg}`,
						status: 'failed'
					});

					messages.push({
						role: 'tool',
						tool_call_id: tc.id,
						content: `Erreur lors de l'exécution de l'outil ${tc.function.name}: ${errorMsg}`
					});
				}
			}

			const currentCost = calculateCost(this._model, this._totalUsage);
			events.onStepCompleted?.(step, this._totalUsage, currentCost);
		}

		const totalCost = calculateCost(this._model, this._totalUsage);
		return {
			messages,
			totalUsage: this._totalUsage,
			totalCost
		};
	}
}
