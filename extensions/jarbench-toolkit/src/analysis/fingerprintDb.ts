/*---------------------------------------------------------------------------------------------
 *  JarBench Toolkit — known-jar SHA-256 fingerprint lookup.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';

export interface FingerprintEntry {
	label: string;
	notes?: string;
}

interface FingerprintFile {
	entries: Record<string, FingerprintEntry>;
}

export function hashFile(buf: Buffer): string {
	return crypto.createHash('sha256').update(buf).digest('hex');
}

function bundledDbPath(context: vscode.ExtensionContext): string {
	return path.join(context.extensionPath, 'data', 'jar-fingerprints.json');
}

export async function loadFingerprintDb(context: vscode.ExtensionContext, workspaceFolder?: vscode.WorkspaceFolder): Promise<Record<string, FingerprintEntry>> {
	const configured = vscode.workspace.getConfiguration('jarbench', workspaceFolder?.uri).get<string>('jarFingerprintDb', '');
	const dbPath = configured && configured.length > 0
		? (path.isAbsolute(configured) ? configured : path.join(workspaceFolder?.uri.fsPath ?? '', configured))
		: bundledDbPath(context);

	try {
		const raw = await fs.promises.readFile(dbPath, 'utf8');
		const parsed = JSON.parse(raw) as FingerprintFile;
		return parsed.entries ?? {};
	} catch {
		return {};
	}
}

export function lookupFingerprint(db: Record<string, FingerprintEntry>, sha256: string): FingerprintEntry | undefined {
	return db[sha256.toLowerCase()];
}
