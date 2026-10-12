/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IFileSnapshot {
	readonly path: string;
	readonly content: string | null; // null si le fichier n'existait pas encore
}

export interface ICheckpoint {
	readonly id: string;
	readonly timestamp: number;
	readonly description: string;
	readonly snapshots: Map<string, IFileSnapshot>;
}

export class CheckpointManager {
	private readonly _checkpoints: ICheckpoint[] = [];

	createCheckpoint(id: string, description: string): ICheckpoint {
		const checkpoint: ICheckpoint = {
			id,
			timestamp: Date.now(),
			description,
			snapshots: new Map()
		};
		this._checkpoints.push(checkpoint);
		return checkpoint;
	}

	recordFileState(checkpointId: string, filePath: string, originalContent: string | null): void {
		const cp = this._checkpoints.find(c => c.id === checkpointId);
		if (cp && !cp.snapshots.has(filePath)) {
			cp.snapshots.set(filePath, { path: filePath, content: originalContent });
		}
	}

	getCheckpoint(checkpointId: string): ICheckpoint | undefined {
		return this._checkpoints.find(c => c.id === checkpointId);
	}

	getLatestCheckpoint(): ICheckpoint | undefined {
		return this._checkpoints[this._checkpoints.length - 1];
	}

	listCheckpoints(): readonly ICheckpoint[] {
		return this._checkpoints;
	}
}
