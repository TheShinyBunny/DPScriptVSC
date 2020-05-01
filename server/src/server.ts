/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import {
	createConnection, TextDocuments, ProposedFeatures, TextDocumentSyncKind, Range, CompletionItem, Position, TextDocumentIdentifier, MarkupKind, MarkedString, Hover
} from 'vscode-languageserver';
import { EditorHelper, compileCode, SignatureParameter } from './compiler/compiler';
import { initRegistries } from './compiler/nbt';

// Creates the LSP connection
let connection = createConnection(ProposedFeatures.all);

// Create a manager for open text documents
let documents = new TextDocuments();

// The workspace folder this server is operating on
let workspaceFolder: string | null;

let lastHover: Hover;

documents.onDidOpen((event) => {
	connection.console.log(`[Server(${process.pid}) ${workspaceFolder}] Document opened: ${event.document.uri}`);
});

documents.onDidChangeContent(e=>{
	console.log("changed contents, compiling file...");
	lastHelpers[e.document.uri] = undefined;
	lastHover = undefined;
	let h = compile(e.document.uri);
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

let lastHelpers: {[uri: string]: EditorHelper} = {};

function compile(uri: string, helper?: EditorHelper) {
	helper = helper || new EditorHelper();
	compileCode(documents.get(uri).getText(),uri,helper);
	lastHelpers[uri] = helper;
	return helper;
}

connection.onCompletion((params,cancel)=>{
	let helper = new EditorHelper();
	helper.cursorPos = params.position;
	compile(params.textDocument.uri,helper);
	let completions: CompletionItem[] = [];
	for (let s of helper.suggestions) {
		if (isPositionInRange(s.range,params.position)) {
			completions.push({
				label: s.value,
				detail: s.detail,
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
	compile(doc.uri);
	return lastHelpers[doc.uri];
}

connection.onDocumentColor(p=>{
	console.log('document colors!')
	let h = getHelper(p.textDocument);
	return h.colors;
})

connection.onSignatureHelp(sh=>{
	let h = compileWithCursor(sh.textDocument.uri,sh.position);
	if (h.signatureHelp) {
		return {
			signatures: [
				{
					label: h.signatureHelp.method + '(' + h.signatureHelp.params.map(p=>getSignatureParamLabel(p)).join(', ') + ')',
					documentation: h.signatureHelp.desc ? {
						kind: MarkupKind.Markdown,
						value: h.signatureHelp.desc
					} : undefined,
					parameters: h.signatureHelp.params.map(p=>({label: getSignatureParamLabel(p), documentation: p.desc}))
				}
			],
			activeParameter: h.signatureHelp.activeParam,
			activeSignature: 0
		}
	}
});

function compileWithCursor(uri: string, pos: Position) {
	let h = new EditorHelper();
	h.cursorPos = pos;
	compile(uri,h);
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

export function getSignatureParamLabel(param: SignatureParameter) {
	return param.label + (param.optional ? '?' : '') + (param.type ? ': ' + param.type : '');
}

connection.onColorPresentation(p=>{
	return []
})


export function isPositionInRange(range: Range, pos: Position) {
	return pos.line <= range.end.line && pos.line >= range.start.line && pos.character >= range.start.character && pos.character <= range.end.character;
}

documents.listen(connection);

connection.onInitialize((params) => {
	workspaceFolder = params.rootUri;
	initRegistries();
	connection.console.log(`[Server(${process.pid}) ${workspaceFolder}] Started and initialize received`);
	return {
		capabilities: {
			textDocumentSync: {
				openClose: true,
				change: TextDocumentSyncKind.Full
			},
			completionProvider: {
				resolveProvider: false,
				triggerCharacters: ['.','[','@','{','\n','=','(',' ',',']
			},
			colorProvider: true,
			signatureHelpProvider: {
				triggerCharacters: ['(',',']
			},
			hoverProvider: true
		}
	};
});
connection.listen();