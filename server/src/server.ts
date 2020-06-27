/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import {
	createConnection, TextDocuments, ProposedFeatures, TextDocumentSyncKind, Range, CompletionItem, Position, TextDocumentIdentifier, MarkupKind, MarkedString, Hover, InsertTextFormat, ColorPresentation, SymbolInformation, DocumentHighlightKind, DocumentHighlight, Declaration
} from 'vscode-languageserver';
import './compiler/registries'
import { EditorHelper, compileCode, SignatureParameter, DPScript, evaulateScript, SymbolInfo } from './compiler/compiler';
import * as uris from 'vscode-uri';
import { DatapackProject } from './compiler';
import * as path from 'path';
import { uriToFilePath } from 'vscode-languageserver/lib/files';
import * as fs from 'fs';

// Creates the LSP connection
let connection = createConnection(ProposedFeatures.all);

// Create a manager for open text documents
let documents = new TextDocuments();

// The workspace folder this server is operating on
let workspaceFolder: string | null;

export let project: DatapackProject

documents.onDidOpen((event) => {
	connection.console.log(`[Server(${process.pid}) ${workspaceFolder}] Document opened: ${event.document.uri}`);
});

documents.onDidChangeContent(e=>{
	console.log("changed contents, compiling file...");
	lastHelpers[e.document.uri] = undefined;
	let h = new EditorHelper();
	compileAndEval(e.document.uri,h);
	let d = [];
	for (let dia of h.diagnostics) {
		if (dia.range.start.line < 0) {
			console.log("negative line diagnositc: " + JSON.stringify(dia));
		} else {
			d.push(dia);
		}
	}
	connection.sendDiagnostics({uri: e.document.uri,diagnostics: d});
});

documents.onDidSave(e=>{
	for (let d of documents.all()) {
		let script = scripts[d.uri];
		if (!script) {
			compile(d.uri);
		}
	}
	for (let s of Object.keys(scripts)) {
		let script = scripts[s];
		evaulateScript(script);
	}
})

let lastHelpers: {[uri: string]: EditorHelper} = {};

let scripts: {[uri: string]: DPScript} = {};

export function getScript(path: string) {
	let uri = uris.URI.file(path).toString();
	let script = scripts[uri];
	if (script) return script;
	script = compile(uri);
	console.log(script);
	return script;
}

function compile(uri: string, helper?: EditorHelper) {
	helper = helper || new EditorHelper();
	console.log('compiling',uri);
	let doc = documents.get(uri);
	let text: string;
	if (!doc) {
		let file = uriToFilePath(uri);
		if (fs.existsSync(file)) {
			text = fs.readFileSync(file).toString('UTF-8');
		} else {
			console.log('NO DOC FOUND WITH THAT URI!');
			return new DPScript('',project.primaryNamespace,helper,false);
		}
	} else {
		text = doc.getText();
	}
	let script = compileCode(text,uri,helper);
	scripts[uri] = script;
	return script;
}

function compileAndEval(uri: string, helper?: EditorHelper) {
	project.reset();
	let script = compile(uri,helper);
	evaulateScript(script);
	lastHelpers[uri] = helper;
	return script;
}

connection.onCompletion((params,cancel)=>{
	let helper = new EditorHelper();
	helper.cursorPos = params.position;
	compileAndEval(params.textDocument.uri,helper);
	let completions: CompletionItem[] = [];
	for (let s of helper.suggestions) {
		if (isPositionInRange(s.range,params.position)) {
			completions.push({
				label: s.value,
				detail: s.detail,
				insertText: s.snippet,
				insertTextFormat: s.snippet ? InsertTextFormat.Snippet : InsertTextFormat.PlainText,
				documentation: s.desc ? {
					kind: MarkupKind.Markdown,
					value: s.desc
				} : undefined,
				kind: s.type
			})
		}
	}
	return completions;
});

function getHelper(doc: TextDocumentIdentifier) {
	let h = lastHelpers[doc.uri];
	if (h) return h;
	console.log("not compiled yet, compiling and getting language features...")
	compileAndEval(doc.uri);
	return lastHelpers[doc.uri];
}

connection.onDocumentColor(p=>{
	let h = getHelper(p.textDocument);
	return h.colors;
})

connection.onSignatureHelp(sh=>{
	let h = compileWithCursor(sh.textDocument.uri,sh.position);
	if (h.signatureHelp) {
		return h.signatureHelp;
	}
});

function compileWithCursor(uri: string, pos: Position) {
	let h = new EditorHelper();
	h.cursorPos = pos;
	compileAndEval(uri,h);
	return h;
}

connection.onHover(hp=>{
	let helper = getHelper(hp.textDocument);
	for (let h of helper.hovers) {
		if (isPositionInRange(h.range,hp.position)) {
			let contents: MarkedString[] = [];
			if (h.info.syntax) {
				contents.push({language: "dpscript",value: h.info.syntax});
			}
			if (h.info.desc) {
				contents.push({language: "text",value: h.info.desc});
			}
			return {
				contents
			}
		}
	}
	
})

connection.onColorPresentation(p=>{
	let h = getHelper(p.textDocument);
	let res: ColorPresentation[] = [];
	for (let e of h.colorPresentations) {
		if (e.range.start.line == p.range.start.line && e.range.start.character == p.range.start.character) {
			res.push(e.getter(p.color));
		}
	}
	return res;
})

connection.onDocumentSymbol(p=>{
	let h = getHelper(p.textDocument);
	let symbols: SymbolInformation[] = [];
	for (let s of h.symbols) {
		symbols.push({kind: s.kind, location: {range: s.fullRange || s.range, uri: p.textDocument.uri}, name: s.name, containerName: s.parent})
	}
	return symbols;
});

connection.onDocumentHighlight(p=>{
	let h = getHelper(p.textDocument);
	let symbol: SymbolInfo;
	console.log('highlight pos:',p.position);
	for (let s of h.symbols) {
		console.log(s);
		if (isPositionInRange(s.range,p.position)) {
			symbol = s;
		}
	}
	if (!symbol) {
		return undefined;
	}
	let res: DocumentHighlight[] = []
	for (let s of h.symbols) {
		if (s.kind == symbol.kind && s.name == symbol.name) {
			res.push({range: s.range,kind: s.highlight || DocumentHighlightKind.Text})
		}
	}
	return res;
})

connection.onDocumentLinks(p=>{
	let h = getHelper(p.textDocument);
	return h.links;
})

connection.onDeclaration(p=>{
	let h = getHelper(p.textDocument);
	for (let d of h.declarationLinks) {
		if (isPositionInRange(d.range,p.position)) {
			return d.decl
		}
	}
})

connection.onDefinition(p=>{
	let h = getHelper(p.textDocument);
	for (let d of h.declarationLinks) {
		if (isPositionInRange(d.range,p.position)) {
			return [{targetUri: d.decl.uri, targetRange: d.decl.range, targetSelectionRange: d.decl.range, originSelectionRange: d.range}]
		}
	}
})


connection.onImplementation(p=>{
	let h = getHelper(p.textDocument);
	for (let d of h.declarationLinks) {
		if (isPositionInRange(d.range,p.position)) {
			return d.decl
		}
	}
})


export function isPositionInRange(range: Range, pos: Position) {
	return pos.line <= range.end.line && pos.line >= range.start.line && pos.character >= range.start.character && pos.character <= range.end.character;
}

documents.listen(connection);

connection.onInitialize((params) => {
	workspaceFolder = params.rootUri;
	let dir = uriToFilePath(workspaceFolder);
	project = new DatapackProject(path.basename(dir),dir);
	connection.console.log(`[Server(${process.pid}) ${workspaceFolder}] Started and initialize received`);
	return {
		capabilities: {
			textDocumentSync: {
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
			declarationProvider: true,
			implementationProvider: true,
			definitionProvider: true
		}
	};
});

connection.listen();