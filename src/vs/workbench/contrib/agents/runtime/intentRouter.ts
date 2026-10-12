/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type UserIntent =
	| 'local_file_search'     // Recherche de fichier ou symbole locale (0$ et 2ms)
	| 'syntax_quick_lookup'   // Question simple de syntaxe (résolu par modèle local / ultra-léger)
	| 'codebase_explanation'  // Question de haut niveau sur le projet (Fast Model DeepSeek-V3)
	| 'targeted_edit'         // Modification locale (Inline Ctrl+K)
	| 'complex_refactor_bug'; // Tâche complexe / bug (Deep Reasoner R1 avec self-correction)

export interface IIntentDecision {
	readonly intent: UserIntent;
	readonly confidence: number;
	readonly estimatedCostUSD: number;
	readonly recommendedRoute: 'native_rust' | 'fast_llm' | 'deep_reasoner';
	readonly explanation: string;
}

export class IntentRouter {
	classifyIntent(prompt: string): IIntentDecision {
		const text = prompt.trim().toLowerCase();

		// 1. Recherche de fichier / symbole -> Déviation directe vers le noyau Rust (0$ de coût API, 2ms)
		const searchPatterns = [
			/^(où se trouve|où est|trouve|cherche|locate|where is|find)\s+(le fichier|la classe|la fonction|l'interface|symbol)/i,
			/^@file/i,
			/^fichier\s+/i
		];
		if (searchPatterns.some(p => p.test(text))) {
			return {
				intent: 'local_file_search',
				confidence: 0.95,
				estimatedCostUSD: 0.0,
				recommendedRoute: 'native_rust',
				explanation: 'Résolution locale instantanée via l\'index Rust (0$ et <5ms).'
			};
		}

		// 2. Simple question de syntaxe / snippet rapide
		const syntaxPatterns = [
			/^(comment faire un|syntaxe de|snippet pour|comment déclarer|how to write a)\s+(for|loop|map|filter|type|interface|promise)/i,
			/^(quelle est la syntaxe)/i
		];
		if (syntaxPatterns.some(p => p.test(text))) {
			return {
				intent: 'syntax_quick_lookup',
				confidence: 0.88,
				estimatedCostUSD: 0.00005,
				recommendedRoute: 'fast_llm',
				explanation: 'Réponse rapide via le modèle léger sans recherche lourde.'
			};
		}

		// 3. Demande d'édition ciblée
		if (text.startsWith('modifie') || text.startsWith('change') || text.startsWith('refactore') || text.startsWith('remplace')) {
			return {
				intent: 'targeted_edit',
				confidence: 0.90,
				estimatedCostUSD: 0.0002,
				recommendedRoute: 'fast_llm',
				explanation: 'Édition ciblée via patch chirurgical.'
			};
		}

		// 4. Tâche complexe ou correction de bug
		const complexPatterns = [
			/erreur/i,
			/bug/i,
			/exception/i,
			/crash/i,
			/échoue/i,
			/corrige/i,
			/refonte/i,
			/architecture/i,
			/test/i
		];
		if (complexPatterns.some(p => p.test(text))) {
			return {
				intent: 'complex_refactor_bug',
				confidence: 0.92,
				estimatedCostUSD: 0.0015,
				recommendedRoute: 'deep_reasoner',
				explanation: 'Activation du modèle de pensée approfondie (DeepSeek-R1) et boucle de vérification.'
			};
		}

		// 5. Explication générale sur la codebase
		return {
			intent: 'codebase_explanation',
			confidence: 0.80,
			estimatedCostUSD: 0.0003,
			recommendedRoute: 'fast_llm',
			explanation: 'Analyse globale de la codebase avec indexation BM25.'
		};
	}
}
