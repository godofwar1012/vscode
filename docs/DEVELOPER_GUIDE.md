# Guide Développeur — Zerri Code
**Version 1.0 — Architecture & Extension de l'Éditeur IA**

Ce document explique comment personnaliser et étendre chaque composant de **Zerri Code**.

---

## 1. Organisation du Code

Tout le code propre aux agents IA est strictement isolé dans :
```
src/vs/workbench/contrib/agents/
├── common/        # Types normalisés, sécurité, quotas et configuration
├── providers/     # Fournisseurs de modèles (DeepSeek, Bedrock, OpenAI-Compatible)
├── runtime/       # Boucle autonome, gestionnaire d'outils, checkpoints, permissions
├── browser/       # Interface graphique (Panneau latéral, onglets dédiés, cartes d'action)
└── test/          # Suites de tests automatisés
```

*Règle d'architecture* : Les dépendances vont uniquement de `browser` ➔ `runtime` ➔ `providers` ➔ `common`. Aucun import circulaire.

---

## 2. Comment ajouter un nouveau Fournisseur de Modèles (LLM)

Pour ajouter un nouveau fournisseur (ex: Mistral AI, Anthropic direct, Groq) :

### Étape 1 : Créer un fichier dans `providers/`
Exemple `src/vs/workbench/contrib/agents/providers/groqProvider.ts` :
```typescript
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IModelDefinition, IModelProvider, IModelRequest, IModelStreamChunk } from '../common/agentTypes.js';

export class GroqProvider implements IModelProvider {
    readonly id = 'groq';
    readonly displayName = 'Groq Cloud';

    constructor(private readonly apiKey: string) {}

    async listModels(): Promise<IModelDefinition[]> {
        return [{
            id: 'llama-3.3-70b-versatile',
            name: 'Llama 3.3 70B (Groq)',
            providerId: this.id,
            maxContextTokens: 128000,
            supportsStreaming: true,
            supportsTools: true,
            supportsReasoning: false,
            inputPricePerMillion: 0.59,
            outputPricePerMillion: 0.79
        }];
    }

    async countTokens(text: string): Promise<number> {
        return Math.ceil(text.length / 4);
    }

    async testConnection(): Promise<{ success: boolean; error?: string }> {
        return { success: true };
    }

    async *streamChat(request: IModelRequest, token: CancellationToken): AsyncIterable<IModelStreamChunk> {
        // Appeler l'API de streaming Groq et céder les fragments (yield { type: 'text', text: chunk })
    }
}
```

### Étape 2 : L'enregistrer dans le registre
Dans votre point d'entrée :
```typescript
import { ModelProviderRegistry } from './providers/providerRegistry.js';
import { GroqProvider } from './providers/groqProvider.js';

ModelProviderRegistry.getInstance().registerProvider(new GroqProvider('votre_clé'));
```
C'est tout ! Le modèle apparaît immédiatement dans le sélecteur d'agents.

---

## 3. Comment ajouter un nouvel Outil à l'Agent

Les outils sont définis dans [`src/vs/workbench/contrib/agents/runtime/agentTools.ts`](../src/vs/workbench/contrib/agents/runtime/agentTools.ts).

Pour ajouter un outil (ex: `web_search`) :
1. Déclarer son schéma JSON :
```typescript
{
    type: 'function',
    function: {
        name: 'web_search',
        description: 'Recherche des informations sur le web.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'La requête de recherche.' }
            },
            required: ['query']
        }
    }
}
```
2. Implémenter l'exécution dans le gestionnaire d'outils de votre runtime. L'outil apparaîtra automatiquement sous forme de carte d'action en direct dans l'onglet de l'agent.

---

## 4. Comment personnaliser l'Interface des Onglets

L'onglet de l'agent est géré par [`AgentEditorPane`](../src/vs/workbench/contrib/agents/browser/agentEditorPane.ts).
- Les couleurs et bordures utilisent les variables de thème officielles de VS Code (ex: `var(--vscode-editor-background)`).
- Les cartes d'action affichent l'état en direct (`pending`, `running`, `completed`, `failed`).
- Vous pouvez ajouter vos propres composants visuels directement dans `_renderAgentContent()`.

---

## 5. Sécurité, Budgets et Checkpoints

- **Exclusion des secrets** : Les fichiers `.env`, clés privées (`.pem`, `.key`, `id_rsa`) sont automatiquement exclus des lectures d'agents par [`SecretSanitizer`](../src/vs/workbench/contrib/agents/common/agentSecurity.ts).
- **Points de restauration** : Chaque modification de fichier par un agent crée un snapshot dans [`CheckpointManager`](../src/vs/workbench/contrib/agents/runtime/checkpoints.ts), permettant une annulation immédiate de tous les changements.
- **Plafonds de dépenses** : [`BudgetGuard`](../src/vs/workbench/contrib/agents/common/agentSecurity.ts) coupe l'agent s'il dépasse le coût ou le nombre d'étapes autorisé.
