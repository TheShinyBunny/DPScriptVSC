import { VariableType, toLowerCaseUnderscored } from './util';
import { Statement, Parser, Evaluator, Lazy } from './parser';
import { TokenIterator, Token } from './tokenizer';
import { Diagnostic, DiagnosticSeverity, Range, Position, CompletionItemKind, ColorInformation } from 'vscode-languageserver';
import * as path from 'path';
import { Namespace } from '.';
import { Files } from 'vscode-languageserver';
import { Selector } from './selector';
import { isPositionInRange } from '../server';
import { ClassDefinition } from './oop';

export class EditorHelper {
	
	suggestions: Suggestion[] = []
	diagnostics: Diagnostic[] = []
	colors: ColorInformation[] = []
	signatureHelp?: SignatureHelp
	cursorPos: Position
	hovers: Hover[] = []

	error(pos: Range, msg: string) {
		console.trace('added arror:')
		this.diagnostics.push({range: pos,message: msg,severity: DiagnosticSeverity.Error});
	}

	warn(pos: Range, msg: string) {
		this.diagnostics.push({range: pos,message: msg,severity: DiagnosticSeverity.Warning});
	}

	suggest(...values: Suggestion[]) {
		this.suggestions.push(...values);
	}

	suggestAll(range: Range, ...suggestions: FutureSuggestion[]) {
		for (let s of suggestions) {
			let sugg: Suggestion = typeof s == 'string' ? {range,value: s} : {range,value: s.value,detail: s.detail,desc: s.desc,type: s.type};
			if (this.cursorPos && sugg.range.start.line == this.cursorPos.line) {
				this.suggest(sugg);
			}
		}
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


export type FutureSuggestion = {
	value: string
	detail?: string
	desc?: string
	type?: CompletionItemKind
} | string;

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

/**
 * 
 * @param code The code string to compile
 * @param fileUri The file URI address (cuz vscode uses URIs for some reason)
 * @param editor An EditorHelper serves as a communication channel between the language server and the compiler, 
 * reporting diagnosics, suggestions, etc.
 */
export function compileCode(code: string, fileUri: string, editor: EditorHelper) {
	let file = Files.uriToFilePath(fileUri);
	if (!file) {
		console.log("invalid file");
		return;
	}
	let script = new DPScript();
	let ctx = new CompilationContext(path.resolve(file,".."),editor,script);
	let tokens = TokenIterator.fromCode(code,ctx);
	let parser = new Parser(tokens,ctx);
	ctx.parser = parser;
	parser.parse();
	let fileName = path.basename(file,'dps');
	let namespace = new Namespace(fileName == 'main' ? path.dirname(file).split(path.sep).pop() || "" : toLowerCaseUnderscored(fileName));
	let e = new Evaluator(namespace,editor);
	try {
		e.evalFile(script);
	} catch (err) {
		console.log("An error occured while evaluating file:", err);
	}
}

export class CompilationContext {
	
	variables: {[name: string]: VariableType<any>}[] = [{}];
	currentEntity: Selector;
	insideClassDef: ClassDefinition;
	parser: Parser

	constructor(public dir: string, public editor: EditorHelper, public script: DPScript) {

	}

	snapshot() {
		let copy = new CompilationContext(this.dir,this.editor,this.script);
		
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
		this.forceAddVariable(name.value,type);
	}

	forceAddVariable(name: string, type: VariableType<any>) {
		this.variables[this.variables.length-1][name] = type;
	}

	hasVariable(name: string, type?: VariableType<any>) {
		let t = this.getVariableType(name)
		return t && (!type || t == type);
	}

	getVariableType(name: string) {
		console.log("variable context: " + JSON.stringify(this.variables));
		for (let i = this.variables.length - 1; i >= 0; i--) {
			if (this.variables[i][name]) return this.variables[i][name];
		}
		return undefined;
	}

	getAllVariables(): {name: string, type: VariableType<any>}[] {
		let vars = [];
		for (let s of this.variables) {
			vars.push(...Object.keys(s).map(k=>({name: k, type: s[k]})));
		}
		return vars;
	}

	ensureUniqueClass(name: Token) {
		if (this.script.classes.find(c=>c.name.value == name.value)) {
			this.editor.error(name.range,"Duplicate class " + name.value);
		}
	}
}

export class DPScript {
	functions: string[] = [];
	classes: ClassDefinition[] = [];
	globalVars: {[name: string]: Lazy<any>} = {};
	statements: Statement[] = [];
	
}