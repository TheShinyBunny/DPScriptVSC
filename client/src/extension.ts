/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as path from 'path';
import {
	workspace as Workspace, window as Window, ExtensionContext, TextDocument, OutputChannel, WorkspaceFolder, Uri, languages, StatusBarAlignment, StatusBarItem, ThemeColor, commands, QuickPickItem, SemanticTokensBuilder, SemanticTokens,
} from 'vscode';

import {
	LanguageClient, LanguageClientOptions, TransportKind, ServerOptions
} from 'vscode-languageclient';
import { debugPort } from 'process';

let defaultClient: LanguageClient;
let clients: Map<string, LanguageClient> = new Map();

let _sortedWorkspaceFolders: string[] | undefined;
function sortedWorkspaceFolders(): string[] {
	if (_sortedWorkspaceFolders === void 0) {
		_sortedWorkspaceFolders = Workspace.workspaceFolders ? Workspace.workspaceFolders.map(folder => {
			let result = folder.uri.toString();
			if (result.charAt(result.length - 1) !== '/') {
				result = result + '/';
			}
			return result;
		}).sort(
			(a, b) => {
				return a.length - b.length;
			}
		) : [];
	}
	return _sortedWorkspaceFolders;
}
Workspace.onDidChangeWorkspaceFolders(() => _sortedWorkspaceFolders = undefined);

function getOuterMostWorkspaceFolder(folder: WorkspaceFolder): WorkspaceFolder {
	let sorted = sortedWorkspaceFolders();
	for (let element of sorted) {
		let uri = folder.uri.toString();
		if (uri.charAt(uri.length - 1) !== '/') {
			uri = uri + '/';
		}
		if (uri.startsWith(element)) {
			return Workspace.getWorkspaceFolder(Uri.parse(element))!;
		}
	}
	return folder;
}


function getDocumentClient(doc: TextDocument): LanguageClient {
	let folder = Workspace.getWorkspaceFolder(doc.uri);
	if (!folder) return;
	folder = getOuterMostWorkspaceFolder(folder);
	return clients.get(folder.uri.toString());
}

let outputChannel: OutputChannel = Window.createOutputChannel('dpscript');

let createDatapackButton: StatusBarItem;

interface DatapackBuildMode extends QuickPickItem {
	id: string
}

export function activate(context: ExtensionContext) {

	let module = context.asAbsolutePath(path.join('server', 'out', 'server.js'));

	function didOpenTextDocument(document: TextDocument): void {
		// We are only interested in language mode text
		if (document.languageId !== 'dpscript' || (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled')) {
			return;
		}

		let uri = document.uri;
		// Untitled files go to a default client.
		if (uri.scheme === 'untitled' && !defaultClient) {
			defaultClient = createClient(module);
			return;
		}
		let folder = Workspace.getWorkspaceFolder(uri);
		// Files outside a folder can't be handled. This might depend on the language.
		// Single file languages like JSON might handle files outside the workspace folders.
		if (!folder) {
			return;
		}
		// If we have nested workspace folders we only start a server on the outer most workspace folder.
		folder = getOuterMostWorkspaceFolder(folder);

		if (!clients.has(folder.uri.toString())) {
			let client = createClient(module,folder)
			clients.set(folder.uri.toString(), client);
		}
		if (!createDatapackButton) {
			createDatapackButton = Window.createStatusBarItem(StatusBarAlignment.Left);
			createDatapackButton.text = "$(rocket) Build Datapack (dpscript)";
			createDatapackButton.command = 'dpscript.build'
			createDatapackButton.show()
		}
	}

	Workspace.onDidOpenTextDocument(didOpenTextDocument);
	Workspace.textDocuments.forEach(didOpenTextDocument);
	Workspace.onDidChangeWorkspaceFolders((event) => {
		for (let folder  of event.removed) {
			let client = clients.get(folder.uri.toString());
			if (client) {
				clients.delete(folder.uri.toString());
				client.stop();
			}
		}
	});
	context.subscriptions.push(commands.registerTextEditorCommand('dpscript.build',(editor,edit)=>{
		let client = getDocumentClient(editor.document);
		if (client) {
			let qp = Window.createQuickPick<DatapackBuildMode>();
			qp.items = [
				{
					id: "zip",
					label: "Zip File",
					description: "Generate a ZIP file for the datapack"
				},
				{
					id: "dir",
					label: "Directory",
					description: "Generate the datapack in the current directory (pack.mcmeta + data dir)"
				}
			]
			qp.title = "How would you like to create the datapack?";
			qp.onDidChangeSelection((e)=>{
				if (e[0]) {
					client.sendRequest('build-datapack',e[0].id).then((res)=>{
						if (!res) {
							Window.showErrorMessage('Unable to generate the datapack!')
						}
						qp.dispose()
					})
				}
			});
			qp.show()
		}
		
	}));

	languages.registerDocumentSemanticTokensProvider('dpscript',{
		provideDocumentSemanticTokens: async (doc)=>{
			let client = getDocumentClient(doc);
			if (client) {
				let res: any = await client.sendRequest('semantic-tokens',doc.uri.toString());
				return new SemanticTokens(new Uint32Array(res.data))
			}
		}
	},{
		tokenTypes: ['comment','string','keyword','number','regexp','operator','namespace','type','struct','class','interface','enum','typeParameter','function','member','macro','variable','constant','parameter','property','label','enumMember','event'],
		tokenModifiers: ['declaration','documentation','static','abstract','deprecated','modification','async','readonly']
	})
	
}

function createClient(module: string, folder?: WorkspaceFolder):LanguageClient {
	let debugOptions = { execArgv: ["--nolazy", `--inspect=${6011 + clients.size}`] };
	let serverOptions: ServerOptions = {
		run: { module, transport: TransportKind.ipc },
		debug: { module, transport: TransportKind.ipc, options: debugOptions}
	};
	let clientOptions: LanguageClientOptions = {
		documentSelector: [
			{ scheme: folder ? 'file' : 'untitled', language: 'dpscript' }
		],
		diagnosticCollectionName: 'dpscript',
		workspaceFolder: folder,
		outputChannel: outputChannel
	};
	let client = new LanguageClient("dpscript","DPScript Language Server",serverOptions,clientOptions);
	client.start();
	return client;
}

export function deactivate(): Thenable<void> {
	let promises: Thenable<void>[] = [];
	if (defaultClient) {
		promises.push(defaultClient.stop());
	}
	for (let client of clients.values()) {
		promises.push(client.stop());
	}
	return Promise.all(promises).then(() => undefined);
}