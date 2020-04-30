
import { Score, VariableType, VariableTypes, NumberRange, Ranges, parseBlock, parseLocation, toStringPos, Operator, operators, dummyOperator, formatRange, negationStr, Variable } from './util';
import { TokenIterator, Token, TokenType, Tokens } from "./tokenizer";
import { EditorHelper, CompilationContext, DPScript, FutureSuggestion } from './compiler';
import { parseSelector, Selector } from './selector';
import { MCFunction, Namespace, WritingTarget } from ".";
import { Range, CompletionItemKind } from 'vscode-languageserver';
import { parseNBTPath, createNBTContext, nbtRegistries } from './nbt';

export type Statement = (e: Evaluator)=>any;

export type Lazy<T> = ((e: Evaluator)=> Variable<T>) & {range?: Range}

export namespace Lazy {
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
}

export interface RegisteredStatement {
	options: StatementOptions;
	func: (scope?: ScopeType)=>Statement | undefined;
}

export interface StatementOptions {
	keyword?: string;
	inclusive?: boolean;
	desc?: string;
}

export function RegisterStatement(options?: StatementOptions) {
	return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
		if (Object.getPrototypeOf(target) instanceof Scope) {
			console.warn("@RegisterStatement can only be used in Scope classes");
			return;
		}
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
 * The evaluator is an object responsible of providing context for any statement, and writing the command to the functions.
 */
export class Evaluator {
	
	objectives: string[] = []
	loadFunction?: MCFunction;
	variables: {[name: string]: Variable<any>} = {};
	generatedFunctions: {[prefix: string]: number} = {};
	temps: {[prefix: string]: number} = {};
	consts: {[name: string]: number};
	classes: ClassDefinition[] = [];
	insideClass: ClassDefinition;
	disableWriting: boolean
	disableLangFeatures: boolean

	constructor(public namespace: Namespace, public editor: EditorHelper, public target?: WritingTarget) {
		
	}

	recreate(): Evaluator {
		let e = new Evaluator(this.namespace,this.editor,this.target);
		e.loadFunction = this.loadFunction;
		e.variables = {...this.variables};
		e.generatedFunctions = this.generatedFunctions;
		e.temps = this.temps;
		e.consts = {...this.consts};
		e.disableWriting = this.disableWriting;
		e.disableLangFeatures = this.disableLangFeatures;
		e.insideClass = this.insideClass;
		e.classes = [...this.classes];
		return e;
	}

	addFunction(name: Token, statement: Statement): MCFunction | undefined {
		if (this.getFunction(name.value)) {
			this.editor.error(name.range,"Duplicate function " + name.value);
			return undefined;
		}
		let func = new MCFunction(this.namespace,name.value);
		let e = this.recreate();
		e.target = func;
		statement(e);
		if (!this.disableWriting) {
			this.namespace.add(func);
		}
		return func;
	}

	requireFunction(name: Token): MCFunction {
		let func = this.getFunction(name.value);
		if (!func) {
			this.error(name.range,"Unknown function '" + name.value + "'");
		}
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
		let func = new MCFunction(this.namespace,name);
		if (cmds) {
			func.commands = cmds;
			console.log('>> inside ' + func.toString());
			cmds.forEach(c=>console.log('+ ' + c));
			console.log('<<');
		}
		if (!this.disableWriting) {
			this.namespace.add(func);
		}
		return func;
	}

	getFunction(name: string) {
		return this.namespace.getFunction(name);
	}

	/**
	 * Add a command to the load tagged function
	 * @param cmd The command to add
	 */
	load(cmd: string) {
		if (this.disableWriting) return;
		if (!this.loadFunction) {
			this.loadFunction = this.namespace.createFunction("init");
			this.namespace.loads.push(this.loadFunction);
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
			this.target.add(...cmd);
		}
	}

	evalFile(file: DPScript) {
		this.classes.push(...file.classes);
		for (let s of file.statements) {
			this.temps = {};
			s(this);
		}
	}

	error(range: Range, msg: string) {
		if (this.disableLangFeatures) return;
		this.editor.error(range,msg);
	}

	warn(range: Range, msg: string) {
		if (this.disableLangFeatures) return;
		this.editor.warn(range,msg);
	}

	suggestAt(range: Range, ...suggestions: FutureSuggestion[]) {
		if (this.disableLangFeatures) return;
		this.editor.suggestAll(range,...suggestions);
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

	setVariable<T>(name: string, variable: Variable<T>) {
		this.variables[name] = variable;
	}

	getVariable(name: string) {
		return this.variables[name];
	}

	addLoadFunction(f: MCFunction) {
		if (this.disableWriting) return;
		if (this.loadFunction) {
			if (this.loadFunction.name == f.name && f.name == 'init') {
				this.loadFunction.add(...f.commands);
			} else {
				this.namespace.loads.push(f);
			}
		} else {
			this.loadFunction = f;
			this.namespace.loads.push(f);
		}
	}

	addTickFunction(f: MCFunction) {
		if (this.disableWriting) return;
		this.namespace.ticks.push(f);
	}

	import(file: Token) {
		
	}

	/**
	 * 
	 * @param lazy The lazy/normal value
	 * @param defValue A default value if the provided value is undefined, or its lazy result is undefined
	 */
	valueOf<T>(lazy: Lazy<T> | T, defValue?: any): T {
		if (lazy === undefined) return defValue;
		if (!Lazy.is(lazy)) return <T>lazy;
		let res = (<Lazy<any>>lazy)(this);
		if (res === undefined) return defValue;
		return res.value == undefined ? defValue : res.value;
	}

	stringify(lazy: Lazy<any>): string {
		if (lazy) {
			let res = lazy(this);
			return res.type.stringify(res.value,this);
		}
		return ''
	}

	getCommandWithRun(funcPrefix: string, statement: Statement) {
		let cmd = this.getCommand(funcPrefix,statement);
		return prependRun(cmd);
	}

	getCommand(funcPrefix: string, statement: Statement) {
		let cmds: string[] = []
		let t: WritingTarget = {
			add: (...cs)=>{
				cmds.push(...cs)
			}
		}
		let e = this.recreate();
		e.target = t;
		if (!statement) {
			e.write('say EMPTY STATEMENT!');
		} else {
			statement(e);
		}
		if (cmds.length > 1) {
			return 'function ' + this.generateFunction(funcPrefix,cmds).toString();
		}
		return cmds.length > 0 ? cmds[0] : 'say EMPTY STATEMENT!'
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
		if (this.consts[name || '#' + value] !== undefined) return Score.constant(name || '#' + value);
		this.ensureObjective('Consts');
		let score = Score.constant(name || '#' + value);
		this.load(`scoreboard players set ${Score.toString(score,this)} ${value}`);
		this.consts[name || '#' + value] = value;
		return score;
	}

	ensureConst(entry: string) {
		let value = Number(entry.substr(1));
		if (entry.startsWith('#') && !isNaN(value) && !this.hasConst(entry)) {
			this.consts['#' + value] = value;
			this.ensureObjective('Consts');
			this.load('scoreboard players set #' + value + ' Consts ' + value);
		}
	}

	hasConst(name: string) {
		return this.consts[name] !== undefined;
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
}

export class TempScore {
	constructor(public e: Evaluator, public name: string) {

	}

	asString: string = this.name + ' temps';

	asScore: Score = {entry: Lazy.literal(this.name,VariableTypes.string),objective: 'temps'}

	set(n: number) {
		return 'scoreboad players set ' + this.asString + ' ' + n;
	}

	matches(range: NumberRange) {
		return this.asString + ' matches ' + Ranges.toString(range);
	}
}


export type ScopeType = "global" | "function" | "class";



import { GlobalScope } from './scopes/global';
import { NormalScope } from './scopes/normal';
import { UtilityScope } from './scopes/utility';

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
		if (this.tokens.peek(true).type == TokenType.comment) {
			let comment = this.tokens.peek(true);
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
		this.tokens.suggestHere(...suggestions);
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
					let ret = st.func.call(sc,scope);
					console.log(ret);
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
		while (this.tokens.hasNext() && (!delim || this.tokens.peek(true).value != delim)) {
			if (this.tokens.peek(true).type == TokenType.line_end) {
				this.tokens.next();
				continue;
			}
			let s = this.parseStatement(scope);
			if (s) {
				statements.push(s);
				console.log('token after statement:',Tokens.tokenString(this.tokens.peek()));
				this.tokens.nextLine(true);
				console.log('token after statement + new line:',Tokens.tokenString(this.tokens.peek()));
			} else {
				console.log('invalid statement: ' + this.tokens.peek().value);
				this.tokens.error(this.tokens.nextPos,"Invalid statement " + Tokens.tokenString(this.tokens.peek()));
				this.tokens.nextLine(false);
			}
		}
		console.log("token after multi statements of " + scope,Tokens.tokenString(this.tokens.peek()));
		return statements;
	}

	parseBlock(scope: ScopeType): Statement {
		this.tokens.expectValue('{');
		console.log('parsing block');
		this.ctx.enterBlock();
		let statements: Statement[] = this.parseMultiStatements(scope,'}');
		this.tokens.expectValue('}');
		this.ctx.exitBlock();
		return e=>{
			let sub = e.recreate();
			for (let s of statements) {
				e.temps = {};
				s(sub);
			}
		}
	}

	
}

/**
 * Parses any expression. 
 * Very long and complicated, if I was you I wouldn't bother trying to understand how this monstrosity works.
 * @param tokens 
 * @param type An optional type of expression to parse. When undefined, will try to parse any native value expression
 * @param required When false, if there were no valid expression nodes to parse, it won't add an error (by default it does)
 */
export function parseExpression<T>(tokens: TokenIterator, type?: VariableType<T>, required: boolean = true): Lazy<T> {
	console.log('parsing expression ' + (type ? type.name : ''));
	if (type && !type.isNative) {
		let v = parseSingleValue(tokens,type);
		if (!v && required) {
			tokens.errorNext("Expected " + (type ? type.name + ' ' : '') + "value");
			v = type ? Lazy.literal(type.defaultValue,type) : undefined;
		}
		return v;
	}
	let expr: (Operator | Lazy<any>)[] = [];
	let range: Range = {...tokens.nextPos};
	let prevUnary: Operator | undefined = undefined;
	let unaryFunc: undefined | ((v: any, e: Evaluator)=>any) = undefined;
	let skipNextValue = false;
	let prevValue = false;
	// first, we gather all possible expression nodes. Either an operator or a single value
	while (tokens.hasNext()) {
		if (tokens.isTypeNext(TokenType.operator)) {
			prevValue = false;
			let pos = tokens.pos;
			let opcode = tokens.next();
			let op = operators.find(o=>o.token == opcode.value);
			if (!op) {
				tokens.error(opcode.range,"Unknown operator");
				op = dummyOperator;
			}
			if (expr.length == 0 || (expr[expr.length-1] as Operator).token) {
				if (op.unary) {
					if (prevUnary && unaryFunc) {
						let prevFunc: (v: any, e: Evaluator)=>any = unaryFunc;
						unaryFunc = (v,e)=>op.unary(prevFunc(v,e),e);
					} else {
						prevUnary = op;
						unaryFunc = op.unary;
					}
				} else {
					tokens.error(opcode.range,"Cannot have this operator as the first node in an expression!");
				}
			} else if (op.apply) {
				expr.push(op);
			} else {
				tokens.error(opcode.range,"Invalid usage of a unary operator");
				skipNextValue = true;
			}
		} else {
			if (prevValue) break;
			if (tokens.isNext(')') || tokens.isTypeNext(TokenType.line_end)) break;
			const value = parseSingleValue(tokens);
			if (value) {
				if (skipNextValue) {
					skipNextValue = false;
					continue
				}
				prevValue = true;
				if (prevUnary && unaryFunc) {
					let unary = unaryFunc;
					let fpu = prevUnary;
					expr.push(<Lazy<any>>((e)=>({value: unary(e.valueOf(value),e),type: fpu.result})));
				} else {
					expr.push(value);
				}
			} else {
				break;
			}
		}
	}
	tokens.endRange(range);
	// if we found no operators and no values, return undefined.
	if (expr.length == 0) {
		if (required) {
			tokens.errorNext("Expected " + (type ? type.name + ' ' : '') + "expression");
		}
		return undefined;
	}
	// iterates through all operator priorities and merge the nodes to one lazy value
	console.log('expr:')
	console.log(expr);
	for (let p = 0; p < 10; p++) {
		for (let i = 0; i < expr.length; i++) {
			let node = expr[i] as Operator;
			if (node.token && node.priority == p) {
				let lazyleft = expr[i-1] as Lazy<any>;
				let lazyright = expr[i+1] as Lazy<any>;
				if (!lazyright) {
					break;
				}
				
				let combined: Lazy<any> = e=>{
					let left = lazyleft(e);
					let right = lazyright(e);
					if (left === undefined) {
						console.log("no left value of expr!");
						return
                    }
                    if (right === undefined) {
						console.log("no right value of expr!");
						return {value: undefined, type: undefined};
                    }
					console.log('combining left: ' + JSON.stringify(left.value) + ' ' + node.token + ' right: ' + JSON.stringify(right.value || right))
					let leftType = left.type || right.type;
					let rightType = right.type || left.type;
					let isValid: boolean = true;
					if (leftType && rightType) {
						if (typeof node.valid == 'function') {
							isValid = node.valid(leftType,rightType);
						} else {
							isValid = VariableType.canCast(rightType,node.valid) && VariableType.canCast(leftType,node.valid);
						}
					}
					let resultType: VariableType<any> = node.defaultResult || <VariableType<any>>node.result;
					if (typeof node.result == 'function') {
						if (leftType && rightType) {
							resultType = node.result(leftType,rightType);
						}
					} else {
						resultType = node.result;
					}
					if (isValid && node.apply) {
						let res = node.apply(left.value,right.value,e);
						console.log('combine result:');
						console.log(res);
						return {value: res, type: resultType};
					} else {
						e.error(range,"Operator " + node.token + " cannot be applied to " + leftType.name + ", " + rightType.name);
						return {value: resultType.defaultValue, type: resultType};
					}
				}
				expr[i] = combined;
				expr.splice(i+1,1);
				expr.splice(i-1,1);
				i -= 2;
			}
		}
	}
	if (expr.length > 1) {
		console.log('uncombinable expr:')
		console.log(expr);
		tokens.error(range,"Cannot combine expression");
	}
	return Lazy.ranged(e=>{
		let res = (expr[0] as Lazy<any>)(e);
		console.log('expr res: ' + JSON.stringify(res));
		console.log('or in other repr: ' + res);
		console.log(res);
		if (res && type && type.castFrom && res.type !== type){
			return {value: type.castFrom(res.type,res.value,e),type};
		} else if (res && !VariableType.canCast(res.type,type)) {
			e.error(range,(res.type ? res.type.name : "Unknown type") + " cannot be cast to " + (type ? type.name : "any type"));
		}
		return res;
	},range);
}

export function parseSingleValue<T>(tokens: TokenIterator, type?: VariableType<T>): Lazy<T> | undefined {
	console.log('parsing single value of type ' + type);
	if ((!type || type.isNative) && tokens.skip('(')) {
		console.log('parsing parentheses value');
		let expr = parseExpression(tokens,type);
		tokens.expectValue(')');
		return expr;
	}
	let pos = tokens.pos;
	for (let n of VariableType.all()) {
		if ((!type && n.isNative) || type == n) {
			if (n.expressionParser) {
				let x = n.expressionParser(tokens,VariableTypes);
				if (x) return x;
			} else if (n.literalParser) {
				let value = n.literalParser(tokens);
				if (!value) continue;
				return Lazy.literal(value,n);
			} else if (n.tokens) {
				if (tokens.isTypeNext(...n.tokens)) {
					let t = tokens.next().value;
					return Lazy.literal(n.fromString ? n.fromString(t) : t,n);
				}
			}
		}
		tokens.pos = pos;
	}
	console.log("couldn't parse a single value with a variable type parser, trying to parse variable");
	if (tokens.skip('this') && tokens.ctx.insideClassDef) {
		let access = parseObjectInstanceAccess(tokens,e=>e.getVariable('this'));
		if (access) {
			return access;
		}
	}
	if (type && tokens.isNext('new') && type.isClass) {
		let v = parseNewInstanceCreation(tokens);
		return e=>{
			return {value: <T><unknown>e.valueOf(v),type}
		}
	}
	if (tokens.isTypeNext(TokenType.identifier)) {
		let id = tokens.next();
		let v = getLazyVariable(id);
		let access = parseObjectInstanceAccess(tokens,v);
		return access || v;
	} else {
		tokens.next();
	}
}

export type Condition = {
	eval: (e: Evaluator, negated: boolean)=>string
	negate?: boolean // true to use 'unless' before instead of 'if'
	includesNegation?: boolean // true to add neither 'if' or 'unless' before this condition
} | ((e: Evaluator, negated: boolean)=>string)


export function getCondEval(cond: Condition): (e: Evaluator, neg: boolean)=>string {
	return typeof cond == 'function' ? cond : cond.eval;
}

function isNegated(cond: Condition): boolean {
	return typeof cond == 'function' ? false : cond.negate;
}

export function evalCond(cond: Condition, e: Evaluator) {
	if (!cond) return 'if @e';
	if (typeof cond == 'function') return 'if ' + cond(e,false); 
	return (cond.includesNegation ? '' : (negationStr(cond.negate) + ' ')) + cond.eval(e,cond.negate);
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
		/* case '(':
			tokens.skip();
			let c = parseChainedCondition(tokens);
			tokens.expectValue(')');
			return c; */
		case 'block': {// if block
			tokens.skip();
			let pos = parseLocation(tokens);
			if (tokens.skip('==')) {
				let block = parseBlock(tokens,true);
				return e=>{
					return 'block ' + toStringPos(pos,e) + ' ' + e.stringify(block)
				}
			}
			let path = parseNBTPath(tokens,true);
			if (!path) {
				tokens.errorNext('Expected block NBT path or "== <block id>"');
				if (tokens.isNext('=')) {
					tokens.skip();
				}
			}
			return e=>'data block ' + toStringPos(pos,e) + ' ' + e.valueOf(path)
		}
		case 'area': // if blocks
			return
		case '@':
		case 'self':
			let pos = tokens.pos;
			let selector = parseSelector(tokens);
			if (tokens.skip('#')) { // if data entity
				let path = parseNBTPath(tokens,false,createNBTContext(nbtRegistries.entities,selector.type));
				return e=>'data entity ' + Selector.toString(selector,e) + ' ' + e.valueOf(path)
			} else if (tokens.isNext('.')) { // if score <selector>
				tokens.pos = pos;
				break;
			} else { // if entity
				return e=>'entity ' + Selector.toString(selector,e)
			}
		case 'storage': // if data storage
			tokens.skip();
			tokens.expectValue(':');
			let id = tokens.expectType(TokenType.identifier);
			let path = parseNBTPath(tokens,true);
			return e=>'data storage ' + id.value + ' ' + e.valueOf(path);
	}
	/* let range = {...tokens.nextPos}
	let left = parseExpression(tokens,VariableTypes.score,false);
	if (!left) {
		tokens.errorNext('Expected condition');
		return;
	}
	let op = tokens.expectValue(...Object.keys(CompareOperator).map(k=>CompareOperator[k]));
	tokens.endRange(range);
	let right = parseExpression(tokens,VariableTypes.score);
	if (!right) return e=>'';
	return e=>{
		return 'score ' + toStringScoreComparison(left,op,right,e);
	} */
}

export function parseChainedCondition(tokens: TokenIterator): Condition {
	let negatedLeft = tokens.isNext('!') ? tokens.next() : undefined;
	let left = parseConditionNode(tokens);
	if (!left) return;
	if (!tokens.isNext('&&','||')) {
		return {
			eval: getCondEval(left),
			negate: (negatedLeft != undefined) != isNegated(left)
		}
	}
	let op = tokens.expectValue('&&','||');
	let negatedRight = tokens.isNext('!') ? tokens.next() : undefined;
	let right = parseConditionNode(tokens);
	if (!right) return
	return {
		eval: (e,neg)=>{
			if (op == '&&') {
				return evalCond(left,e) + ' ' + evalCond(right,e)
			} else {
				let t = e.generateTempScore('orFlag');
				e.write(t.set(0))
				e.write('execute ' + evalCond(left,e) + ' run ' + t.set(1));
				e.write('execute ' + evalCond(right,e) + ' run ' + t.set(1));
				return negationStr(neg) + ' score ' + t.matches(1);
			}
		},
		includesNegation: true,
		negate: false
	}
}

export function toStringScoreComparison(left: Score | number, right: Score | number, e: Evaluator, op: string) {
	let n = undefined;
	let score: Score;
	if (typeof left == 'number') {
		n = left;
		score = <Score>right;
	} else if (typeof right == 'number') {
		n = right;
		score = left;
	}
	if (n !== undefined) {
		return Score.toString(score,e) + ' matches ' + formatRange(n,op);
	}
	return Score.toString(<Score>left,e) + ' ' + op + ' ' + Score.toString(<Score>right,e);
}


export function getLazyVariable(name: Token): Lazy<any> {
	return e=>{
		console.log('getting lazy variable ' + name.value)
		let v = e.getVariable(name.value);
		if (!v) {
			e.error(name.range,"Unknown variable " + name.value);
			return {value: undefined,type: undefined};
		}
		return v;
	}
}
