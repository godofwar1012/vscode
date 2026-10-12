/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IModelDefinition, IModelProvider } from '../common/agentTypes.js';
import { AgentLoop, IAgentLoopEvents } from './agentLoop.js';

export interface ISubAgentTask {
	readonly role: 'frontend' | 'backend' | 'security' | 'reviewer';
	readonly name: string;
	readonly description: string;
	readonly modelId: string;
}

export interface IOrchestratorResult {
	readonly handledByGeminiDirectly: boolean;
	readonly finalSummary: string;
	readonly subAgentReports: Array<{ role: string; name: string; report: string }>;
}

export class MultiAgentSwarmCoordinator {
	constructor(
		private readonly _geminiProvider: IModelProvider,
		private readonly _geminiModel: IModelDefinition,
		private readonly _bedrockProvider: IModelProvider | undefined,
		private readonly _bedrockModels: readonly IModelDefinition[],
		private readonly _toolExecutor: (toolName: string, args: Record<string, unknown>, token: CancellationToken) => Promise<string>
	) { }

	/**
	 * Étape 1 : Gemini analyse la demande et décide :
	 * - S'il peut la résoudre directement (question simple, explication, modification mineure)
	 * - Ou s'il doit mobiliser l'essaim spécialisé (2x Frontend, 1x Backend, 1x Sécurité, 1x Reviewer)
	 */
	async evaluateTask(userPrompt: string, token: CancellationToken): Promise<{
		needsSwarm: boolean;
		explanation: string;
		plan: readonly ISubAgentTask[];
	}> {
		const evaluationPrompt = `Tu es le coordinateur en chef d'une équipe d'ingénieurs IA d'élite.
Analyse la requête utilisateur suivante et détermine si elle nécessite de déployer l'essaim d'agents spécialisés (Frontend, Backend, Sécurité, Reviewer final) ou si elle peut être traitée directement.

Requête utilisateur :
"${userPrompt}"

Réponds STRICTEMENT sous format JSON valide respectant ce schéma :
{
  "needsSwarm": boolean,
  "explanation": "brève explication de la stratégie",
  "frontendNeeded": boolean,
  "backendNeeded": boolean,
  "securityNeeded": boolean
}`;

		let geminiResponseText = '';
		const stream = this._geminiProvider.streamChat({
			modelId: this._geminiModel.id,
			messages: [
				{ role: 'system', content: 'Tu es un planificateur logiciel d\'élite. Réponds uniquement en JSON sans balises markdown.' },
				{ role: 'user', content: evaluationPrompt }
			],
			temperature: 0.1
		}, token);

		for await (const chunk of stream) {
			if (chunk.type === 'text' && chunk.text) {
				geminiResponseText += chunk.text;
			}
		}

		let parsed: any = {};
		try {
			const cleanJson = geminiResponseText.replace(/^```[a-z]*\r?\n/, '').replace(/\r?\n```$/, '').trim();
			parsed = JSON.parse(cleanJson);
		} catch {
			// Si la réponse n'est pas du JSON strict, analyser heuristiquement
			const isHeavy = /arrang|créer|modifi|projet|telegram|fork|archiv|épingl|sécurit|backend|frontend/i.test(userPrompt);
			parsed = {
				needsSwarm: isHeavy,
				explanation: isHeavy ? 'Projet lourd nécessitant l\'orchestration complète.' : 'Tâche réalisable en direct.',
				frontendNeeded: true,
				backendNeeded: true,
				securityNeeded: true
			};
		}

		if (!parsed.needsSwarm || !this._bedrockProvider) {
			return {
				needsSwarm: false,
				explanation: parsed.explanation || 'Résolution directe via Gemini.',
				plan: []
			};
		}

		// Sélection du modèle de codage Bedrock (Amazon Nova Pro par défaut pour coût minimal et grand contexte)
		const codingModel = this._bedrockModels.find(m => m.id === 'amazon.nova-pro-v1:0')
			|| this._bedrockModels.find(m => m.id.includes('nova-pro'))
			|| this._bedrockModels[0];

		const plan: ISubAgentTask[] = [];

		if (parsed.frontendNeeded !== false) {
			plan.push({
				role: 'frontend',
				name: 'Agent Frontend #1 (UI & Composants)',
				description: 'Inspecte et adapte les vues, composants et listes visuelles.',
				modelId: codingModel.id
			});
			plan.push({
				role: 'frontend',
				name: 'Agent Frontend #2 (Gestion d\'État & Interaction)',
				description: 'Gère les événements, interactions utilisateur et réactivité.',
				modelId: codingModel.id
			});
		}

		if (parsed.backendNeeded) {
			plan.push({
				role: 'backend',
				name: 'Agent Backend (Logique & Persistance)',
				description: 'Gère la persistance des données, les modèles de stockage et les commandes système.',
				modelId: codingModel.id
			});
		}

		if (parsed.securityNeeded) {
			plan.push({
				role: 'security',
				name: 'Agent Sécurité (Audit & Robustesse)',
				description: 'Vérifie les injections, la validation des paramètres et l\'intégrité des opérations.',
				modelId: codingModel.id
			});
		}

		return {
			needsSwarm: true,
			explanation: parsed.explanation || 'Déploiement de l\'essaim d\'ingénieurs IA.',
			plan
		};
	}

	/**
	 * Étape 2 : Exécution de l'essaim et synthèse finale par Gemini
	 */
	async runSwarm(
		userPrompt: string,
		plan: readonly ISubAgentTask[],
		events: IAgentLoopEvents,
		token: CancellationToken
	): Promise<IOrchestratorResult> {
		if (!this._bedrockProvider) {
			throw new Error('Fournisseur AWS Bedrock non configuré pour exécuter l\'essaim d\'agents.');
		}

		const subAgentReports: Array<{ role: string; name: string; report: string }> = [];

		events.onTextChunk?.(`\n🤖 **Orchestrateur Gemini :** Déploiement de l'équipe d'agents (${plan.length} chantiers en parallèle sur Amazon Bedrock)...\n\n`);

		// Exécution séquentielle ou parallèle des chantiers
		for (const task of plan) {
			if (token.isCancellationRequested) {
				break;
			}

			events.onTextChunk?.(`▶️ **${task.name}** en cours d'exécution...\n`);

			const modelDef = this._bedrockModels.find(m => m.id === task.modelId) || this._bedrockModels[0];
			const agentLoop = new AgentLoop({
				agentId: `swarm-${task.role}-${Date.now()}`,
				mode: 'agent',
				maxSteps: 12,
				provider: this._bedrockProvider,
				model: modelDef,
				toolExecutor: this._toolExecutor
			});

			const taskMessages = [
				{
					role: 'system' as const,
					content: `Tu es ${task.name}. Ta spécialité : ${task.description}. Utilise les outils (search_in_files, read_file, edit_file, run_command) pour accomplir ta partie de la tâche.`
				},
				{
					role: 'user' as const,
					content: `Tâche globale : "${userPrompt}".\nAccomplis ton rôle spécifique : ${task.description}.`
				}
			];

			try {
				const runRes = await agentLoop.run(taskMessages, events, token);
				const lastAssistantMsg = runRes.messages.filter(m => m.role === 'assistant').pop()?.content || 'Tâche terminée sans rapport écrit.';
				subAgentReports.push({
					role: task.role,
					name: task.name,
					report: lastAssistantMsg
				});
				events.onTextChunk?.(`✅ **${task.name}** a terminé sa mission.\n\n`);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				subAgentReports.push({
					role: task.role,
					name: task.name,
					report: `Échec : ${msg}`
				});
				events.onTextChunk?.(`⚠️ **${task.name}** a rencontré une erreur : ${msg}\n\n`);
			}
		}

		// Étape 3 : L'agent Reviewer final (vérification globale du projet)
		events.onTextChunk?.(`🔍 **Agent Reviewer Final :** Analyse globale du code produit et vérification d'ensemble...\n`);
		const reviewerModel = this._bedrockModels.find(m => m.id === 'amazon.nova-pro-v1:0') || this._bedrockModels[0];
		const reviewerPrompt = `Tu es l'Agent Reviewer en chef.
Voici ce que l'utilisateur a demandé : "${userPrompt}".
Voici les rapports des chantiers réalisés par les agents :
${subAgentReports.map(r => `[${r.name}] :\n${r.report}`).join('\n\n')}

Analyse l'état final du projet, vérifie la cohérence entre le frontend, le backend et la sécurité. Donne ton avis technique définitif.`;

		let reviewerSummary = '';
		const reviewerStream = this._bedrockProvider.streamChat({
			modelId: reviewerModel.id,
			messages: [
				{ role: 'system', content: 'Tu es le reviewer technique le plus exigeant. Donne une évaluation claire.' },
				{ role: 'user', content: reviewerPrompt }
			],
			temperature: 0.2
		}, token);

		for await (const chunk of reviewerStream) {
			if (chunk.type === 'text' && chunk.text) {
				reviewerSummary += chunk.text;
			}
		}
		subAgentReports.push({
			role: 'reviewer',
			name: 'Agent Reviewer Final (Audit Qualité)',
			report: reviewerSummary
		});

		// Étape 4 : Gemini rédige la restitution finale consolidée pour l'utilisateur
		events.onTextChunk?.(`\n🎯 **Gemini :** Consolidations des résultats pour restitution finale...\n\n`);
		const synthesisPrompt = `Tu es le chef d'orchestre Gemini. Tu dois présenter à l'utilisateur le bilan complet du travail effectué par tes équipes spécialisées sur son projet.

Demande initiale : "${userPrompt}"
Rapports des agents spécialisés :
${subAgentReports.map(r => `### ${r.name} (${r.role})\n${r.report}`).join('\n\n')}

Avis du Reviewer Final :
${reviewerSummary}

Rédige une restitution claire, structurée et professionnelle en français détaillant exactement ce qui a été fait, les fichiers modifiés et l'état du projet.`;

		let finalSummary = '';
		const synthesisStream = this._geminiProvider.streamChat({
			modelId: this._geminiModel.id,
			messages: [
				{ role: 'system', content: 'Tu es l\'assistant principal de Zerri Code. Présente un bilan clair et impeccable.' },
				{ role: 'user', content: synthesisPrompt }
			],
			temperature: 0.3
		}, token);

		for await (const chunk of synthesisStream) {
			if (chunk.type === 'text' && chunk.text) {
				finalSummary += chunk.text;
				events.onTextChunk?.(chunk.text);
			}
		}

		return {
			handledByGeminiDirectly: false,
			finalSummary,
			subAgentReports
		};
	}
}
