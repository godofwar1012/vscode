# Cahier des charges — Éditeur IA (fork de VS Code)
**Version 1.0 — Document destiné aux développeurs**

---

## 1. Objectif
Nous construisons un éditeur de code basé sur un fork de VS Code. Son IA remplace entièrement celle de Copilot.

L'éditeur doit permettre trois choses :
- **Utiliser nos propres clés API** (DeepSeek et Amazon Bedrock au départ).
- **Voir les agents travailler en direct**, étape par étape.
- **Offrir une expérience équivalente à celle de Cursor**, avec des onglets dédiés aux agents.

Tout doit rester modifiable par les développeurs : interface, prompts, outils, fournisseurs.

---

## 2. Périmètre

### Inclus
- Fork de `microsoft/vscode` et reprise du code de `vscode-copilot-chat` (licence à vérifier avant reprise).
- Nouvelle couche de fournisseurs de modèles.
- Nouveau panneau de chat et d'agents.
- Gestion des clés, des coûts et des permissions.
- Installeur Windows en priorité, puis Linux et macOS.

### Exclus (v1)
- Complétion de code en ligne (autocomplétion pendant la frappe).
- Compte utilisateur, facturation, synchronisation cloud.
- Reprise du code, des logos, des noms ou des icônes de Cursor, de Microsoft ou de GitHub.

> **Règle importante** : nous reproduisons le comportement et les bonnes pratiques d'ergonomie. Nous ne copions ni le code ni l'identité visuelle d'un produit existant.

---

## 3. Base technique
- **Cœur de l'éditeur** : TypeScript (Electron, Node.js).
- **Apparence** : CSS, variables de thème.
- **Configuration produit** : `product.json` (nom, identité, galerie d'extensions).
- **Galerie d'extensions** : Open VSX (le Marketplace de Microsoft est interdit aux forks).
- **Télémétrie de Microsoft** : désactivée.

### Règles d'architecture
1. Tout le nouveau code va dans de nouveaux dossiers (ex. `src/vs/workbench/contrib/agents/`).
2. On modifie le moins possible les fichiers existants de VS Code. Cela limite les conflits aux mises à jour.
3. La logique d'agents est un module indépendant de l'interface. Elle peut être réutilisée en ligne de commande.
4. Si une partie demande de la performance (indexation de code), elle peut être un processus séparé en Go ou en Rust.

---

## 4. Fournisseurs de modèles

### 4.1 Interface commune
Chaque fournisseur implémente la même interface :
- Lister les modèles disponibles.
- Envoyer une conversation avec des outils, en streaming.
- Compter les tokens.
- Annuler une requête en cours.
- Renvoyer une erreur claire (clé invalide, quota, réseau).

Le module normalise les appels d'outils et le streaming.

### 4.2 DeepSeek
- Connexion par clé API et adresse d'API configurable.
- Choix de la version du modèle dans l'interface (ex. V3, R1).
- La liste des versions doit être modifiable sans recompiler (fichier de configuration).
- Réglages par modèle : température, nombre maximal de tokens, mode de raisonnement si disponible.
- Affichage du coût estimé et des tokens consommés.

### 4.3 Amazon Bedrock
- Utilisation de l'API Converse (conversation, outils, streaming).
- Authentification par profil AWS, variables d'environnement ou clés d'accès.
- Choix de la région et du modèle (identifiant du modèle Bedrock).
- Messages d'erreur clairs quand le modèle n'est pas activé dans le compte AWS.

### 4.4 Autres fournisseurs
- Un adaptateur compatible OpenAI (point d'accès personnalisable). Il couvre OpenRouter, Ollama, vLLM et d'autres.
- Ajouter un fournisseur ne doit demander qu'un seul nouveau fichier et une ligne d'enregistrement.

### 4.5 Gestion des clés
- Stockage dans le coffre sécurisé du système (Windows Credential Manager, trousseau macOS, Secret Service sous Linux).
- Jamais en clair dans les paramètres, les journaux ou les dépôts Git.
- Écran « Fournisseurs » : ajouter, tester la connexion, supprimer une clé.
- Plusieurs clés possibles par fournisseur (profils nommés).

### 4.6 Choix du modèle
- Sélecteur de modèle dans le panneau de chat.
- Modèle par défaut par agent.
- Règle de secours : si le modèle principal échoue, bascule vers un second modèle (configurable).

---

## 5. Voir les agents travailler
L'utilisateur doit comprendre à chaque instant ce que fait l'agent.

### Flux en direct
- Texte de la réponse affiché au fil de l'eau.
- Raisonnement visible (repliable), quand le modèle le fournit.
- Chaque action d'outil apparaît comme une carte : lecture de fichier, recherche, modification, commande de terminal.
- Chaque carte montre son état : en attente, en cours, terminée, échouée.
- Les commandes de terminal s'exécutent dans le terminal intégré et leur sortie est visible.

### Modifications de code
- Les changements s'affichent comme des différences (diff) directement dans l'éditeur.
- L'utilisateur peut accepter ou refuser par fichier, par bloc ou en totalité.
- Un point de restauration est créé avant chaque série de modifications.
- Retour en arrière possible en un clic.

### Contrôle
- Boutons Arrêter, Pause et Reprendre.
- Demande de confirmation avant toute action risquée.
- Compteur visible : tokens, coût estimé, durée, nombre d'étapes.

---

## 6. Comportement équivalent à Cursor

| Fonction | Attendu |
| :--- | :--- |
| **Mode Agent** | L'IA planifie, lit, modifie, lance des commandes et corrige ses erreurs seule |
| **Mode Demander** | Questions sur le code, sans rien modifier |
| **Mode Plan** | L'IA écrit un plan, l'utilisateur le valide, puis l'exécution commence |
| **Contexte** | Citer des fichiers, dossiers, symboles et le terminal avec `@` |
| **Édition ciblée** | Sélectionner du code et demander une modification sur place |
| **Règles du projet** | Lecture automatique d'un fichier `AGENTS.md` ou d'un dossier de règles |
| **Mémoire de session** | Historique des conversations, reprise d'une session |
| **Boucle de vérification** | L'agent lance les tests ou le build et corrige ses erreurs |
| **Agents en parallèle** | Plusieurs agents en même temps, chacun dans son espace de travail isolé |
| **Outils externes** | Connexion à des serveurs MCP |

---

## 7. Onglets des agents
- **Barre d'activité** : une entrée *Agents* dans la barre latérale ouvrant la liste de tous les agents du projet.
- **Liste des agents** : nom, modèle utilisé, état, dernière activité, actions (créer, renommer, dupliquer, arrêter, supprimer).
- **Onglet d'un agent** : chaque agent s'ouvre dans son propre onglet de l'éditeur (conversation, cartes d'actions, diffs, compteur de coût).
- **Vue d'ensemble** : tableau de bord des agents actifs et progression.
- **Agents en parallèle** : branche Git ou git worktree dédié par agent, avertissement si collision sur les mêmes fichiers, fusion depuis l'interface.

---

## 8. Modifiable entièrement
- **Interface** : panneaux, disposition, thèmes et animations en TypeScript et CSS, variables de thème.
- **Prompts système** : fichiers texte modifiables, un par mode et par agent.
- **Outils de l'agent** : déclaration de nom, paramètres et fonction.
- **Fournisseurs** : ajout par un fichier unique.
- **Configuration** : fichier JSON documenté avec valeurs par défaut.
- **Documentation** : guide développeur « comment modifier » avec exemples.

---

## 9. Sécurité
- Clés dans le coffre sécurisé du système.
- Fichiers `.env` et secrets exclus par défaut.
- Confirmation obligatoire avant suppression de fichiers, `git push`, installation de paquets, accès réseau, commande sensible.
- 3 niveaux de permission : Demander toujours, Autoriser les actions sûres, Tout autoriser (isolé).
- Limites par agent (étapes, durée, budget tokens/argent).
- Détection de boucle et journal d'audit complet.

---

## 10. Critères d'acceptation (v1)
1. Ajout d'une clé DeepSeek, choix du modèle, réponse en streaming.
2. Ajout d'un profil Bedrock, choix région/modèle, réponse en streaming.
3. Mode Agent : l'IA corrige un test qui échoue en boucle jusqu'au succès.
4. Chaque action de l'agent visible en direct avec son état.
5. Modifications affichées en diff avec acceptation/rejet par bloc ou total.
6. Retour à un point de restauration fonctionnel.
7. Trois agents en parallèle dans leurs onglets et branches dédiés.
8. Bouton Arrêter réactif (< 2 secondes).
9. Action risquée = demande de confirmation.
10. Nouveau fournisseur ajoutable via un seul fichier.
11. Aucune clé dans les logs ou configs en clair.
12. Changement de modèle sans perte d'historique.

---

## 11. Organisation du code
```
src/vs/workbench/contrib/agents/
  common/      types, interfaces, configuration
  providers/   deepseek, bedrock, openai-compatible
  runtime/     boucle d'agent, outils, permissions, coûts
  browser/     panneau, onglets, cartes d'actions, diffs
  test/        tests unitaires et scénarios
```

*Flux des dépendances* : `browser` ➔ `runtime` ➔ `providers` ➔ `common` (jamais dans le sens inverse).

---

## 12. Jalons de développement
- **Jalon 0** : Fork compilé sans modification, build sur GitHub Actions (Éditeur de base qui démarre).
- **Jalon 1** : Nouvelle identité, Open VSX, télémétrie coupée (Éditeur renommé).
- **Jalon 2** : Interface des fournisseurs et DeepSeek (Chat simple avec streaming).
- **Jalon 3** : Amazon Bedrock et adaptateur compatible OpenAI (Trois fournisseurs).
- **Jalon 4** : Boucle d'agent, outils, terminal, diffs, points de restauration (Mode Agent complet).
- **Jalon 5** : Onglets des agents, liste, tableau de bord, agents en parallèle (Interface multi-agents).
- **Jalon 6** : Sécurité, budgets, journal d'audit (Version sûre).
- **Jalon 7** : Guide développeur et installeur (Version 1.0).
