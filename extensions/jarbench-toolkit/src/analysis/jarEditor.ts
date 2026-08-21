/*---------------------------------------------------------------------------------------------
 *  JarBench Toolkit — jar viewer custom editor.
 *
 *  Modeled on extensions/media-preview's CustomReadonlyEditorProvider + webview pattern.
 *  Lists a jar's entries, shows its MANIFEST.MF, and reports a signature-based verdict with
 *  the concrete matched entries as evidence, rather than a bare label.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import { readCentralDirectory, readEntryData, findEntry } from './zipReader';
import { matchSignatures, summarizeVerdict } from './signatures';
import { hashFile, loadFingerprintDb, lookupFingerprint } from './fingerprintDb';

export class JarEditorProvider implements vscode.CustomReadonlyEditorProvider {
	public static readonly viewType = 'jarbench.jarViewer';

	constructor(private readonly context: vscode.ExtensionContext) { }

	public async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
		return { uri, dispose: () => { } };
	}

	public async resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
		webviewPanel.webview.options = { enableScripts: true };
		webviewPanel.webview.html = this.renderLoading();

		try {
			const html = await this.renderJar(document.uri, webviewPanel.webview);
			webviewPanel.webview.html = html;
		} catch (err) {
			webviewPanel.webview.html = this.renderError(err instanceof Error ? err.message : String(err));
		}
	}

	private renderLoading(): string {
		return `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:1em;">Analyzing jar…</body></html>`;
	}

	private renderError(message: string): string {
		return `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:1em;color:var(--vscode-errorForeground);">
			<h3>Could not read this jar</h3><pre>${escapeHtml(message)}</pre></body></html>`;
	}

	private async renderJar(uri: vscode.Uri, _webview: vscode.Webview): Promise<string> {
		const buf = await fs.promises.readFile(uri.fsPath);
		const entries = readCentralDirectory(buf);
		const entryPaths = entries.filter(e => !e.isDirectory).map(e => e.name);

		let manifestText: string | undefined;
		const manifestEntry = findEntry(entries, 'META-INF/MANIFEST.MF');
		if (manifestEntry) {
			try {
				manifestText = readEntryData(buf, manifestEntry).toString('utf8');
			} catch {
				manifestText = undefined;
			}
		}

		const matches = matchSignatures(entryPaths);
		const verdict = summarizeVerdict(matches, entryPaths.length);

		const sha256 = hashFile(buf);
		const fingerprintDb = await loadFingerprintDb(this.context);
		const fingerprint = lookupFingerprint(fingerprintDb, sha256);

		const evidenceHtml = matches.map(m => `
			<div class="sig">
				<div class="sig-header"><strong>${escapeHtml(m.signature.label)}</strong> <span class="count">${m.count} matching ${m.count === 1 ? 'entry' : 'entries'}</span></div>
				<ul>${m.evidence.map(e => `<li><code>${escapeHtml(e)}</code></li>`).join('')}</ul>
			</div>`).join('') || '<p class="muted">No signature matches — see verdict above.</p>';

		const entryListHtml = entryPaths.slice(0, 2000).map(e => `<li><code>${escapeHtml(e)}</code></li>`).join('');
		const truncatedNote = entryPaths.length > 2000 ? `<p class="muted">Showing first 2000 of ${entryPaths.length} entries.</p>` : '';

		return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
	body { font-family: var(--vscode-font-family); padding: 1em; color: var(--vscode-foreground); }
	h2, h3 { font-weight: 600; }
	.verdict { padding: 0.75em 1em; border-left: 3px solid var(--vscode-focusBorder); background: var(--vscode-textBlockQuote-background); margin-bottom: 1em; }
	.sig { margin-bottom: 0.75em; }
	.sig-header .count { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
	.muted { color: var(--vscode-descriptionForeground); }
	ul { max-height: 220px; overflow-y: auto; margin: 0.25em 0; padding-left: 1.4em; }
	pre { background: var(--vscode-textCodeBlock-background); padding: 0.75em; overflow-x: auto; }
	.fingerprint { font-family: var(--vscode-editor-font-family); font-size: 0.85em; color: var(--vscode-descriptionForeground); }
	details summary { cursor: pointer; font-weight: 600; margin: 0.5em 0; }
</style>
</head>
<body>
	<h2>JarBench: Analysis</h2>
	<div class="verdict"><strong>Verdict:</strong> ${escapeHtml(verdict)}</div>

	${fingerprint ? `<div class="verdict"><strong>Known jar match:</strong> ${escapeHtml(fingerprint.label)}${fingerprint.notes ? ` — ${escapeHtml(fingerprint.notes)}` : ''}</div>` : ''}
	<p class="fingerprint">SHA-256: ${sha256}${fingerprint ? '' : ' (no match in fingerprint database)'}</p>

	<h3>Evidence</h3>
	${evidenceHtml}

	${manifestText ? `<details open><summary>META-INF/MANIFEST.MF</summary><pre>${escapeHtml(manifestText)}</pre></details>` : '<p class="muted">No META-INF/MANIFEST.MF entry found.</p>'}

	<details>
		<summary>All entries (${entryPaths.length})</summary>
		${truncatedNote}
		<ul>${entryListHtml}</ul>
	</details>
</body>
</html>`;
	}
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch] as string));
}
