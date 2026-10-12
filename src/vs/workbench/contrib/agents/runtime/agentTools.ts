/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IToolDefinition } from '../common/agentTypes.js';

export const STANDARD_AGENT_TOOLS: readonly IToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: 'read_file',
			description: 'Lit le contenu d\'un fichier du projet.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Chemin relatif ou absolu du fichier.'
					}
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'write_file',
			description: 'Écrit ou crée un fichier avec le contenu spécifié.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Chemin du fichier à écrire.'
					},
					content: {
						type: 'string',
						description: 'Contenu complet du fichier.'
					}
				},
				required: ['path', 'content']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'edit_file',
			description: 'Remplace une portion ciblée d\'un fichier existant avec précision chirurgicale.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Chemin du fichier.'
					},
					old_text: {
						type: 'string',
						description: 'Texte exact à remplacer.'
					},
					new_text: {
						type: 'string',
						description: 'Nouveau texte de remplacement.'
					}
				},
				required: ['path', 'old_text', 'new_text']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'list_dir',
			description: 'Liste les fichiers et dossiers dans un répertoire.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Chemin du dossier à explorer.'
					}
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'search_in_files',
			description: 'Recherche un mot-clé ou une expression régulière dans tous les fichiers du projet (comme grep / ripgrep). Indispensable pour localiser où une fonctionnalité est définie ou appelée (ex: "archive", "pin", "pinned").',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'Terme ou motif regex recherché.'
					},
					maxResults: {
						type: 'number',
						description: 'Nombre maximal d\'occurrences renvoyées (défaut : 20).'
					}
				},
				required: ['query']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'run_command',
			description: 'Exécute une commande PowerShell dans l\'espace de travail et capture sa sortie.',
			parameters: {
				type: 'object',
				properties: {
					command: {
						type: 'string',
						description: 'Commande shell à exécuter.'
					}
				},
				required: ['command']
			}
		}
	}
];
