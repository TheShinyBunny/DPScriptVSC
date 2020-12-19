
import { Score, VariableType, VariableTypes, NumberRange, Ranges, parseLocation, toStringPos, opPrecedence, Operator, operators, dummyOperator, formatRange, negationStr, Variable, toLowerCaseUnderscored, Opcode, getEnumByValue, CustomVariableParsers, VariableOperation, equalsAny, getAsArray, UnaryMode, DeclaredVariable, OperatorNode, getOpPrecedence, parseResultSuccessValue } from './util';
import { TokenIterator, Token, TokenType, Tokens, INVALID_POS } from "./tokenizer";
import { EditorHelper, CompilationContext, DPScript, FutureSuggestion, ImportPath, mapFullPath, DeclarationSpan } from './compiler';
import { MCFunction, Namespace, WritingTarget, DatapackProject, ResourceLocation, Files } from ".";
import { Range, CompletionItemKind, SymbolKind, DocumentHighlightKind, Location } from 'vscode-languageserver';
import { parseNBTPath, NBTPathContext, toStringNBTPath } from './nbt';

export type Statement = (e: Evaluator)=>any;

export type Lazy<T> = ((e: Evaluator)=> Variable<T>);

export type RangedLazy<T> = Lazy<T> & {range: Range}

export type UntypedLazy<T> = (e: Evaluator) => T

export namespace Lazy {
	export const empty: Lazy<any> = untyped(e=>undefined)
	export const rangedEmpty: RangedLazy<any> = ranged(empty,INVALID_POS);

	export function literal<T>(value: T, type: VariableType<T>): Lazy<T> {
		return (e)=>({type, value});
	}

	export function is(obj: any): obj is Lazy<any> {
		return typeof obj == 'function' && 'name' in obj;
	}

	export function map<T>(value: Lazy<T>, modifier: (v: T, e: Evaluator)=>T): Lazy<T> {
		if (value === undefined) return undefined;
		return e=>{
			let r = value(e);
			return {value: modifier(r.value,e),type: r.type}
		}
	}
	export function remap<T,R>(value: Lazy<T>, modifier: (v: T, e: Evaluator)=>{value: R, type: VariableType<R>}): Lazy<R> {
		return e=>{
			let v = e.valueOf(value);
			return modifier(v,e);
		}
	}

	export function ranged<T>(func: Lazy<T>, range: Range): RangedLazy<T> {
		let f: any = e=>{
			return func(e);
		}
		f.range = range;
		return f;
	}

	export function untyped<T>(value: UntypedLazy<T>): Lazy<T> {
		return e=>{
			return {value: value(e),type: VariableTypes.any};
		}
	}
}

/* export abstract class Value<T> {
	abstract get(e: Evaluator): T;

	abstract toString(e: Evaluator): string

}

export class VariableValue<T> extends Value<T> {
	
	constructor(private lazy: Lazy<T>) {
		super()
	}

	get(e: Evaluator): T {
		return this.lazy(e).value;
	}
	toString(e: Evaluator): string {
		let v = this.lazy(e);
		return v.type.stringify(v.value,e);
	}

} */

export interface RegisteredStatement {
	options: StatementOptions;
	func: ()=>Statement | undefined;
}

export interface StatementOptions {
	keyword?: string;
	inclusive?: boolean;
	desc?: string;
}

export function RegisterStatement(options?: StatementOptions) {
	return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
		if (!target.registered) {
			target.registered = [];
		}
		
		target.registered.push({options: {keyword: options ? options.keyword || propertyKey : propertyKey ,inclusive: options ? options.inclusive : false}, func: descriptor.value});
	}
}

export abstract class Scope {

	statements: RegisteredStatement[];
	tokens: TokenIterator;
	parser: Parser
	ctx: CompilationContext
	
	constructor() {
		this.statements = Object.getPrototypeOf(this).registered;
	}

	init(parser: Parser) {
		this.parser = parser;
		this.ctx = parser.ctx;
		this.tokens = parser.tokens;
	}
}

export class MultiScope extends Scope {
	constructor(...scopes: Scope[]) {
		super();
		this.statements = [];
		for (let s of scopes) {
			for (let st of s.statements) {
				this.statements.push({options: st.options,func: st.func.bind(s)});
			}
		}
	}

}

import { ClassDefinition, parseNewInstanceCreation, parseObjectInstanceAccess, TypeFlag, ClassScope } from './oop';

/**
 * The evaluator is an object responsible of providing context between all statement, and writing the commands to the functions.
 */
export class Evaluator {
	
	objectives: string[] = []
	loadFunction?: MCFunction;
	tickFunction?: MCFunction;
	variables: {[name: string]: DeclaredVariable<any>} = {};
	generatedFunctions: {[prefix: string]: number} = {};
	temps: {[prefix: string]: number} = {};
	classes: ClassDefinition[] = [];
	functions: MCFunction[] = [];
	tags: Tag[] = []
	insideClass: ClassDefinition;
	disableWriting: boolean
	disableLangFeatures: boolean
	entityTags: string[] = [];

	constructor(public project: DatapackProject, public file: DPScript, public target?: WritingTarget) {
		//this.classes.push(...createEntityClasses(file));
	}

	recreate(): Evaluator {
		let e = new Evaluator(this.project,this.file,this.target);
		e.objectives = this.objectives;
		e.loadFunction = this.loadFunction;
		e.variables = {...this.variables};
		e.generatedFunctions = this.generatedFunctions;
		e.temps = this.temps;
		e.disableWriting = this.disableWriting;
		e.disableLangFeatures = this.disableLangFeatures;
		e.insideClass = this.insideClass;
		e.classes = [...this.classes];
		e.file = this.file;
		e.functions = [...this.functions];
		e.tags = [...this.tags]
		e.entityTags = [...this.entityTags];
		return e;
	}

	createFunction(name: Token, statement: Statement, addToNS: boolean): MCFunction | undefined {
		if (this.getFunction(name.value)) {
			this.file.editor.error(name.range,"Duplicate function " + name.value);
			return undefined;
		}
		let func = this.file.createFunction(name.value,false);
		let e = this.recreate();
		e.target = func;
		statement(e);
		if (!this.disableWriting && addToNS) {
			this.file.namespace.add(func);
		}
		return func;
	}

	addStatementToFunction(func: MCFunction, statement: Statement) {
		let e = this.recreate();
		e.target = func;
		statement(e);
	}

	requireFunction(name: Token): MCFunction {
		this.file.editor.addSemantic(name.range,SemanticType.function)
		let func = this.getFunction(name.value);
		if (!func) {
			this.error(name.range,"Unknown function '" + name.value + "'");
			return;
		}
		this.file.editor.declarationLinks.push({range: name.range, decl: func.declaration})
		return func;
	}

	/**
	 * Generates a new function named by the specified prefix + _ + a unique number
	 * @param prefix A prefix for the function name
	 * @param cmds Optional commands to add to the new function
	 */
	generateFunction(prefix: string,cmds?: string[]): MCFunction {
		let n = this.generatedFunctions[prefix];
		if (n) {
			this.generatedFunctions[prefix]++
			n++;
		} else {
			this.generatedFunctions[prefix] = 1;
			n = 1;
		}
		let name = prefix + '_' + n;
		let func = this.file.createFunction(name,false,true);
		if (cmds) {
			func.commands = cmds;
			console.log('>> inside ' + func.toString());
			cmds.forEach(c=>console.log('+ ' + c));
			console.log('<<');
		}
		return func;
	}

	getFunction(name: string) {
		return this.functions.find(f=>f.name == name);
	}

	/**
	 * Add a command to the load tagged function
	 * @param cmd The command to add
	 */
	load(cmd: string) {
		if (this.disableWriting) return;
		if (!this.loadFunction) {
			this.loadFunction = this.file.createFunction("init",false);
			this.file.namespace.loads.push(this.loadFunction);
		}
		this.loadFunction.add(cmd);
	}

	tick(cmd: string) {
		if (this.disableWriting) return;
		if (!this.tickFunction) {
			this.tickFunction = this.file.createFunction("loop",false);
			this.file.namespace.loads.push(this.loadFunction);
		}
		this.tickFunction.add(cmd);
	}

	/**
	 * Writes the commands to the current target function
	 * @param cmd The command/s to write
	 */
	write(...cmd: string[]) {
		if (this.disableWriting) return;
		if (this.target) {
			for (let c of cmd) {
				this.target.add(c);
			}
		}
	}

	includeScript(file: DPScript) {
		this.classes.push(...file.classes);
		this.functions.push(...file.functions);
		this.tags.push(...file.tags);
		this.entityTags.push(...file.usedEntityTags);
	}

	doEvaulation() {
		this.includeScript(this.file);
		let load = this.file.createFunction('init',false,true);
		this.addLoadFunction(load);
		this.target = load;
		this.evalAll(this.file.statements);
	}

	evalAll(statements: Statement[]) {
		for (let s of statements) {
			this.temps = {};
			s(this);
		}
	}

	error(range: Range, msg: string) {
		if (this.disableLangFeatures) return;
		this.file.editor.error(range,msg);
	}

	warn(range: Range, msg: string) {
		if (this.disableLangFeatures) return;
		this.file.editor.warn(range,msg);
	}

	suggestAt(range: Range, ...suggestions: FutureSuggestion[]) {
		if (this.disableLangFeatures) return;
		this.file.editor.suggestAll(range,...suggestions);
	}

	/**
	 * Adds an objective if it doesn't exist in the load function
	 * @param name The objective name
	 */
	ensureObjective(name: string) {
		if (this.objectives.indexOf(name) < 0) {
			this.objectives.push(name);
			this.load("scoreboard objectives add " + name + " dummy");
		}
	}

	setVariable<T>(name: string, variable: DeclaredVariable<T>) {
		this.variables[name] = variable;
	}

	setVariableValue(name: string, value: any) {
		let v = this.getVariable(name);
		if (v) {
			v.value = value;
		}
	}

	getVariable(name: string) {
		return this.variables[name];
	}

	addLoadFunction(f: MCFunction) {
		if (this.disableWriting) return;
		if (this.loadFunction) {
			if (this.loadFunction.name == f.name && f.name == 'init') {
				for (let c of f.commands) {
					this.loadFunction.add(c);
				}
			} else {
				this.file.namespace.loads.push(f);
			}
		} else {
			this.loadFunction = f;
			this.file.namespace.loads.push(f);
		}
	}

	addTickFunction(f: MCFunction) {
		if (this.disableWriting) return;
		if (this.tickFunction) {
			if (this.tickFunction.name == f.name && f.name == 'loop') {
				for (let c of f.commands) {
					this.tickFunction.add(c);
				}
			} else {
				this.file.namespace.ticks.push(f);
			}
		} else {
			this.tickFunction = f;
			this.file.namespace.ticks.push(f);
		}
	}

	importPackFromDir(path: ImportPath) {
		throw new Error('soon (TM)');
	}
	importPackFromZip(path: ImportPath) {
		throw new Error('soon (TM)');
	}

	import(file: ImportPath) {
		console.log('importing',file);
		if (file.all) {
			let dir = mapFullPath(this.file.file.parent,file.nodes);
			for (let f of dir.children(Files.File)) {
				this.importFile(f);
			}
		} else {
			let dir = file.nodes.length > 1 ? mapFullPath(this.file.file.parent,file.nodes,file.nodes.length - 2) : this.file.file.parent;
			this.importFile(dir.file(file.nodes[file.nodes.length-1].value + '.dps'));
		}
	}

	importFile(file: Files.File) {
		console.log('importing script',file);
		let script = getScript(file);
		this.includeScript(script);
	}

	/**
	 * 
	 * @param lazy The lazy/normal value
	 * @param defValue A default value if the provided value is undefined, or its lazy result is undefined
	 */
	valueOf<T>(lazy: Lazy<T> | UntypedLazy<T> | LazyCompoundEntry<T> | T, defValue?: any, range?: Range,...expectedTypes: VariableType<any>[]): T {
		if (lazy === undefined) return defValue;
		if (typeof lazy !== 'function') return <T>lazy;
		let res = lazy.call(this,this);
		if (res === undefined) return defValue;
		if (res.value !== undefined && res.type) {
			if (expectedTypes.length > 0 && expectedTypes.indexOf(res.type) < 0) {
				this.error(range,'Expected ' + (expectedTypes.length == 1 ? expectedTypes[0].name : expectedTypes.map(t=>t.name).join(' | ')));
				return defValue;
			}
			return res.value === undefined ? defValue : res.value;
		}
		return res === undefined ? defValue : res;
	}

	stringify(lazy: Lazy<any> | any): string {
		if (lazy !== undefined) {
			if (!Lazy.is(lazy)) return String(lazy)
			let res = lazy(this);
			if (res === undefined) return '';
			return res.type.stringify(res.value,this);
		}
		return ''
	}

	toLocation(name: Range, fullRange?: Range): DeclarationSpan {
		return {name: name, uri: this.file.uri, fullRange}
	}

	assignTarget(arr: string[]) {
		this.target = {add: (cmd)=>arr.push(cmd)}
	}

	getCommandWithRun(funcPrefix: string, statement: Statement) {
		let cmd = this.getCommand(funcPrefix,statement);
		return prependRun(<string>cmd);
	}

	getCommand(funcPrefix: string, statement: Statement, getReturnType: boolean = false): string | {var: Variable<any>, cmd: ()=>string, function: boolean} {
		let cmds: string[] = []
		let t: WritingTarget = {
			add: (...cs)=>{
				cmds.push(...cs)
			}
		}
		let e = this.recreate();
		e.target = t;
		let ret = undefined;
		if (!statement) {
			e.write('say EMPTY STATEMENT!');
		} else {
			ret = statement(e);
		}
		let commandGetter = ()=>{
			if (cmds.length > 1) {
				return 'function ' + this.generateFunction(funcPrefix,cmds).toString();
			}
			return cmds.length > 0 ? cmds[0] : 'say EMPTY STATEMENT!'
		}
		if (getReturnType && ret) return {var: ret, cmd: commandGetter, function: cmds.length > 1};
		return commandGetter();
	}

	getLastCommand(cmds: string[]) {
		if (cmds.length == 1) {
			return cmds[0];
		} else if (cmds.length == 0) return 'say EMPTY STATEMENT!';
		this.write(...cmds.slice(0,cmds.length-1));
		return cmds[cmds.length-1];
	}

	generateTempScore(prefix: string): TempScore {
		let n = this.temps[prefix];
		if (n) {
			this.temps[prefix]++
			n++;
		} else {
			this.temps[prefix] = 1;
			n = 1;
		}
		let name = prefix + n;
		this.ensureObjective('temps');
		return new TempScore(this,name);
	}

	resetTempScore(prefix: string) {
		this.temps[prefix] = 0;
	}

	createConst(value: number, name?: string) {
		this.ensureObjective('Consts');
		let score = Score.constant(name || '#' + value);
		this.load(`scoreboard players set ${Score.toString(score,this)} ${value}`);
		return score;
	}

	getClass(name: string) {
		return this.classes.find(c=>c.name.value == name);
	}

	requireClass(name: Token): ClassDefinition {
		//console.log("requiring class " + name.value + ". current classes:", this.classes.map(c=>c.name.value));
		let c = this.getClass(name.value);
		if (c) {
			this.file.editor.declarationLinks.push({range: name.range, decl: c.declaration});
			return c;
		}
		this.error(name.range,"Unknown class " + name.value);
	}

	requireType(t: TypeFlag): VariableType<any> {
		let c = this.getClass(t.base.name);
		if (c) return c.variableType;
		let vt = VariableType.getById(t.base.name);
		if (vt) return vt;
		this.error(t.range,"Unknown type " + t.base.name);
	}

	requireTag(e: UnresolvedTag): Tag {
		let tag = this.tags.find(t=>t.id == e.token.value);
		if (!tag) {
			return new Tag(e.type,e.token.value,new ResourceLocation(this.project.mcNamespace,toLowerCaseUnderscored(e.token.value)),[],false);
		}
		this.file.editor.declarationLinks.push({decl: tag.declaration, range: e.token.range})
		if (tag.type != e.type) {
			this.error(e.token.range,'Cannot include tag entry ' + tag.id + ' of type ' + tag.type.dir + ' in tag of type ' + e.type.dir);
		}
		return tag;
	}

}

export class TempScore {
	constructor(public e: Evaluator, public name: string) {

	}

	asString: string = this.name + ' temps';

	asScore: Score = {entry: Lazy.literal(this.name,VariableTypes.string),objective: 'temps'}

	set(n: number) {
		return 'scoreboard players set ' + this.asString + ' ' + n;
	}

	matches(range: NumberRange) {
		return this.asString + ' matches ' + Ranges.toString(range);
	}
}




import { GlobalScope } from './scopes/global';
import { NormalScope } from './scopes/normal';
import { UtilityScope } from './scopes/utility';
import { AdvancementScope } from './advancements';
import { getScript, SemanticType } from '../server';
import { Tag, UnresolvedTag } from './tags';
import { isArray, isBoolean } from 'util';
import { Registry } from './registries';
import { Parsers } from './parsers/parsers';
import { LazyCompoundEntry } from './data_structs';
import { toStringBlock } from './parsers/block';
import { parseAnnotation } from './annotations';
import { createEntityClasses } from './entities';
import { parseSelector, parseSelectorCommand } from './selector';
import { parsePredicateNode } from './predicates';

export const MainScopes = {
	global: new GlobalScope(),
	normal: new NormalScope(),
	utility: new UtilityScope()
}

export const Scopes = {
	global: new MultiScope(MainScopes.global,MainScopes.utility),
	function: new MultiScope(MainScopes.normal,MainScopes.utility)
}

export class Parser {

	constructor(public tokens: TokenIterator, public ctx: CompilationContext) {
		MainScopes.global.init(this);
		MainScopes.normal.init(this);
		MainScopes.utility.init(this);
	}

	parse() {
		this.ctx.script.statements.push(...this.parseMultiStatements(Scopes.global));
	}

	parseStatement(scope: Scope): Statement {
		// skip comments (and add them into the file)
		/* if (this.tokens.peek(0,true).type == TokenType.comment) {
			let comment = this.tokens.peek(0,true);
			this.tokens.next();
			return e=>{
				e.write("# " + comment.value);
			}
		} */
		// skip raw commands (and add them into the file)
		if (this.tokens.isTypeNext(TokenType.raw_command)) {
			let cmd = this.tokens.next();
			return e=>{
				e.write(cmd.value);
			}
		}
		// empty line
		if (this.tokens.isTypeNext(TokenType.line_end)) {
			this.tokens.next();
			return undefined;
		}
		// parse annotations
		if (parseAnnotation(this.tokens)) {
			return e=>{}
		}
		let annotations = [...this.ctx.collectedAnnotations];
		this.ctx.currentAnnotations = [...annotations];
		this.ctx.collectedAnnotations = [];
		scope.init(this);
		let statements: RegisteredStatement[] = scope.statements;
		let suggestions: FutureSuggestion[] = statements.filter(s=>!s.options.inclusive).map(s=>{
			return {value: s.options.keyword || s.func.name,desc: s.options.desc, type: CompletionItemKind.Keyword};
		});
		if (this.tokens.isTypeNext(TokenType.identifier)) {
			this.tokens.suggestHere(...suggestions);
		}
		for (let st of statements) {
			let pos = this.tokens.pos;
			if (!st.options.inclusive) { // statement starts by a keyword
				let kw = st.options.keyword;
				if (!kw) {
					kw = st.func.name;
				}
				
				if (!this.tokens.isNext(kw)) {
					continue
				}
				this.tokens.next();
			}
			try {
				console.log('trying to parse statement ' + st.func.name);
				let ret = st.func.call(scope);
				if (ret) { // if the return type is defined, the parsing is considered successful
					if (annotations.length > 0 && this.ctx.currentAnnotations.length > 0) {
						for (let a of this.ctx.currentAnnotations) {
							this.tokens.error(a.range,"Annotation <" + a.type.name + "> cannot be applied to this statement.")
						}
					}
					return ret;
				}
			} catch (err) {
				console.log("An internal compiler exception was thrown:",err);
				return e=>{}
			}
			this.tokens.pos = pos;
		}
	}
	/**
	 * Parses multiple statements, until there are no more tokens or the delimiter is reached
	 * @param scope The scope of the statements to parse
	 * @param delim An optional delimiter token to end the statement block
	 */
	parseMultiStatements(scope: Scope, delim?: string) {
		let statements: Statement[] = [];
		while (this.tokens.hasNext() && (!delim || this.tokens.peek().value != delim)) {
			if (this.tokens.peek().type == TokenType.line_end) { // skip empty lines
				this.tokens.next();
				continue;
			}
			this.tokens.commentBuffer = [];
			let s = this.parseStatement(scope);
			if (this.tokens.commentBuffer.length > 0) {
				let comments = [...this.tokens.commentBuffer];
				this.tokens.commentBuffer = [];
				statements.push(e=>{
					for (let c of comments) {
						e.write('#' + c.value);
					}
				})
			}
			if (s) { // if the result statement is defined, add it and expect a line end
				statements.push(s);
				this.tokens.nextLine(true);
			} else { // otherwise, add an invalid statement error and skip to the next line
				this.tokens.error(this.tokens.nextPos,"Invalid statement " + Tokens.tokenString(this.tokens.peek()));
				this.tokens.nextLine(false);
			}
		}
		return statements;
	}

	/**
	 * Parses a block of statements between { and }
	 * @param scope The scope of statements to parse
	 */
	parseBlock(scope: Scope): Statement {
		if (!this.tokens.expectValue('{')) return;
		this.ctx.enterBlock();
		let statements: Statement[] = this.parseMultiStatements(scope,'}');
		this.tokens.expectValue('}');
		this.ctx.exitBlock();
		return e=>{
			let sub = e.recreate();
			sub.evalAll(statements);
		}
	}

	
}



/**
 * Parses any expression. 
 * This is a very long and complicated algorithm. If I was you I wouldn't bother trying to understand how this monstrosity works.
 * @param type An optional type/types of expression to parse. When undefined, will try to parse any primitive value expression
 * @param required When false, if there were no valid expression nodes to parse, it won't add an error (by default it does)
 */
export function parseExpression<T>(tokens: TokenIterator, type?: VariableType<T> | VariableType<any>[], required: boolean = true): RangedLazy<T> {
	let expr: (OperatorNode | Lazy<any>)[] = [];
	let range: Range = {...tokens.nextPos};
	let prevValue = false;
	// first, we gather all possible expression nodes. Either an operator or a single value
	while (tokens.hasNext()) {
		if (tokens.isTypeNext(TokenType.operator)) {
			prevValue = false;
			let optok = tokens.peek();
			let op = getEnumByValue(Opcode,optok.value);
			if (!op) {
				break
			}
			tokens.next()
			expr.push(new OperatorNode(op,optok));
		} else {
			if (prevValue) break;
			if (tokens.isNext(')') || tokens.isTypeNext(TokenType.line_end)) break;
			// let types: VariableType<any>[] = type ? getAsArray(type).reduce((p,c)=>[...p,c,...(c.compatible ? c.compatible.map(cv=>VariableType.getById(cv)) : [])],[]) : undefined;
			// console.log('parsing single value of',validTypes ? validTypes.map(t=>t.name) : 'anything');
			const value = parseSingleValue(tokens,type);
			if (value) {
				prevValue = true;
				expr.push(value);
			} else {
				break;
			}
		}
	}
	tokens.endRange(range);
	// if we found no operators and no values, return undefined.
	if (expr.length == 0) {
		if (required) {
			tokens.errorNext("Expected " + (type ? getAsArray(type).map(v=>v.name).join('/') + ' ' : '') + "expression");
		}
		return undefined;
	}
	// iterates through all operator priorities and merge the nodes to one lazy value
	if (expr.length > 1) {
		for (let p = 0; p < opPrecedence.length; p++) {
			for (let i = 0; i < expr.length; i++) {
				let node = expr[i];
				if (node instanceof OperatorNode && getOpPrecedence(node.code) == p) {
					let opnode = node as OperatorNode;
					let leftNode = expr[i-1];
					let rightNode = expr[i+1];
					if (!rightNode || rightNode instanceof OperatorNode) {
						continue;
					}
					let mustBeUnary = leftNode === undefined || leftNode instanceof OperatorNode;
					let lazyleft: Lazy<any>
					if (!mustBeUnary) {
						lazyleft = leftNode as Lazy<any>
					}
					let lazyright = rightNode as Lazy<any>
					let combined: Lazy<any> = e=>{
						if (mustBeUnary) {
							let val = lazyright(e);
							if (!val) return;
							let operator = opnode.getOperator(val.type);
							if (!operator || !operator.unary) {
								e.error(opnode.token.range,"Operator " + opnode.code + " cannot be applied to " + val.type.name);
								return val;
							}
							let operation = operator.findOperation(val.type);
							let newVal = castExprResult(val,operation.op.type,e,opnode.token.range);
							let resultType = operation.op.result || operator.op.defaultResult;
							let result = operator.op.apply(newVal.value,undefined,e);
							return {value: result, type: resultType}
						}
						
						let left = lazyleft(e);
						let right = lazyright(e);
						if (left === undefined) {
							//console.log("no left value of expr!");
							return
						}
						if (right === undefined) {
							//console.log("no right value of expr!");
							return left;
						}
						//console.log('combining left: ' + JSON.stringify(left.value) + ' ' + node.token + ' right: ' + JSON.stringify(right.value || right))
						let leftType = left.type;
						let rightType = right.type;
						let operator = opnode.getOperator(leftType,rightType);
						if (!operator) {
							e.error(opnode.token.range,"Operator " + opnode.code + " cannot be applied to " + leftType.name + " and " + rightType.name);
							return {value: undefined, type: VariableTypes.any};
						}
						let operation = operator.findOperation(leftType,rightType);
						left = operation.castIfNeeded(left,e);
						right = operation.castIfNeeded(right,e);
						let resultType = operation.op.result;
						if (operator.unary != UnaryMode.always) {
							let res = operator.op.apply(left.value,right.value,e);
							return {value: res, type: resultType};
						} else {
							e.error(range,"Unary operator " + opnode.code + " cannot be applied to " + leftType.name + " and " + rightType.name);
							return {value: resultType.defaultValue, type: resultType};
						}
					}
					expr[i] = combined;
					expr.splice(i+1,1);
					if (!mustBeUnary) {
						expr.splice(i-1,1);
						i--;
					} else {
						i -= 2;
					}
				}
			}
		}
	} else {
		return Lazy.ranged(e=>{
			let res = (<Lazy<T>>expr[0])(e);
			return castExprResult(res,type,e,range);
		},range)
	}
	if (expr.length > 1) {
		console.log('uncombinable expr:',expr);
		tokens.error(range,"Cannot combine expression");
		return Lazy.rangedEmpty
	} else if (expr.length == 0) {
		tokens.error(range,"Empty expression");
		return Lazy.rangedEmpty
	}
	return Lazy.ranged(e=>{
		let res = (expr[0] as Lazy<any>)(e);
		if (res === undefined) return undefined;
		//console.log('expr res (type = ' + res.type.name + ')',res.value);
		let newRes = castExprResult(res,type,e,range);
		if (newRes) {
			return newRes;
		}
		return {type: type ? getAsArray(type)[0] : VariableTypes.any,value: undefined}
	},range);
}

/**
 * Parses a single value in an expression. If the next token is '(', will try to parse a full expression
 * @param tokens token stream
 * @param compatibles An optional type/types of values that can be parsed
 */
export function parseSingleValue(tokens: TokenIterator, partOfExpr?: VariableType<any> | VariableType<any>[]): RangedLazy<any> | undefined {
	let compatible: VariableType<any>[]
	if (partOfExpr) {
		compatible = getAsArray(partOfExpr).reduce((comp,t)=>[...comp,...(t.compatible || []).map(n=>VariableType.getById(n))],[]);
		compatible.push(...getAsArray(partOfExpr));
	}
	let accepts = function(type: VariableType<any>): boolean {
		return !compatible || compatible.indexOf(type) >= 0;
	}
	let range = tokens.startRange();
	let value: Lazy<any>
	if (tokens.skip('(')) {
		//console.log('parsing parentheses value');
		value = parseExpression(tokens,compatible);
		tokens.expectValue(')');
	} else if ((accepts(VariableTypes.selector) || accepts(VariableTypes.score) || accepts(VariableTypes.nbtAccess)) && (tokens.suggestHere('self') || tokens.isNext('@'))) {
		let sel = parseSelector(tokens);
		if (tokens.isNext('.','/')) {
			let range = tokens.startRange();
			let cmd = parseSelectorCommand(tokens,sel.type,false);
			tokens.endRange(range);
			value = e=>{
				let newE = e.recreate();
				let cmds: string[] = []
				newE.assignTarget(cmds);
				let res = cmd(sel,newE);
				if (isBoolean(res)) {
					let temp = e.generateTempScore('score');
					e.write('execute store result score ' + temp.asString + ' run ' + e.getLastCommand(cmds));
					return {value: temp.asScore, type: VariableTypes.score}
				} else if (res && (res.type == VariableTypes.nbtAccess || res.type == VariableTypes.score)) {
					return res;
				}
				e.error(range,"This method does not return a value");
			}
		} else {
			value = Lazy.literal(sel,VariableTypes.selector)
		}
	} else if (accepts(VariableTypes.int) && tokens.isTypeNext(TokenType.int)) {
		value = Lazy.literal(Number(tokens.next().value),VariableTypes.int);
	} else if (accepts(VariableTypes.double) && tokens.isTypeNext(TokenType.double)) {
		value = Lazy.literal(Number(tokens.next().value),VariableTypes.double);
	} else if (accepts(VariableTypes.string) && tokens.isTypeNext(TokenType.string)) {
		value = Lazy.literal(tokens.next().value,VariableTypes.string);
	} else if (accepts(VariableTypes.boolean) && tokens.suggestHere('true','false')) {
		value = Lazy.literal(VariableTypes.boolean.fromString(tokens.next().value),VariableTypes.boolean);
	} else if (accepts(VariableTypes.location) && tokens.isNext('<')) {
		value = Lazy.literal(parseLocation(tokens,true),VariableTypes.location);
	} else if (accepts(VariableTypes.predicate) && tokens.suggestHere(...Registry.loot_conditions.keys())) {
		value = parsePredicateNode(tokens);
	} else if (accepts(VariableTypes.score)) {
		let v = parseResultSuccessValue(tokens,false,false);
		if (v) {
			value = e=>{
				let res = v.toCommand(e);
				if (res.literal) {
					return {value: Score.constant('#' + res.cmd), type: VariableTypes.score}
				} else if (res.value && res.value.type == VariableTypes.score) {
					return res.value;
				} else {
					let temp = e.generateTempScore('score');
					e.write('execute store ' + v.rs + ' score ' + temp.asString + ' ' + res.cmd);
					return {value: temp.asScore, type: VariableTypes.score}
				}
			}
		}
	}
	if (value === undefined && accepts(VariableTypes.condition)) {
		let cond = parseConditionNode(tokens);
		if (cond) {
			value = Lazy.literal(cond,VariableTypes.condition);
		}
	}
	if (value === undefined) {
		if (partOfExpr) {
			tokens.suggestHere(...tokens.ctx.getVariableSuggestions(...compatible));
		}
		if (tokens.isTypeNext(TokenType.identifier)) {
			let id = tokens.next();
			value = getLazyVariable(id);
		}
		
	}
	// if (tokens.skip('this') && tokens.ctx.insideClassDef) {
	// 	let access = parseObjectInstanceAccess(tokens,e=>e.getVariable('this'));
	// 	if (access) {
	// 		tokens.endRange(range);
	// 		return Lazy.ranged((e)=>{
	// 			return access(e)
	// 		},range);
	// 	}
	// }
	// if (compatibles && !isArray(compatibles) && compatibles.isClass) {
	// 	let v = parseNewInstanceCreation(tokens);
	// 	tokens.endRange(range);
	// 	return Lazy.ranged(e=>{
	// 		return {value: <T><unknown>e.valueOf(v),type: compatibles}
	// 	},range);
	// }
	tokens.endRange(range);
	return Lazy.ranged(value,range);
}

/**
 * Casts a result of an expression to the specified target type(s).
 * @param res The result value of the expression
 * @param type The target type/types that was expected
 * @param e The current evaluator
 * @param range The range the expression takes (for diagnostics & such)
 */
export function castExprResult<T>(res: Variable<any>, type: VariableType<T> | VariableType<any>[], e: Evaluator, range: Range): Variable<T> {
	if (!res) return;
	if (!res.type || res.type == VariableTypes.any) return
	if (!type) return res;
	let types: VariableType<any>[] = getAsArray(type);
	for (let t of types) {
		if (res.type === t) return res;
	}
	// iterate once for types that don' need casting, then find a castable type
	for (let t of types) {
		if (res.type !== t){
			let cast = VariableType.getImplicitCast(res.type,t);
			if (cast) {
				return {value: cast(res.value,e),type: t};
			}
		}
	}
	e.error(range,(res.type ? res.type.name : "Unknown type") + " cannot be cast to " + types.map(t=>t.name).join(', '));
	return res;
}

export type Condition = {
	eval: (e: Evaluator, negated: boolean)=>string
	negate?: boolean // true to use 'unless' before instead of 'if'
	includesNegation?: boolean // true to add neither 'if' or 'unless' before this condition
} | ((e: Evaluator, negated: boolean)=>string)


export function getCondEval(cond: Condition): (e: Evaluator, neg: boolean)=>string {
	return typeof cond == 'function' ? cond : cond.eval;
}

export function evalCond(cond: Condition, e: Evaluator) {
	//console.log('evaling cond',cond);
	if (!cond) return 'if entity @e';
	else if (typeof cond == 'function') return 'if ' + cond(e,false); 
	else return (cond.includesNegation ? '' : (negationStr(cond.negate) + ' ')) + cond.eval(e,cond.negate);
}

function prependRun(command: string) {
	return command.startsWith('execute') ? command.substr('execute '.length) : 'run ' + command;
}

export function parseCondition(tokens: TokenIterator): Lazy<Condition> {
	return parseExpression(tokens,VariableTypes.condition);
	/* let neg = tokens.isNext('!') ? tokens.next() : undefined
	let cond = parseConditionNode(tokens,neg);
	if (!cond) return;
	return {
		eval: getCondEval(cond),
		negate: neg !== undefined,
		includesNegation: typeof cond == 'function' ? false : cond.includesNegation
	} */
}


export function parseConditionNode(tokens: TokenIterator): Condition {
	let token = tokens.peek();
	switch (token.value) {
		case 'block': {
			tokens.skip();
			let pos = parseLocation(tokens);
			if (tokens.skip('==')) { // if block
				let block = Parsers.block.parse(tokens,{nbt: true,tag: true});
				return e=>{
					return 'block ' + toStringPos(pos,e) + ' ' + toStringBlock(block(e,{}),e)
				}
			}
			let path = parseNBTPath(tokens,true,Registry.tile_entities.createPathContext().strict(false));
			if (!path) {
				tokens.errorNext('Expected block NBT path or "[pos] == <block>"');
			}
			return e=>'data block ' + toStringPos(pos,e) + ' ' + toStringNBTPath(path,e) // if data block
		}
		case 'area': // if blocks
			return
		case 'storage': // if data storage
			tokens.skip();
			tokens.expectValue(':');
			let id = tokens.expectType(TokenType.identifier);
			let path = parseNBTPath(tokens,true,new NBTPathContext({}));
			return e=>'data storage ' + id.value + ' ' + toStringNBTPath(path,e)
	}
}

/**
 * Returns a lazy value of a possible variable referenced with the specified token. 
 * If that variable doesn't exist, will mark an error in the token's range.
 * @param name The name token of the variable
 */
export function getLazyVariable(name: Token): Lazy<any> {
	return e=>{
		//console.log('getting lazy variable ' + name.value)
		let v = e.getVariable(name.value);
		e.file.editor.addSemantic(name.range,SemanticType.variable);
		if (!v) {
			e.error(name.range,"Unknown variable " + name.value);
			return {value: undefined,type: VariableTypes.any};
		} else {
			e.file.editor.addSymbol(name.range,name.value,SymbolKind.Variable,DocumentHighlightKind.Read);
			e.file.editor.declarationLinks.push({range: name.range, decl: v.decl});
		}
		return v;
	}
}
