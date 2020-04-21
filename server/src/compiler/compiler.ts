import { VariableType, toLowerCaseUnderscored } from './util';
import { Statement, Parser, Evaluator } from './parser';
import { TokenIterator, Token } from './tokenizer';
import { Diagnostic, DiagnosticSeverity, Range, Position, CompletionItemKind, ColorInformation } from 'vscode-languageserver';
import * as path from 'path';
import { Namespace } from '.';
import { Files } from 'vscode-languageserver';
import { Selector } from './selector';
import { isPositionInRange } from '../server';
import { CustomClass, ClassDefinition } from './oop';

export class EditorHelper {
	
	suggestions: Suggestion[] = []
	diagnostics: Diagnostic[] = []
	colors: ColorInformation[] = []
	signatureHelp?: SignatureHelp
	cursorPos: Position
	hovers: Hover[] = []

	error(pos: Range, msg: string) {
		this.diagnostics.push({range: pos,message: msg,severity: DiagnosticSeverity.Error});
	}

	warn(pos: Range, msg: string) {
		this.diagnostics.push({range: pos,message: msg,severity: DiagnosticSeverity.Warning});
	}

	suggest(...values: Suggestion[]) {
		this.suggestions.push(...values);
	}

	setSignatureHelp(signature: SignatureHelp) {
		if (this.cursorPos && isPositionInRange(signature.pos,this.cursorPos)) {
			this.signatureHelp = signature;
		}
	}

	setHover(pos: Range, content: HoverInfo) {
		this.hovers.push({range: pos, info: content});
	}

}

export interface HoverInfo {
	syntax?: string
	desc?: string
}

export interface Hover {
	info: HoverInfo
	range: Range
}

export interface Suggestion {
	range: Range;
	value: string;
	detail?: string;
	desc?: string;
	type?: CompletionItemKind
}

export interface SignatureHelp {
	pos: Range
	method: string
	desc: string
	params: SignatureParameter[]
	activeParam: number
}

export interface SignatureParameter {
	label: string
	desc?: string
	optional?: boolean
	type?: string
}


export function compileCode(code: string, fileUri: string, editor: EditorHelper) {
	let file = Files.uriToFilePath(fileUri);
	if (!file) {
		console.log("invalid file");
		return;
	}
	let ctx = new CompilationContext(path.resolve(file,".."),editor);
	let tokens = TokenIterator.fromCode(code,ctx);
	let parser = new Parser(tokens,ctx);
	ctx.parser = parser;
	let result = parser.parse();
	let fileName = path.basename(file,'dps');
	let namespace = new Namespace(fileName == 'main' ? path.dirname(file).split(path.sep).pop() || "" : toLowerCaseUnderscored(fileName));
	let e = new Evaluator(namespace,editor);
	e.evalFile(result);
}

export class CompilationContext {
	
	variables: {[name: string]: VariableType<any>}[] = [{}];
	currentEntity: Selector;
	insideClassDef: ClassDefinition;
	parser: Parser

	constructor(public dir: string, public editor: EditorHelper) {

	}

	snapshot() {
		let copy = new CompilationContext(this.dir,this.editor);
		
		copy.variables = this.variables.map(o=>Object.assign({},o));
		copy.currentEntity = this.currentEntity;
		copy.insideClassDef = this.insideClassDef;
		copy.parser = this.parser;
		return copy;
	}

	exitBlock() {
		this.variables.pop();
	}
	enterBlock() {
		this.variables.push({});
	}
	

	addVariable(name: Token, type: VariableType<any>) {
		if (this.hasVariable(name.value)) {
			this.editor.error(name.range,"Duplicate variable " + name.value);
			return
		}
		this.variables[this.variables.length-1][name.value] = type;
	}

	hasVariable(name: string, type?: VariableType<any>) {
		let t = this.getVariableType(name)
		return t && (!type || t == type);
	}

	getVariableType(name: string) {
		for (let i = this.variables.length - 1; i >= 0; i--) {
			console.log(this.variables[i]);
			console.log("finding " + name);
			if (this.variables[i][name]) return this.variables[i][name];
		}
		console.log("var not found")
		return undefined;
	}

	getAllVariables(): {name: string, type: VariableType<any>}[] {
		let vars = [];
		for (let s of this.variables) {
			vars.push(...Object.keys(s).map(k=>({name: k, type: s[k]})));
		}
		return vars;
	}
}

export class DPScript {
	statements: Statement[] = [];
	
}