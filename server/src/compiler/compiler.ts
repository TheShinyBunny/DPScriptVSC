import { VariableType, toLowerCaseUnderscored, getSignatureParamLabel } from './util';
import { Statement, Parser, Evaluator, Lazy, ScopeType } from './parser';
import { TokenIterator, Token } from './tokenizer';
import { Diagnostic, DiagnosticSeverity, Range, Position, CompletionItemKind, ColorInformation, ColorPresentation, Color, SymbolKind, DocumentHighlightKind, DocumentLink, Declaration, Location, SignatureHelp, ParameterInformation } from 'vscode-languageserver';
import * as path from 'path';
import { Namespace, MCFunction, ResourceLocation } from '.';
import { Files } from 'vscode-languageserver';
import { Selector } from './selector';
import { isPositionInRange, getScript, project } from '../server';
import { ClassDefinition } from './oop';
import { URI } from 'vscode-uri';
import { Tag } from './tags';

export class EditorHelper {
	
	suggestions: Suggestion[] = []
	diagnostics: Diagnostic[] = []
	colors: ColorInformation[] = []
	colorPresentations: {range: Range, getter: (color: Color)=>ColorPresentation}[] = [];
	signatureHelp: SignatureHelp;
	cursorPos: Position
	hovers: Hover[] = []
	symbols: SymbolInfo[] = []
	links: DocumentLink[] = []
	declarationLinks: {range: Range, decl: Location}[] = [];

	error(pos: Range, msg: string) {
		console.trace('added arror: ' + msg);
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
			let sugg: Suggestion = typeof s == 'string' ? {range,value: s} : {range,value: s.value,detail: s.detail,desc: s.desc,type: s.type, snippet: s.snippet};
			if (this.cursorPos && sugg.range.start.line == this.cursorPos.line) {
				this.suggest(sugg);
			}
		}
	}

	createSignatureHelp(label: string, items: SignatureItem[]): SignatureHelp {
		return {
			activeParameter: -1,
			activeSignature: 0,
			signatures: items.map(i=>({label: label + '(' + i.params.map(p=>getSignatureParamLabel(p)).join(', ') + ')', documentation: i.desc, parameters: this.toSignatureInfos(i.params)}))
		}
	}

	setSignatureHelp(signature: SignatureHelp) {
		if (signature && signature.activeParameter >= 0) {
			this.signatureHelp = signature;
		}
	}

	private toSignatureInfos(params: SignatureParameter[]): ParameterInformation[] {
		return params.map(p=>({label: getSignatureParamLabel(p),documentation: p.desc}))
	}

	markActiveSignatureParam(signature: SignatureHelp, range: Range, index: number) {
		if (this.cursorPos && isPositionInRange(range,this.cursorPos)) {
			signature.activeParameter = index;
		}
	}

	setHover(pos: Range, content: HoverInfo) {
		this.hovers.push({range: pos, info: content});
	}

	addSymbol(range: Range, name: string, kind: SymbolKind, highlight?: DocumentHighlightKind, fullRange?: Range) {
		this.symbols.push({range,kind,name,highlight,fullRange});
	}

	addSymbolGroup(name: Token, span: Range, kind: SymbolKind) {
		this.addSymbol(name.range,name.value,kind,DocumentHighlightKind.Text,span);
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
	type?: CompletionItemKind,
	snippet?: string
}


export type FutureSuggestion = {
	value: string
	detail?: string
	desc?: string
	type?: CompletionItemKind
	snippet?: string
} | string;

export interface SignatureParamMarker {
	pos: Range
	desc?: string
	index: number
	label: string
}

export interface SignatureItem {
	desc: string
	params: SignatureParameter[]
}

export interface SignatureParameter {
	label: string
	desc?: string
	optional?: boolean
	type?: string
}

export interface SymbolInfo {
	kind: SymbolKind
	range: Range
	fullRange: Range
	name: string
	highlight?: DocumentHighlightKind
	parent?: string
}

export interface ImportPath {
	nodes: PathNode[]
	all: boolean
	fullRange: Range
	extension?: string
	uri: string
}

export interface PathNode {
	value: string
	range: Range
}

export function mapFullPath(cwd: string, nodes: PathNode[], index?: number) {
	let fullPath = cwd;
	for (let i = 0; i <= (index === undefined ? nodes.length - 1 : index); i++) {
		let n = nodes[i];
		fullPath = path.resolve(fullPath,n.value);
	}
	return fullPath;
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
	let namespace = project.getNamespaceForFile(file);
	let script = new DPScript(file,namespace,editor,path.basename(file,'dps') == 'main');
	let ctx = new CompilationContext(path.dirname(file),editor,script);
	let tokens = TokenIterator.fromCode(code,ctx);
	let parser = new Parser(tokens,ctx);
	ctx.parser = parser;
	parser.parse();
	return script;
}

export function evaulateScript(script: DPScript) {
	let e = new Evaluator(project,script);
	try {
		e.doEvaulation();
	} catch (err) {
		console.log("An error occured while evaluating file:", err);
	}
}

export class CompilationContext {
	
	variables: {[name: string]: VariableType<any>}[] = [{}];
	currentEntity: Selector;
	insideClassDef: ClassDefinition;
	parser: Parser
	currentScope: ScopeType

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

	getAllVariables(type?: VariableType<any>): {name: string, type: VariableType<any>}[] {
		let vars = [];
		for (let s of this.variables) {
			vars.push(...Object.keys(s).filter(k=>!type || type == s[k]).map(k=>({name: k, type: s[k]})));
		}
		return vars;
	}

	ensureUniqueClass(name: Token) {
		if (this.script.classes.find(c=>c.name.value == name.value)) {
			this.editor.error(name.range,"Duplicate class " + name.value);
		}
	}

	swapCurrentEntity(sel: Selector) {
		let prev = this.currentEntity;
		this.currentEntity = sel;
		return prev;
	}
}

export class DPScript {
	functions: MCFunction[] = [];
	classes: ClassDefinition[] = [];
	tags: Tag[] = []
	globalVars: {[name: string]: Lazy<any>} = {};
	statements: Statement[] = [];
	usedEntityTags: string[] = []

	constructor(public file: string, public namespace: Namespace, public editor: EditorHelper, private isMain: boolean) {
		
	}

	get dir() {
		return path.dirname(this.file);
	}

	get name() {
		return path.basename(this.file,'dps');
	}

	get uri() {
		return URI.file(this.file).toString();
	}
	
	createFunction(name: string, shouldExport: boolean, shouldAdd: boolean = true) {
		let lc = toLowerCaseUnderscored(name);
		let f = new MCFunction(new ResourceLocation(this.namespace,this.isMain ? lc : path.join(path.basename(this.file,'.dps'),lc)),name);
		if (shouldExport) {
			this.functions.push(f);
		}
		if (shouldAdd) {
			this.namespace.add(f);
		}
		return f;
	}
}