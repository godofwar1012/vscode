/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IPatchBlock {
	readonly search: string;
	readonly replace: string;
}

export interface IPatchResult {
	readonly success: boolean;
	readonly modifiedContent: string;
	readonly appliedBlocksCount: number;
	readonly failedBlocks: readonly IPatchBlock[];
}

export class SurgicalPatcher {
	/**
	 * Extrait les blocs de recherche et remplacement au format robuste Aider :
	 * <<<<<<< SEARCH
	 * ... code original ...
	 * =======
	 * ... code modifié ...
	 * >>>>>>> REPLACE
	 */
	static parseBlocks(patchText: string): IPatchBlock[] {
		const blocks: IPatchBlock[] = [];
		const regex = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;

		let match: RegExpExecArray | null;
		while ((match = regex.exec(patchText)) !== null) {
			blocks.push({
				search: match[1],
				replace: match[2]
			});
		}

		return blocks;
	}

	/**
	 * Applique chirurgicalement les blocs sur le contenu original du fichier
	 */
	static applyPatch(originalContent: string, patchText: string): IPatchResult {
		const blocks = this.parseBlocks(patchText);
		if (blocks.length === 0) {
			return {
				success: false,
				modifiedContent: originalContent,
				appliedBlocksCount: 0,
				failedBlocks: []
			};
		}

		let currentContent = originalContent;
		let appliedCount = 0;
		const failedBlocks: IPatchBlock[] = [];

		for (const block of blocks) {
			// Recherche exacte d'abord
			if (currentContent.includes(block.search)) {
				currentContent = currentContent.replace(block.search, block.replace);
				appliedCount++;
				continue;
			}

			// Recherche avec tolérance sur les retours à la ligne CRLF/LF
			const normalizedOriginal = currentContent.replace(/\r\n/g, '\n');
			const normalizedSearch = block.search.replace(/\r\n/g, '\n');

			if (normalizedOriginal.includes(normalizedSearch)) {
				currentContent = normalizedOriginal.replace(normalizedSearch, block.replace.replace(/\r\n/g, '\n'));
				appliedCount++;
				continue;
			}

			// Recherche floue tolérante aux espaces/indentations de fin de ligne
			const trimmedSearchLines = block.search.split('\n').map(l => l.trimEnd());
			const contentLines = currentContent.split('\n');

			let foundIndex = -1;
			for (let i = 0; i <= contentLines.length - trimmedSearchLines.length; i++) {
				let allMatch = true;
				for (let j = 0; j < trimmedSearchLines.length; j++) {
					if (contentLines[i + j].trimEnd() !== trimmedSearchLines[j]) {
						allMatch = false;
						break;
					}
				}
				if (allMatch) {
					foundIndex = i;
					break;
				}
			}

			if (foundIndex !== -1) {
				const before = contentLines.slice(0, foundIndex);
				const after = contentLines.slice(foundIndex + trimmedSearchLines.length);
				const replacementLines = block.replace.split('\n');
				currentContent = [...before, ...replacementLines, ...after].join('\n');
				appliedCount++;
			} else {
				failedBlocks.push(block);
			}
		}

		return {
			success: failedBlocks.length === 0,
			modifiedContent: currentContent,
			appliedBlocksCount: appliedCount,
			failedBlocks
		};
	}
}
