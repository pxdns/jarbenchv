/*---------------------------------------------------------------------------------------------
 *  JarBench Toolkit — "JarBench Insights" sidebar view.
 *
 *  Runs the same signature scan used for jars against a workspace's source tree (Java/Kotlin
 *  package directories double as the "entry paths" the signature table matches on) plus any
 *  build.gradle(.kts) content, and separately scans a bounded number of jars reachable in the
 *  workspace (e.g. libs/, build/libs/). Surfaced as evidence-backed tree items, not a bare label.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import { matchSignatures, summarizeVerdict, MatchedSignature } from './signatures';
import { readCentralDirectory } from './zipReader';

class InsightItem extends vscode.TreeItem {
	constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState, description?: string) {
		super(label, collapsibleState);
		this.description = description;
	}
}

interface FolderScanResult {
	folder: vscode.WorkspaceFolder;
	verdict: string;
	matches: MatchedSignature[];
	gradleInfo: string[];
	jarResults: { path: string; verdict: string; matches: MatchedSignature[] }[];
}

const SOURCE_EXCLUDE = '**/{node_modules,.git,.gradle,build,out,bin,target}/**';

export class WorkspaceInsightsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private cache: FolderScanResult[] | undefined;
	private scanning = false;

	public refresh(): void {
		this.cache = undefined;
		this._onDidChangeTreeData.fire();
	}

	public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	public async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
		if (!element) {
			const results = await this.ensureScanned();
			if (results.length === 0) {
				return [new InsightItem('No workspace folder open', vscode.TreeItemCollapsibleState.None)];
			}
			return results.map(r => {
				const item = new InsightItem(r.folder.name, vscode.TreeItemCollapsibleState.Expanded, r.verdict);
				(item as any).jarbenchResult = r;
				item.contextValue = 'jarbenchFolder';
				return item;
			});
		}

		const result: FolderScanResult | undefined = (element as any).jarbenchResult;
		if (result) {
			const items: vscode.TreeItem[] = [];
			for (const m of result.matches) {
				items.push(new InsightItem(m.signature.label, vscode.TreeItemCollapsibleState.None, `${m.count} matching path(s)`));
			}
			for (const info of result.gradleInfo) {
				items.push(new InsightItem(info, vscode.TreeItemCollapsibleState.None));
			}
			for (const jar of result.jarResults) {
				items.push(new InsightItem(jar.path, vscode.TreeItemCollapsibleState.None, jar.verdict));
			}
			if (items.length === 0) {
				items.push(new InsightItem('No signatures detected', vscode.TreeItemCollapsibleState.None));
			}
			return items;
		}

		return [];
	}

	private async ensureScanned(): Promise<FolderScanResult[]> {
		if (this.cache) {
			return this.cache;
		}
		if (this.scanning) {
			return [];
		}
		this.scanning = true;
		try {
			const folders = vscode.workspace.workspaceFolders ?? [];
			const results: FolderScanResult[] = [];
			for (const folder of folders) {
				results.push(await this.scanFolder(folder));
			}
			this.cache = results;
			return results;
		} finally {
			this.scanning = false;
		}
	}

	private async scanFolder(folder: vscode.WorkspaceFolder): Promise<FolderScanResult> {
		const sourceFiles = await vscode.workspace.findFiles(
			new vscode.RelativePattern(folder, '**/*.{java,kt}'),
			SOURCE_EXCLUDE,
			5000
		);
		const dirPaths = new Set<string>();
		for (const uri of sourceFiles) {
			const rel = vscode.workspace.asRelativePath(uri, false);
			// Fold source-root prefixes (src/main/java/, src/main/kotlin/) so the remaining path looks like a package path, matching how signatures.ts expects jar-entry-style paths.
			const folded = rel.replace(/^.*?src\/(?:main|test)\/(?:java|kotlin)\//, '');
			const dir = folded.substring(0, folded.lastIndexOf('/') + 1);
			if (dir.length > 0) {
				dirPaths.add(dir);
			}
		}
		const matches = matchSignatures(Array.from(dirPaths));
		const verdict = summarizeVerdict(matches, dirPaths.size);

		const gradleInfo = await this.scanGradleFiles(folder);

		const jarUris = await vscode.workspace.findFiles(
			new vscode.RelativePattern(folder, '**/*.jar'),
			SOURCE_EXCLUDE,
			20
		);
		const jarResults: FolderScanResult['jarResults'] = [];
		for (const jarUri of jarUris) {
			try {
				const buf = await fs.promises.readFile(jarUri.fsPath);
				const entries = readCentralDirectory(buf).filter(e => !e.isDirectory).map(e => e.name);
				const jarMatches = matchSignatures(entries);
				jarResults.push({
					path: vscode.workspace.asRelativePath(jarUri, false),
					verdict: summarizeVerdict(jarMatches, entries.length),
					matches: jarMatches
				});
			} catch {
				// unreadable/corrupt jar - skip
			}
		}

		return { folder, verdict, matches, gradleInfo, jarResults };
	}

	private async scanGradleFiles(folder: vscode.WorkspaceFolder): Promise<string[]> {
		const info: string[] = [];
		for (const name of ['build.gradle', 'build.gradle.kts']) {
			try {
				const content = await fs.promises.readFile(vscode.Uri.joinPath(folder.uri, name).fsPath, 'utf8');
				const mcVersion = content.match(/minecraft_version\s*=\s*['"]([\w.\-]+)['"]/) ?? content.match(/minecraft\s*['"]([\w.\-]+)['"]/);
				if (mcVersion) {
					info.push(`Gradle declares Minecraft version: ${mcVersion[1]}`);
				}
				if (/fabric-loom|net\.fabricmc/.test(content)) {
					info.push('Gradle build uses the Fabric Loom plugin');
				}
				if (/net\.minecraftforge|ForgeGradle/.test(content)) {
					info.push('Gradle build uses ForgeGradle');
				}
				if (/eaglercraft/i.test(content)) {
					info.push('Gradle build references Eaglercraft');
				}
			} catch {
				// file doesn't exist - fine
			}
		}
		return info;
	}
}
