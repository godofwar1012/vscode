/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ICodeChunk {
	readonly id: string;
	readonly filePath: string;
	readonly startLine: number;
	readonly endLine: number;
	readonly content: string;
	readonly symbols: readonly string[];
}

export interface ISearchResult {
	readonly chunk: ICodeChunk;
	readonly score: number;
}

export class CodebaseIndexer {
	private readonly _chunks: ICodeChunk[] = [];
	private readonly _invertedIndex = new Map<string, Set<number>>(); // term -> Set<chunkIndex>
	private readonly _docLengths: number[] = [];
	private _avgDocLength = 0;

	indexFile(filePath: string, content: string): void {
		const lines = content.split('\n');
		const chunkSize = 40;
		const overlap = 10;

		for (let i = 0; i < lines.length; i += (chunkSize - overlap)) {
			const slice = lines.slice(i, i + chunkSize);
			if (slice.length === 0) {
				break;
			}

			const chunkText = slice.join('\n');
			const symbols = this._extractSymbols(chunkText);
			const chunkIndex = this._chunks.length;

			const chunk: ICodeChunk = {
				id: `${filePath}#${i + 1}-${i + slice.length}`,
				filePath,
				startLine: i + 1,
				endLine: i + slice.length,
				content: chunkText,
				symbols
			};

			this._chunks.push(chunk);

			// Indexation des termes (mots-clés + symboles)
			const terms = this._tokenize(chunkText);
			this._docLengths.push(terms.length);

			for (const term of terms) {
				let posting = this._invertedIndex.get(term);
				if (!posting) {
					posting = new Set();
					this._invertedIndex.set(term, posting);
				}
				posting.add(chunkIndex);
			}
		}

		const totalLength = this._docLengths.reduce((a, b) => a + b, 0);
		this._avgDocLength = this._docLengths.length > 0 ? totalLength / this._docLengths.length : 0;
	}

	search(query: string, topK: number = 8): readonly ISearchResult[] {
		const queryTerms = this._tokenize(query);
		if (queryTerms.length === 0 || this._chunks.length === 0) {
			return [];
		}

		const scores = new Map<number, number>();
		const totalDocs = this._chunks.length;
		const k1 = 1.2;
		const b = 0.75;

		for (const term of queryTerms) {
			const postings = this._invertedIndex.get(term);
			if (!postings) {
				continue;
			}

			const docFreq = postings.size;
			// Inverse Document Frequency (IDF)
			const idf = Math.log(1 + (totalDocs - docFreq + 0.5) / (docFreq + 0.5));

			for (const docIdx of postings) {
				const docLen = this._docLengths[docIdx] || 1;
				// Approximation simple du TF dans ce chunk
				const tf = 1;
				const termScore = idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / (this._avgDocLength || 1)))));
				scores.set(docIdx, (scores.get(docIdx) || 0) + termScore);
			}
		}

		const results: ISearchResult[] = [];
		for (const [idx, score] of scores.entries()) {
			results.push({
				chunk: this._chunks[idx],
				score
			});
		}

		return results.sort((a, b) => b.score - a.score).slice(0, topK);
	}

	private _extractSymbols(text: string): string[] {
		const symbols: string[] = [];
		const regex = /(?:class|function|interface|const|let|var|type|def|fn)\s+([a-zA-Z0-9_$]+)/g;
		let match: RegExpExecArray | null;
		while ((match = regex.exec(text)) !== null) {
			symbols.push(match[1]);
		}
		return symbols;
	}

	private _tokenize(text: string): string[] {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9_$]/g, ' ')
			.split(/\s+/)
			.filter(t => t.length > 2);
	}

	getChunkCount(): number {
		return this._chunks.length;
	}
}
