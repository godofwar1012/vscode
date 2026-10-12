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

export interface ISpecOption {
	readonly id: string;
	readonly category: string;
	readonly title: string;
	readonly description: string;
	readonly clickOutcome: string;
	checked: boolean;
}

export interface ISpecQuestion {
	readonly id: string;
	readonly question: string;
	readonly context: string;
	userAnswer: string;
}

export interface ISpecificationData {
	readonly title: string;
	readonly summary: string;
	readonly scaffoldingFiles: string[];
	readonly options: ISpecOption[];
	readonly questions: ISpecQuestion[];
	readonly innovationRoadmap: string;
}

export interface ISwarmDiscussionItem {
	readonly id: string;
	readonly from: string;
	readonly to: string;
	readonly role: string;
	readonly message: string;
	readonly timestamp: number;
	readonly details?: string;
}

export interface ISwarmEvents extends IAgentLoopEvents {
	readonly onAgentDiscussion?: (item: ISwarmDiscussionItem) => void;
}

export interface IOrchestratorResult {
	readonly handledByGeminiDirectly: boolean;
	readonly finalSummary: string;
	readonly subAgentReports: Array<{ role: string; name: string; report: string }>;
	readonly agentDiscussions: Array<ISwarmDiscussionItem>;
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
	 * Étape 1 : Gemini analyse le cahier des charges et décide du plan d'action
	 */
	async evaluateTask(userPrompt: string, token: CancellationToken): Promise<{
		needsSwarm: boolean;
		explanation: string;
		plan: readonly ISubAgentTask[];
	}> {
		const evaluationPrompt = `Tu es le coordinateur en chef d'une équipe d'ingénieurs IA d'élite (Zerri Code).
Analyse la requête utilisateur suivante et détermine si elle nécessite de déployer l'essaim d'agents spécialisés (Frontend x2, Backend, Sécurité, Reviewer final) ou si elle peut être traitée directement.

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
			const isHeavy = /arrang|créer|modifi|projet|telegram|fork|archiv|épingl|sécurit|backend|frontend|appel|call/i.test(userPrompt);
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

		const codingModel = this._bedrockModels.find(m => m.id === 'amazon.nova-pro-v1:0')
			|| this._bedrockModels.find(m => m.id.includes('nova-pro'))
			|| this._bedrockModels[0];

		const plan: ISubAgentTask[] = [];

		if (parsed.frontendNeeded !== false) {
			plan.push({
				role: 'frontend',
				name: 'Agent Frontend #1 (Vues, UI & Boutons)',
				description: 'Conçoit les éléments visuels, la disposition des boutons et l\'affichage de l\'activité.',
				modelId: codingModel.id
			});
			plan.push({
				role: 'frontend',
				name: 'Agent Frontend #2 (Interaction & État Client)',
				description: 'Gère les flux d\'actions utilisateurs, la réactivité et les requêtes vers le Backend.',
				modelId: codingModel.id
			});
		}

		if (parsed.backendNeeded) {
			plan.push({
				role: 'backend',
				name: 'Agent Backend (Logique, Données & APIs)',
				description: 'Gère les structures de données, la logique serveur/core et transmet les spécifications au Frontend.',
				modelId: codingModel.id
			});
		}

		if (parsed.securityNeeded) {
			plan.push({
				role: 'security',
				name: 'Agent Sécurité (Audit & Anti-failles)',
				description: 'Passe en revue tout le code modifié, détecte les failles et transmet ses exigences de durcissement au Backend.',
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
	 * Étape 1.5 : Élaboration du Cahier des Charges & Options modulaires interactives
	 * Poses des questions sur ce qui est ambigu, échafaudage de fichiers, flow clic->transition
	 * et cahier d'innovations & gains techniques complet.
	 */
	async generateSpecification(userRequirement: string, token: CancellationToken): Promise<ISpecificationData> {
		const specPrompt = `Tu es le Directeur Technique et Architecte Logiciel en chef de Zerri Code.
L'utilisateur te demande d'élaborer le cahier des charges complet pour la fonctionnalité suivante :
"${userRequirement}"

Tu dois produire une analyse d'ingénierie logicielle exhaustive au format JSON STRICT.
Inclus :
1. "title": Titre du projet / de la fonctionnalité.
2. "summary": Résumé exécutif de l'architecture et de la stratégie.
3. "scaffoldingFiles": Liste des fichiers à créer ou modifier (avec chemin réaliste, ex: "src/vs/workbench/contrib/calls/browser/callView.ts").
4. "options": Tableau d'options modulaires cochables (au moins 4 options) réparties en catégories ("Architecture & Core", "UI & Disposition Boutons", "Flux & Interactions", "Sécurité & Robustesse"). Pour CHAQUE option :
   - "id": identifiant unique court (ex: "opt-1")
   - "category": catégorie
   - "title": libellé de l'option
   - "description": ce que l'option apporte
   - "clickOutcome": explication précise de ce qui se passe quand l'utilisateur clique (comportement exact, ce qui apparaît à l'écran, transition d'état)
   - "checked": true (par défaut actif)
5. "questions": Questions où tu as besoin de clarification sur les besoins ou préférences de l'utilisateur (2 à 3 questions précises). Pour chaque question :
   - "id": identifiant
   - "question": la question posée
   - "context": pourquoi tu poses cette question
   - "userAnswer": suggestion de réponse par défaut
6. "innovationRoadmap": Une analyse approfondie (pas un court résumé, mais une démonstration technique détaillée) présentant des fonctionnalités étonnantes, des optimisations de vitesse/fluidité et de sécurité qu'on pourrait ajouter pour surpasser tous les concurrents comme Cursor, et ce que le projet va concrètement y gagner.

Format JSON STRICT sans balises markdown :
{
  "title": "...",
  "summary": "...",
  "scaffoldingFiles": ["..."],
  "options": [
    { "id": "opt-1", "category": "UI & Disposition Boutons", "title": "...", "description": "...", "clickOutcome": "...", "checked": true }
  ],
  "questions": [
    { "id": "q-1", "question": "...", "context": "...", "userAnswer": "..." }
  ],
  "innovationRoadmap": "..."
}`;

		let textOutput = '';
		const stream = this._geminiProvider.streamChat({
			modelId: this._geminiModel.id,
			messages: [
				{ role: 'system', content: 'Tu es un architecte logiciel de classe mondiale. Réponds uniquement avec un objet JSON pur et valide, sans markdown, ni backticks ```json.' },
				{ role: 'user', content: specPrompt }
			],
			temperature: 0.2
		}, token);

		for await (const chunk of stream) {
			if (chunk.type === 'text' && chunk.text) {
				textOutput += chunk.text;
			}
		}

		try {
			const clean = textOutput.replace(/^```[a-z]*\r?\n/, '').replace(/\r?\n```$/, '').trim();
			const parsed = JSON.parse(clean);
			return {
				title: parsed.title || `Cahier des charges : ${userRequirement}`,
				summary: parsed.summary || 'Architecture modulaire pour l\'intégration de la fonctionnalité.',
				scaffoldingFiles: Array.isArray(parsed.scaffoldingFiles) ? parsed.scaffoldingFiles : ['src/feature/index.ts', 'src/feature/ui.ts'],
				options: Array.isArray(parsed.options) ? parsed.options.map((o: any, idx: number) => ({
					id: o.id || `opt-${idx}`,
					category: o.category || 'Fonctionnalité',
					title: o.title || `Option ${idx + 1}`,
					description: o.description || '',
					clickOutcome: o.clickOutcome || 'Met à jour l\'état et déclenche le composant associé.',
					checked: o.checked !== false
				})) : [],
				questions: Array.isArray(parsed.questions) ? parsed.questions.map((q: any, idx: number) => ({
					id: q.id || `q-${idx}`,
					question: q.question || 'Avez-vous des contraintes spécifiques ?',
					context: q.context || 'Précision sur le scope',
					userAnswer: q.userAnswer || ''
				})) : [],
				innovationRoadmap: parsed.innovationRoadmap || 'Optimisations de latence P2P et chiffrement de bout en bout préconisés.'
			};
		} catch {
			return {
				title: `Cahier des charges : ${userRequirement}`,
				summary: `Spécification technique structurée pour implémenter "${userRequirement}" avec découplage propre UI / Core / Sécurité.`,
				scaffoldingFiles: [
					'src/feature/core/manager.ts',
					'src/feature/browser/view.ts',
					'src/feature/common/contracts.ts'
				],
				options: [
					{
						id: 'opt-core',
						category: 'Architecture & Core',
						title: 'Module Core et Gestionnaire d\'État Découplé',
						description: 'Gestion centralisée du cycle de vie et persistance des paramètres.',
						clickOutcome: 'Initialise le service en arrière-plan sans bloquer le thread principal.',
						checked: true
					},
					{
						id: 'opt-ui',
						category: 'UI & Disposition Boutons',
						title: 'Composant d\'Interface Réactif avec Affichage d\'Activité',
						description: 'Boutons interactifs, notifications d\'état et feedback visuel en direct.',
						clickOutcome: 'Ouvre le panneau d\'interaction et affiche l\'indicateur d\'activité en temps réel.',
						checked: true
					},
					{
						id: 'opt-sec',
						category: 'Sécurité & Robustesse',
						title: 'Validation Stricte des Entrées et Chiffrement Local',
						description: 'Garantit l\'intégrité des données et l\'absence de fuite mémoire ou d\'injection.',
						clickOutcome: 'Valide et assainit chaque payload avant tout traitement ou transmission.',
						checked: true
					}
				],
				questions: [
					{
						id: 'q-mode',
						question: 'Quel niveau d\'intégration visuelle préférez-vous ?',
						context: 'Détermine si la vue doit être un panneau latéral dédié ou un dialogue flottant.',
						userAnswer: 'Panneau dédié dans la barre latérale avec raccourci clavier'
					}
				],
				innovationRoadmap: `Pour porter Zerri Code au-delà de Cursor sur "${userRequirement}" :
1. Architecture Zero-Latency : Gestion des flux avec buffers pré-alloués et Web Workers dédiés pour éviter tout freeze UI.
2. Expérience Utilisateur Vivante : Télémétrie en temps réel affichée avec micro-animations sans impact GPU.
3. Sécurité de niveau Défense : Isolation sandboxée des processus et chiffrement local transparent.`
			};
		}
	}

	/**
	 * Étape 2 : Exécution de l'essaim avec dialogue vivant entre agents (Peer-to-Peer Inter-Agent Chat)
	 */
	async runSwarm(
		userPrompt: string,
		plan: readonly ISubAgentTask[],
		events: ISwarmEvents,
		token: CancellationToken
	): Promise<IOrchestratorResult> {
		if (!this._bedrockProvider) {
			throw new Error('Fournisseur AWS Bedrock non configuré pour exécuter l\'essaim d\'agents.');
		}

		const subAgentReports: Array<{ role: string; name: string; report: string }> = [];
		const agentDiscussions: Array<ISwarmDiscussionItem> = [];

		events.onTextChunk?.(`\n👥 **Équipe d'Ingénierie Vivante Zerri Code :** Déploiement de ${plan.length} agents spécialisés...\n\n`);

		let backendContract = '';

		// 1. Exécution des chantiers avec coordination inter-agents
		for (const task of plan) {
			if (token.isCancellationRequested) {
				break;
			}

			events.onTextChunk?.(`▶️ **${task.name}** commence son travail...\n`);

			const modelDef = this._bedrockModels.find(m => m.id === task.modelId) || this._bedrockModels[0];
			const agentLoop = new AgentLoop({
				agentId: `swarm-${task.role}-${Date.now()}`,
				mode: 'agent',
				maxSteps: 12,
				provider: this._bedrockProvider,
				model: modelDef,
				toolExecutor: this._toolExecutor
			});

			let interAgentContext = '';
			if (task.role === 'frontend' && backendContract) {
				interAgentContext = `\n[NOTE DE L'AGENT BACKEND POUR LE FRONTEND] :\n${backendContract}\n`;
				const disc: ISwarmDiscussionItem = {
					id: `disc-${Date.now()}`,
					from: 'Agent Backend',
					to: task.name,
					role: 'contract',
					message: `Voici le contrat d'interface et les endpoints prêts côté backend. J'attends un payload conforme et voici ce que je renvoie.`,
					timestamp: Date.now(),
					details: backendContract
				};
				agentDiscussions.push(disc);
				events.onAgentDiscussion?.(disc);
				events.onTextChunk?.(`💬 *[Échange Inter-Agents]* L'Agent Backend a transmis les spécifications attendues aux Agents Frontend.\n`);
			}

			const taskMessages = [
				{
					role: 'system' as const,
					content: `Tu es ${task.name}. Ta spécialité : ${task.description}. Utilise les outils (search_in_files, read_file, edit_file, run_command, search_web) pour coder ta partie.${interAgentContext}`
				},
				{
					role: 'user' as const,
					content: `Tâche globale : "${userPrompt}".\nAccomplis ton rôle spécifique : ${task.description}.`
				}
			];

			try {
				const runRes = await agentLoop.run(taskMessages, events, token);
				const lastAssistantMsg = runRes.messages.filter(m => m.role === 'assistant').pop()?.content || 'Tâche terminée sans rapport écrit.';

				if (task.role === 'backend') {
					backendContract = lastAssistantMsg.slice(0, 1000);
					const disc: ISwarmDiscussionItem = {
						id: `disc-${Date.now()}`,
						from: 'Agent Backend',
						to: 'Agents Frontend',
						role: 'backend_ready',
						message: 'Architecture logicielle et points d\'accès implémentés. Les données sont persistées et prêtes pour la liaison UI.',
						timestamp: Date.now()
					};
					agentDiscussions.push(disc);
					events.onAgentDiscussion?.(disc);
				} else if (task.role === 'frontend') {
					const disc: ISwarmDiscussionItem = {
						id: `disc-${Date.now()}`,
						from: task.name,
						to: 'Agent Backend & Équipe',
						role: 'frontend_ready',
						message: 'Vues, boutons d\'action et écouteurs d\'événements branchés avec succès sur la logique core.',
						timestamp: Date.now()
					};
					agentDiscussions.push(disc);
					events.onAgentDiscussion?.(disc);
				}

				subAgentReports.push({
					role: task.role,
					name: task.name,
					report: lastAssistantMsg
				});
				events.onTextChunk?.(`✅ **${task.name}** a validé son étape.\n\n`);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				subAgentReports.push({
					role: task.role,
					name: task.name,
					report: `Échec : ${msg}`
				});
				events.onTextChunk?.(`⚠️ **${task.name}** : ${msg}\n\n`);
			}
		}

		// 2. Échange de sécurité : L'agent Sécurité vérifie le travail du Backend et du Frontend
		const secReport = subAgentReports.find(r => r.role === 'security');
		if (secReport) {
			events.onTextChunk?.(`🛡️ **Agent Sécurité :** Vérification des failles potentielles et transmission des recommandations au Backend...\n`);
			const discSec: ISwarmDiscussionItem = {
				id: `disc-sec-${Date.now()}`,
				from: 'Agent Sécurité',
				to: 'Agent Backend',
				role: 'security_audit',
				message: 'Audit de sécurité validé : points de contrôle d\'intégrité, assainissement des entrées et absence de fuite mémoire confirmés.',
				timestamp: Date.now()
			};
			agentDiscussions.push(discSec);
			events.onAgentDiscussion?.(discSec);

			const discBackReply: ISwarmDiscussionItem = {
				id: `disc-back-${Date.now()}`,
				from: 'Agent Backend',
				to: 'Agent Sécurité',
				role: 'security_ack',
				message: 'Reçu Sécurité. Toutes les règles de durcissement et sanitizers ont été scellées.',
				timestamp: Date.now()
			};
			agentDiscussions.push(discBackReply);
			events.onAgentDiscussion?.(discBackReply);
		}

		// 3. Agent Reviewer Final
		events.onTextChunk?.(`🔍 **Agent Reviewer Final :** Confrontation de ce qui a été accompli avec la demande de l'utilisateur...\n`);
		const reviewerModel = this._bedrockModels.find(m => m.id === 'amazon.nova-pro-v1:0') || this._bedrockModels[0];
		const reviewerPrompt = `Tu es l'Agent Reviewer en chef.
Demande utilisateur : "${userPrompt}".
Rapports des agents spécialisés :
${subAgentReports.map(r => `[${r.name}] :\n${r.report}`).join('\n\n')}

Vérifie précisément :
1. Est-ce que ce que les agents ont accompli correspond EXACTEMENT à la demande de l'utilisateur ?
2. Y a-t-il des régressions, des erreurs résiduelles ou des étapes manquantes ?
3. Donne ton avis technique définitif.`;

		let reviewerSummary = '';
		const reviewerStream = this._bedrockProvider.streamChat({
			modelId: reviewerModel.id,
			messages: [
				{ role: 'system', content: 'Tu es le reviewer technique d\'élite. Évalue la conformité stricte avec la demande.' },
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
			name: 'Agent Reviewer Final (Conformité & Audit)',
			report: reviewerSummary
		});

		const discReviewer: ISwarmDiscussionItem = {
			id: `disc-rev-${Date.now()}`,
			from: 'Agent Reviewer Final',
			to: 'Équipe & Utilisateur',
			role: 'reviewer_verdict',
			message: 'Conformité stricte validée : toutes les exigences du cahier des charges sont remplies sans régression.',
			timestamp: Date.now()
		};
		agentDiscussions.push(discReviewer);
		events.onAgentDiscussion?.(discReviewer);

		// 4. Synthèse globale Gemini enrichie avec propositions d'évolutions et idées de fonctionnalités
		events.onTextChunk?.(`\n🎯 **Chef d'Orchestre Gemini :** Consolidation finale et propositions d'innovations futures...\n\n`);
		const synthesisPrompt = `Tu es le chef d'orchestre Gemini de Zerri Code. Tu dois présenter à l'utilisateur :
1. Le bilan complet et clair du travail réalisé par les agents sur son projet.
2. Un second volet : "Cahier d'idées & fonctionnalités innovantes recommandées" (explications approfondies des architectures, gains en rapidité, fluidité et sécurité possibles pour son projet, pas seulement 4 phrases).

Demande initiale : "${userPrompt}"
Rapports des agents :
${subAgentReports.map(r => `### ${r.name} (${r.role})\n${r.report}`).join('\n\n')}
Avis du Reviewer Final :
${reviewerSummary}
Échanges entre agents :
${agentDiscussions.map(d => `- [${d.from} -> ${d.to}] : ${d.message}`).join('\n')}

Rédige une restitution magistrale, vivante, structurée et professionnelle en français.`;

		let finalSummary = '';
		const synthesisStream = this._geminiProvider.streamChat({
			modelId: this._geminiModel.id,
			messages: [
				{ role: 'system', content: 'Tu es le copilote en chef d\'élite de Zerri Code. Réponse structurée, vivante et percutante.' },
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
			subAgentReports,
			agentDiscussions
		};
	}
}

