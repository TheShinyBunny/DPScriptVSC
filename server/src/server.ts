/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import {
	createConnection, TextDocuments, ProposedFeatures, TextDocumentSyncKind, Range, CompletionItem, Position, TextDocumentIdentifier, MarkupKind, MarkedString, Hover, InsertTextFormat, ColorPresentation, SymbolInformation, DocumentHighlightKind, DocumentHighlight, ServerCapabilities, Proposed, FileChangeType, WorkspaceFolder
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument'
import { Datapack, DPScriptFile } from './compiler_new/project';
import { FileUtil } from './compiler_new/files';
import { GenContext } from './compiler_new/generate';
import { ProcessContext } from './compiler_new/process';
import { initRegistries } from './compiler_new/registry/registry';

// Creates the LSP connection
let connection = createConnection(ProposedFeatures.all);

// Create a manager for open text documents
let documents = new TextDocuments(TextDocument);

// The workspace folder this server is operating on
let workspaceFolder: WorkspaceFolder;

export let currentProject: Datapack

export function rangeContains(range: Range, pos: Position) {
	return range.start.line == pos.line && range.start.character <= pos.character && range.end.character >= pos.character
}

documents.onDidOpen((event) => {
	connection.console.log(`[Server(${process.pid}) ${workspaceFolder}] Document opened: ${event.document.uri}`);
	if (event.document.languageId == 'dpscript') {
		if (!currentProject.files.find(f=>f.uri == event.document.uri)) {
			currentProject.files.push(new DPScriptFile(event.document.uri,event.document.getText()))
		}
	}
});

documents.onDidChangeContent(e=>{
	let file = currentProject.files.find(f=>f.uri == e.document.uri)
	if (file) {
		connection.console.log('changed content, recompiling ' + file.uri)
		file.diagnostics = []
		file.hovers = []
		file.text = e.document.getText()
		let script = file.compile()
		/* let p = new ProcessContext(script)
		script.process(p) */
		file.ast = script

		connection.sendDiagnostics({uri: file.uri,diagnostics: file.diagnostics})
	}
});

connection.onDidChangeWatchedFiles(params=>{
	for (let c of params.changes) {
		if (c.type == FileChangeType.Deleted) {
			currentProject.files = currentProject.files.filter(f=>f.uri == c.uri)
		}
	}
})

documents.onDidSave(e=>{
	console.log('saved a file, generating datapack...')
	currentProject.generate()
})

connection.onCompletion((params,cancel)=>{
	let file = currentProject.files.find(f=>f.uri == params.textDocument.uri)
	if (file) {
		console.log('getting completion at',params.position)
		file.suggestions = []
		file.cursorPos = params.position
		file.compile();
		file.cursorPos = undefined
		return file.suggestions.map(s=>({label: s.value,detail: s.detail,documentation: s.desc,kind: s.kind}))
	}
});

connection.onHover(hp=>{
	let file = currentProject.files.find(f=>f.uri == hp.textDocument.uri)
	if (file) {
		console.log('getting hover at',hp.position)
		return file.hovers.find(h=>rangeContains(h.range,hp.position))
	}
})



/*
connection.onDocumentColor(p=>{
	
})

connection.onSignatureHelp(sh=>{
	
});



connection.onColorPresentation(p=>{
	
})

connection.onDocumentSymbol(p=>{
	
});

connection.onDocumentHighlight(p=>{
	
})

connection.onDocumentLinks(p=>{

})

connection.onDefinition(p=>{
	
})


connection.onImplementation(p=>{
	
}); */

export enum SemanticType {
	comment,
	string,
	keyword,
	number,
	regexp,
	operator,
	namespace,
	type,
	struct,
	class,
	interface,
	enum,
	typeParameter,
	function,
	member,
	macro,
	variable,
	constant,
	parameter,
	property,
	label,
	enumMember,
	event
}

export enum SemanticModifier {
	declaration,
	documentation,
	static,
	abstract,
	deprecated,
	modification,
	async,
	readonly
}

export interface SemanticToken {
	range: Range
	type: SemanticType
	modifier: SemanticModifier
}
/* 
connection.languages.semanticTokens.on((params)=>{
	return buildSemanticTokens(params.textDocument);
})


function buildSemanticTokens(doc: TextDocumentIdentifier): Proposed.SemanticTokens {
	let h = getHelper(doc);
	let data: number[] = [];
	let lastLine = 0;
	let lastChar = 0;
	for (let st of h.semantics.sort((s1,s2)=>{
		return s1.range.start.line == s2.range.start.line ? s1.range.start.character - s2.range.start.character : s1.range.start.line - s2.range.start.line
	})) {
		if (st.range.start.character == -1 || st.range.end.character == -1) continue
		if (lastLine != st.range.start.line) {
			lastChar = 0;
		}
		data.push(st.range.start.line - lastLine);
		data.push(st.range.start.character - lastChar);
		data.push(st.range.end.character - st.range.start.character);
		data.push(st.type);
		data.push(st.modifier || 0);
		lastChar = st.range.start.character;
		lastLine = st.range.start.line;
	}
	return {
		data
	};
} */

export enum BuildMode {
	zip,
	dir
}
/* 
connection.onRequest('build-datapack',(mode)=>{
	let m = BuildMode[mode];
	if (m === undefined) return false;
	if (project) {
		project.build(BuildMode[m]);
		return true;
	}
	return false;
});
 */

export function isPositionInRange(range: Range, pos: Position) {
	return pos.line <= range.end.line && pos.line >= range.start.line && pos.character >= range.start.character && pos.character <= range.end.character;
}

documents.listen(connection);

connection.onInitialize((params) => {
	workspaceFolder = params.workspaceFolders[0]
	currentProject = new Datapack(workspaceFolder.uri,workspaceFolder.name);
	connection.console.log(`[Server(${process.pid}) ${workspaceFolder.uri}] Started and initialize received`);
	initRegistries()
	return {
		capabilities: {
			textDocumentSync: {
				save: {
					includeText: true
				},
				openClose: true,
				change: TextDocumentSyncKind.Full
			},
			completionProvider: {
				resolveProvider: false,
				triggerCharacters: ['.','[','@','{','\n','=','(',' ',',','/']
			},
			colorProvider: true,
			signatureHelpProvider: {
				triggerCharacters: ['(',',']
			},
			hoverProvider: true,
			documentSymbolProvider: true,
			documentHighlightProvider: true,
			documentLinkProvider: {},
			implementationProvider: true,
			definitionProvider: true,
			semanticTokensProvider: {
				legend: {
					tokenTypes: Object.keys(SemanticType),
					tokenModifiers: Object.keys(SemanticModifier)
				},
				documentProvider: {
					edits: false
				}
			}
		}
	};
});

connection.listen();