/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Décodeur du format binaire `application/vnd.amazon.eventstream` utilisé par
 * `ConverseStream`. Module volontairement sans dépendance pour être testable seul.
 *
 * Trame : [longueur totale:4][longueur en-têtes:4][CRC prélude:4][en-têtes][charge utile][CRC message:4]
 * Tous les entiers sont en big-endian. Les deux CRC sont des CRC-32 (IEEE).
 */

export interface IEventStreamMessage {
	readonly headers: Readonly<Record<string, string | number | boolean>>;
	readonly payload: Uint8Array;
}

const CRC_TABLE: Uint32Array = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let k = 0; k < 8; k++) {
			c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
		}
		table[i] = c >>> 0;
	}
	return table;
})();

export function crc32(data: Uint8Array, start = 0, end = data.length): number {
	let crc = 0xFFFFFFFF;
	for (let i = start; i < end; i++) {
		crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
	}
	return (crc ^ 0xFFFFFFFF) >>> 0;
}

export class EventStreamError extends Error { }

export class EventStreamParser {
	private _buffer: Uint8Array = new Uint8Array(0);

	/** Ajoute des octets reçus et renvoie toutes les trames complètes disponibles. */
	feed(chunk: Uint8Array): IEventStreamMessage[] {
		const merged = new Uint8Array(this._buffer.length + chunk.length);
		merged.set(this._buffer, 0);
		merged.set(chunk, this._buffer.length);
		this._buffer = merged;

		const messages: IEventStreamMessage[] = [];
		while (this._buffer.length >= 12) {
			const view = new DataView(this._buffer.buffer, this._buffer.byteOffset, this._buffer.byteLength);
			const totalLength = view.getUint32(0, false);
			const headersLength = view.getUint32(4, false);
			const preludeCrc = view.getUint32(8, false);

			if (crc32(this._buffer, 0, 8) !== preludeCrc) {
				throw new EventStreamError('CRC du prélude invalide : flux eventstream corrompu.');
			}
			if (totalLength < 16 + headersLength) {
				throw new EventStreamError('Longueur de trame incohérente.');
			}
			if (this._buffer.length < totalLength) {
				break; // trame incomplète : attendre la suite
			}

			const messageCrc = view.getUint32(totalLength - 4, false);
			if (crc32(this._buffer, 0, totalLength - 4) !== messageCrc) {
				throw new EventStreamError('CRC du message invalide : flux eventstream corrompu.');
			}

			const headers = this._parseHeaders(this._buffer, 12, 12 + headersLength);
			const payload = this._buffer.slice(12 + headersLength, totalLength - 4);
			messages.push({ headers, payload });
			this._buffer = this._buffer.slice(totalLength);
		}
		return messages;
	}

	private _parseHeaders(data: Uint8Array, start: number, end: number): Record<string, string | number | boolean> {
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		const decoder = new TextDecoder('utf-8');
		const headers: Record<string, string | number | boolean> = {};
		let offset = start;

		while (offset < end) {
			const nameLength = data[offset++];
			const name = decoder.decode(data.subarray(offset, offset + nameLength));
			offset += nameLength;
			const type = data[offset++];

			switch (type) {
				case 0: headers[name] = true; break;
				case 1: headers[name] = false; break;
				case 2: headers[name] = view.getInt8(offset); offset += 1; break;
				case 3: headers[name] = view.getInt16(offset, false); offset += 2; break;
				case 4: headers[name] = view.getInt32(offset, false); offset += 4; break;
				case 5: headers[name] = Number(view.getBigInt64(offset, false)); offset += 8; break;
				case 6: { // octets
					const len = view.getUint16(offset, false);
					offset += 2 + len;
					break;
				}
				case 7: { // chaîne
					const len = view.getUint16(offset, false);
					offset += 2;
					headers[name] = decoder.decode(data.subarray(offset, offset + len));
					offset += len;
					break;
				}
				case 8: headers[name] = Number(view.getBigInt64(offset, false)); offset += 8; break; // horodatage
				case 9: offset += 16; break; // UUID
				default:
					throw new EventStreamError(`Type d'en-tête eventstream inconnu : ${type}`);
			}
		}
		return headers;
	}
}
