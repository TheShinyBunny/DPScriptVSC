/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as path from 'path';
import {
	workspace as Workspace, window as Window, ExtensionContext, TextDocument, OutputChannel, WorkspaceFolder, Uri, languages
} from 'vscode';

import {
	LanguageClient, LanguageClientOptions, TransportKind, ServerOptions
} from 'vscode-languageclient';

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


let outputChannel: OutputChannel = Window.createOutputChannel('dpscript');

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