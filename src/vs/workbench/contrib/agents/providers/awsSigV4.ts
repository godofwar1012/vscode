/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Signature AWS Signature Version 4. Module sans dépendance (Web Crypto uniquement),
 * testable avec les vecteurs officiels de la suite de tests AWS.
 */

export interface ISigV4Request {
	readonly method: string;
	readonly host: string;
	/** Chemin tel qu'il sera envoyé (déjà encodé une fois). */
	readonly path: string;
	/** Chaîne de requête canonique (paramètres triés et encodés), sans « ? ». */
	readonly query?: string;
	/** En-têtes supplémentaires à signer (noms en minuscules). */
	readonly headers?: Readonly<Record<string, string>>;
	readonly body?: string;
	readonly region: string;
	readonly service: string;
	readonly accessKeyId: string;
	readonly secretAccessKey: string;
	readonly sessionToken?: string;
	/** Date de signature (injectable pour les tests). */
	readonly date?: Date;
}

export interface ISigV4Result {
	/** En-têtes à envoyer (hors `host`, géré par le runtime). */
	readonly headers: Record<string, string>;
	readonly signature: string;
	readonly canonicalRequest: string;
	readonly stringToSign: string;
	readonly signedHeaders: string;
}

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: string): Promise<string> {
	return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(data)));
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
	const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data)));
}

export async function deriveSigningKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Promise<Uint8Array> {
	const kDate = await hmac(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
	const kRegion = await hmac(kDate, region);
	const kService = await hmac(kRegion, service);
	return hmac(kService, 'aws4_request');
}

export function toHexString(bytes: Uint8Array): string {
	return toHex(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

export async function signRequest(req: ISigV4Request): Promise<ISigV4Result> {
	const payload = req.body ?? '';
	const now = req.date ?? new Date();
	const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
	const dateStamp = amzDate.substring(0, 8);

	const headers: Record<string, string> = { ...(req.headers ?? {}), 'host': req.host, 'x-amz-date': amzDate };
	if (req.sessionToken) {
		headers['x-amz-security-token'] = req.sessionToken;
	}

	const names = Object.keys(headers).map(h => h.toLowerCase()).sort();
	const lowered: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) {
		lowered[k.toLowerCase()] = v.trim().replace(/\s+/g, ' ');
	}
	const canonicalHeaders = names.map(h => `${h}:${lowered[h]}\n`).join('');
	const signedHeaders = names.join(';');

	// Hors S3, chaque segment du chemin est encodé une seconde fois.
	const canonicalUri = req.path.split('/').map(seg => encodeURIComponent(seg)).join('/') || '/';
	const canonicalRequest = [req.method, canonicalUri, req.query ?? '', canonicalHeaders, signedHeaders, await sha256Hex(payload)].join('\n');

	const scope = `${dateStamp}/${req.region}/${req.service}/aws4_request`;
	const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');

	const signingKey = await deriveSigningKey(req.secretAccessKey, dateStamp, req.region, req.service);
	const signature = toHexString(await hmac(signingKey, stringToSign));

	const outHeaders: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) {
		if (k.toLowerCase() !== 'host') {
			outHeaders[k] = v;
		}
	}
	outHeaders['Authorization'] = `AWS4-HMAC-SHA256 Credential=${req.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

	return { headers: outHeaders, signature, canonicalRequest, stringToSign, signedHeaders };
}
