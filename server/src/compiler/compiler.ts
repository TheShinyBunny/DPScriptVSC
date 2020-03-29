import { Statement, Lazy, Parser, Evaluator } from './parser';
import { TokenIterator, Token } from './tokenizer';
import { Score, VariableType, toLowerCaseUnderscored } from './util';
import { Diagnostic, DiagnosticSeverity, Range, Position, CompletionItemKind } from 'vscode-languageserver';
import * as path from 'path';
import { Namespace } from '.';
import { Files } from 'vscode-languageserver';

export class EditorHelper {
	
	suggestions: Suggestion[] = []
	diagnostics: Diagnostic[] = [];

	error(pos: Range, msg: string) {
		this.diagnostics.push({range: pos,message: msg,severity: DiagnosticSeverity.Error});
	}

	warn(pos: Range, msg: string) {
		this.diagnostics.push({range: pos,message: msg,severity: DiagnosticSeverity.Warning});
	}

	suggest(...values: Suggestion[]) {
		this.suggestions.push(...values);
	}

}

export interface Suggestion {
	range: Range;
	value: string;
	desc?: string;
	type?: CompletionItemKind
}



export function compileCode(code: string, fileUri: string, editor: EditorHelper) {
	let file = Files.uriToFilePath(fileUri);
	if (!file) {
		console.log("invalid file");
		return;
	}
	let ctx = new CompilationContext(path.resolve(file,".."),editor);
	let tokens = new TokenIterator(code,ctx);
	let parser = new Parser(tokens,ctx);
	let result = parser.parse();
	let fileName = path.basename(file);
	let namespace = new Namespace(fileName == 'main' ? path.dirname(file).split(path.sep).pop() || "" : toLowerCaseUnderscored(fileName));
	let e = new Evaluator(namespace,editor);
	e.evalFile(result);
}

export function suggest(cursor: Position) {

}


export class CompilationContext {
	

	variables: {[name: string]: VariableType<any>}[] = [{}];

	constructor(public dir: string, public editor: EditorHelper) {

	}

	exitBlock() {
		this.variables.pop();
	}
	enterBlock() {
		this.variables.push({});
	}
	

	addVariable(name: string, type: VariableType<any>) {
		this.variables[this.variables.length-1][name] = type;
	}

	hasVariable(name: string, type?: VariableType<any>) {
		return this.getVariableType(name) == type;
	}

	getVariableType(name: string) {
		for (let i = this.variables.length; i >= 0; i--) {
			if (this.variables[i][name]) return this.variables[i][name];
		}
		return undefined;
	}
}

export class DPScript {
	statements: Statement[] = [];
	
}