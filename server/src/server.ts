/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import {
	createConnection, TextDocuments, ProposedFeatures, TextDocumentSyncKind, CompletionItemKind, InsertTextFormat, Color, Range, CompletionItem, Position
} from 'vscode-languageserver';
import { EditorHelper, compileCode } from './compiler/compiler';

// Creates the LSP connection
let connection = createConnection(ProposedFeatures.all);

// Create a manager for open text documents
let documents = new TextDocuments();

// The workspace folder this server is operating on
let workspaceFolder: string | null;

documents.onDidOpen((event) => {
	connection.console.log(`[Server(${process.pid}) ${workspaceFolder}] Document opened: ${event.document.uri}`);
});

let lastHelpers: {[uri: string]: EditorHelper} = {};

documents.onDidChangeContent(e=>{
	console.log("CHANGED CONTENTS WOOO");
	compile(e.document.uri);
});

function compile(uri: string) {
	let helper = new EditorHelper();
	lastHelpers[uri] = helper;
	compileCode(documents.get(uri).getText(),uri,helper);
	let d = [];
	for (let dia of helper.diagnostics) {
		d.push(dia);
	}
	connection.sendDiagnostics({uri: uri,diagnostics: d});
}

connection.onCompletion((params,cancel)=>{
	let h = lastHelpers[params.textDocument.uri];
	if (!h) {
		console.log("no completion, compiling again...")
		compile(params.textDocument.uri);
		h = lastHelpers[params.textDocument.uri];
	}
	let completions: CompletionItem[] = [];
	for (let s of h.suggestions) {
		console.log("suggestion: " + s.value);
		if (isPositionInRange(s.range,params.position)) {
			console.log("added!")
			completions.push({
				label: s.value,
				detail: s.desc,
				kind: s.type
			})
		}
	}
	return completions;
});

function isPositionInRange(range: Range, pos: Position) {
	console.log("pos: " + JSON.stringify(pos) + ", range: " + JSON.stringify(range));
	return pos.line <= range.end.line && pos.line >= range.start.line && pos.character >= range.start.character && pos.character <= range.end.character;
}

documents.listen(connection);

connection.onInitialize((params) => {
	workspaceFolder = params.rootUri;
	connection.console.log(`[Server(${process.pid}) ${workspaceFolder}] Started and initialize received`);
	return {
		capabilities: {
			textDocumentSync: {
				openClose: true,
				change: TextDocumentSyncKind.Full
			},
			completionProvider: {
				resolveProvider: false,
				triggerCharacters: ['.','[','@','{','\n','=','(']
			}
		}
	};
});
connection.listen();