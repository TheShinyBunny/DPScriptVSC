
import { Score, VariableType, VariableTypes, NumberRange, Ranges, parseLocation, toStringPos, Operator, operators, dummyOperator, formatRange, negationStr, Variable, toLowerCaseUnderscored, Opcode, getEnumByValue, CustomVariableParsers, VariableOperation, equalsAny, getAsArray, UnaryMode, DeclaredVariable } from './util';
import { TokenIterator, Token, TokenType, Tokens } from "./tokenizer";
import { EditorHelper, CompilationContext, DPScript, FutureSuggestion, ImportPath, mapFullPath, DeclarationSpan } from './compiler';
import { MCFunction, Namespace, WritingTarget, DatapackProject, ResourceLocation, Files } from ".";
import { Range, CompletionItemKind, SymbolKind, DocumentHighlightKind, Location } from 'vscode-languageserver';
import { parseNBTPath, NBTPathContext, toStringNBTPath } from './nbt';

export type Statement = (e: Evaluator)=>(Variable<any> | boolean | void);

export type Lazy<T> = ((e: Evaluator)=> Variable<T>) & {range?: Range}

export type UntypedLazy<T> = (e: Evaluator) => T

export namespace Lazy {
	export const empty: Lazy<any> = untyped(e=>undefined)

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

	export function ranged<T>(func: Lazy<T>, range: Range): Lazy<T> {
		func.range = range;
		return func;
	}

	export function untyped<T>(value: UntypedLazy<T>): Lazy<T> {
		return e=>{
			return {value: value(e),type: VariableTypes.any};
		}
	}
}

export interface RegisteredStatement {
	options: StatementOptions;
	func: (scope?: ScopeType, instance?: Scope)=>Statement | undefined;
}

export interface StatementOptions {
	keyword?: string;
	inclusive?: boolean;
	desc?: string;
}

export function RegisterStatement(options?: StatementOptions) {
	return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
		console.log('adding statement ' + propertyKey + ' to scope ' + target);
		if (!target.registered) {
			target.registered = [];
		}
		
		target.registered.push({options: {keyword: options ? options.keyword || propertyKey : propertyKey ,inclusive: options ? options.inclusive : false}, func: descriptor.value});
	}
}

export abstract class Scope {

	statements: RegisteredStatement[];
	tokens: TokenIterator;
	ctx: CompilationContext;
	
	constructor(protected parser: Parser) {
		this.tokens = parser.tokens;
		this.ctx = parser.ctx;
		this.statements = Object.getPrototypeOf(this).registered;
	}
}

import { ClassDefinition, parseNewInstanceCreation, parseObjectInstanceAccess, TypeFlag, ClassScope } from './oop';

/**
 * The evaluator is an object responsible of providing context between all statement, and writing the commands to the functions.
 */
export class Evaluator {
	
	objectives: string[] = []
	loadFunction?: MCFunction;
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
		this.file.namespace.ticks.push(f);
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
	valueOf<T>(lazy: Lazy<T> | UntypedLazy<T> | LazyCompoundEntry<T> | T, defValue?: any): T {
		if (lazy === undefined) return defValue;
		if (typeof lazy !== 'function') return <T>lazy;
		let res = lazy.call(this,this);
		if (res === undefined) return defValue;
		if (res.value !== undefined && res.type) {
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
		console.log("requiring class " + name.value + ". current classes:", this.classes.map(c=>c.name.value));
		let c = this.getClass(name.value);
		if (c) return c;
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


export type ScopeType = "global" | "function" | "class"



import { GlobalScope } from './scopes/global';
import { NormalScope } from './scopes/normal';
import { UtilityScope } from './scopes/utility';
import { getScript, SemanticType } from '../server';
import { Tag, UnresolvedTag } from './tags';
import { isArray } from 'util';
import { Registry } from './registries';
import { type } from 'os';
import { Parsers } from './parsers/parsers';
import { LazyCompoundEntry } from './data_structs';
import { toStringBlock } from './parsers/block';

export class Parser {

	scopeMap: {[type: string]: Scope[]};

	constructor(public tokens: TokenIterator, public ctx: CompilationContext) {
		let global = new GlobalScope(this);
		let normal = new NormalScope(this);
		let util = new UtilityScope(this);
		let cls = new ClassScope(this);
		this.scopeMap = {
			global: [global,util],
			function: [normal,util],
			class: [cls]
		}
	}

	parse() {
		this.ctx.script.statements.push(...this.parseMultiStatements('global'));
	}

	parseStatement(scope: ScopeType): Statement {
		if (this.tokens.peek(0,true).type == TokenType.comment) {
			let comment = this.tokens.peek(0,true);
			this.tokens.next();
			return e=>{
				e.write("# " + comment.value);
			}
		}
		if (this.tokens.isTypeNext(TokenType.raw_command)) {
			let cmd = this.tokens.next();
			return e=>{
				e.write(cmd.value);
			}
		}
		if (this.tokens.isTypeNext(TokenType.line_end)) {
			this.tokens.next();
			return undefined;
		}
		let possibleScopes = this.scopeMap[scope];
		let statements: RegisteredStatement[] = possibleScopes.map(s=>s.statements).reduce((prev,curr)=>prev.concat(curr),[]);
		let suggestions: FutureSuggestion[] = statements.filter(s=>!s.options.inclusive).map(s=>{
			return {value: s.options.keyword || s.func.name,desc: s.options.desc, type: CompletionItemKind.Keyword};
		});
		if (this.tokens.isTypeNext(TokenType.identifier)) {
			this.tokens.suggestHere(...suggestions);
		}
		for (let sc of possibleScopes) {
			for (let st of sc.statements) {
				let pos = this.tokens.pos;
				if (!st.options.inclusive) {
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
					console.log("trying to parse statement " + st.options.keyword);
					this.ctx.currentScope = scope;
					let ret = st.func.call(sc,scope,sc);
					if (ret) {
						return ret;
					}
				} catch (err) {
					console.log("An internal compiler exception was thrown:",err);
					return;
				}
				this.tokens.pos = pos;
			}
		}
	}
	/**
	 * Parses multiple statements, until there are no more tokens or the delimiter is reached
	 * @param scope The scope of the statements to parse
	 * @param delim An optional delimiter token to end the statement block
	 */
	parseMultiStatements(scope: ScopeType, delim?: string) {
		let statements: Statement[] = [];
		while (this.tokens.hasNext() && (!delim || this.tokens.peek(0,true).value != delim)) {
			if (this.tokens.peek(0,true).type == TokenType.line_end) {
				this.tokens.next();
				continue;
			}
			this.ctx.currentScope = scope;
			let s = this.parseStatement(scope);
			if (s) {
				statements.push(s);
				this.tokens.nextLine(true);
			} else {
				console.log('invalid statement: ' + this.tokens.peek().value);
				this.tokens.error(this.tokens.nextPos,"Invalid statement " + Tokens.tokenString(this.tokens.peek()));
				this.tokens.nextLine(false);
			}
		}
		return statements;
	}

	parseBlock(scope: ScopeType): Statement {
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

class OperatorNode {

	constructor(public code: Opcode, public token: Token) {

	}

	getOperator(left: VariableType<any>, right?: VariableType<any>) {
		return operators.filter(o=>o.token == this.code).filter(o=>{
			let score = this.getOpScore(o,left,right);
			return score > 0
		}).sort((o1,o2)=>{
			let s1 = this.getOpScore(o1,left,right);
			let s2 = this.getOpScore(o2,left,right);
			return s2 - s1;
		})[0]
	}

	findOperation(op: Operator, first: VariableType<any>, second?: VariableType<any>) {
		for (let c of op.operations) {
			if (this.getOperationScore(c,first,second) > 0) {
				return c;
			}
		}
	}

	getOpScore(op: Operator, left: VariableType<any>, right?: VariableType<any>) {
		return op.operations.map(o=>this.getOperationScore(o,left,right)).reduce((p,c)=>Math.max(p,c),0);
	}

	getOperationScore(op: VariableOperation, first: VariableType<any>, second?: VariableType<any>) {
		let s1 = this.getArrangementScore(op,first,second);
		let s2 = this.getArrangementScore(op,second,first);
		return Math.max(s1,s2);
	}

	getArrangementScore(op: VariableOperation, first: VariableType<any>, second?: VariableType<any>): number {
		let cast = VariableType.getCastPriority(first,op.type);
		if (cast > 0) {
			if (second) {
				if (op.second) {
					let cast2 = getAsArray(op.second).map(v=>VariableType.getCastPriority(second,v)).reduce((p,c)=>Math.max(p,c),0)
					if (cast2 > 0) {
						return Math.max(cast,cast2);
					}
				} else {
					let cast2 = VariableType.getCastPriority(second,op.type);
					if (cast2 > 0) {
						return Math.max(cast,cast2);
					}
				}
			} else {
				return cast;
			}
		}
		return 0;
	}

	getResultType(op: Operator, first: VariableType<any>, second?: VariableType<any>): VariableType<any> {
		let vop = this.findOperation(op,first,second);
		if (!vop) return;
		return vop.result;
	}
}

/**
 * Parses any expression. 
 * This is a very long and complicated algorithm. If I was you I wouldn't bother trying to understand how this monstrosity works.
 * @param type An optional type of expression to parse. When undefined, will try to parse any primitive value expression
 * @param required When false, if there were no valid expression nodes to parse, it won't add an error (by default it does)
 */
export function parseExpression<T>(tokens: TokenIterator, type?: VariableType<T> | VariableType<any>[], required: boolean = true): Lazy<T> {
	if (type && !isArray(type) && !type.isPrimitive) {
		let v = parseSingleValue(tokens,type);
		if (!v && required) {
			tokens.errorNext("Expected " + (type ? type.name + ' ' : '') + "value");
			v = undefined;
		}
		return v;
	}
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
			console.log('the valid types are',type ? getAsArray(type).map(t=>t.name) : 'anything');
			let validTypes: VariableType<any>[] = undefined;
			if (type) {
				validTypes = [];
				for (let t of getAsArray(type)) {
					if (validTypes.indexOf(t) < 0) {
						validTypes.push(t);
					}
					if (t.compatible) {
						for (let c of t.compatible) {
							let cv = VariableType.getById(c);
							if (validTypes.indexOf(cv) < 0) {
								validTypes.push(cv)
							}
						}
					}
				}
			}
			// let types: VariableType<any>[] = type ? getAsArray(type).reduce((p,c)=>[...p,c,...(c.compatible ? c.compatible.map(cv=>VariableType.getById(cv)) : [])],[]) : undefined;
			console.log('parsing single value of',validTypes ? validTypes.map(t=>t.name) : 'anything');
			const value = parseSingleValue(tokens,validTypes);
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
		for (let p = 0; p < 10; p++) {
			for (let i = 0; i < expr.length; i++) {
				let node = expr[i];
				if (node instanceof OperatorNode) {
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
							let operation = opnode.findOperation(operator,val.type);
							let newVal = castExprResult(val,operation.type,e,opnode.token.range);
							let resultType = opnode.getResultType(operator,val.type) || operator.defaultResult;
							let result = operator.apply(newVal.value,undefined,e);
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
						let resultType = opnode.getResultType(operator,leftType,rightType) || operator.defaultResult;
						if (operator.unary != UnaryMode.always) {
							let res = operator.apply(left.value,right.value,e);
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
		return Lazy.empty
	} else if (expr.length == 0) {
		tokens.error(range,"Empty expression");
		return Lazy.empty
	}
	return Lazy.ranged(e=>{
		let res = (expr[0] as Lazy<any>)(e);
		if (res === undefined) return undefined;
		console.log('expr res (type = ' + res.type.name + ')',res.value);
		let newRes = castExprResult(res,type,e,range);
		if (newRes) {
			return newRes;
		}
		return {type: type ? getAsArray(type)[0] : VariableTypes.any,value: undefined}
	},range);
}

export function parseSingleValue<T>(tokens: TokenIterator, compatibles?: VariableType<any>[] | VariableType<T>): Lazy<T> | undefined {
	if (tokens.skip('(')) {
		//console.log('parsing parentheses value');
		let expr = parseExpression(tokens,compatibles);
		tokens.expectValue(')');
		return expr;
	}
	
	let pos = tokens.pos;
	for (let p of CustomVariableParsers) {
		let res = p(tokens,(t)=>{
			if (!compatibles) return true;
			return getAsArray(compatibles).indexOf(t) >= 0
		});
		if (res !== undefined) return res;
		tokens.pos = pos;
	}
	if (compatibles) {
		for (let c of getAsArray(compatibles)) {
			if (c.parser) {
				let r = c.parser(tokens);
				if (r !== undefined) return r;
				tokens.pos = pos;
			}
		}
	}
	if (tokens.skip('this') && tokens.ctx.insideClassDef) {
		let access = parseObjectInstanceAccess(tokens,e=>e.getVariable('this'));
		if (access) {
			return (e)=>{
				return access(e)
			};
		}
	}
	if (compatibles && !isArray(compatibles) && compatibles.isClass) {
		let v = parseNewInstanceCreation(tokens);
		return e=>{
			return {value: <T><unknown>e.valueOf(v),type: compatibles}
		}
	}
	if (tokens.isTypeNext(TokenType.identifier) && !tokens.isNext('self')) {
		let id = tokens.next();
		let v = getLazyVariable(id);
		let access = parseObjectInstanceAccess(tokens,v);
		return access || v;
	}
}

function castExprResult<T>(res: Variable<any>, type: VariableType<T> | VariableType<any>[], e: Evaluator, range: Range): Variable<T> {
	if (!res) return;
	if (!res.type || res.type == VariableTypes.any) return
	if (!type) return res;
	let types: VariableType<any>[] = getAsArray(type);
	for (let t of types) {
		if (res.type === t) return res;
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
			let path = parseNBTPath(tokens,true,Registry.tile_entities.createPathContext());
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
