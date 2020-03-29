
import { TokenIterator, Token, TokenType, Tokens } from "./tokenizer";
import { EditorHelper, CompilationContext, DPScript } from './compiler';
import { parseSelector, parseSelectorCommand } from './selector';
import { Score, equalsAll, equalsOneOf, VariableType, equalsAny, VariableTypes } from './util';
import { MCFunction, Namespace } from ".";
import * as codeHelper from './code_helper';
import { Range } from 'vscode-languageserver';
import { praseJsonText, TextContext } from './json_text';


export type Statement = (e: Evaluator)=>any;

export type Lazy<T> = (e: Evaluator)=> {value: T, type: VariableType<T>};

export namespace Lazy {
	export function literal<T>(value: T, type: VariableType<T>): Lazy<T> {
		return (e)=>({type, value});
	}
}

interface RegisteredStatement {
	scope: Scope[];
	options: StatementOptions;
	func: ()=>Statement | undefined;
}

interface StatementOptions {
	keyword?: string | string[],
	inclusive?: boolean
}

function NormalStatement(options?: StatementOptions) {
	return RegisterStatement("function",options);
}

function GlobalStatement(options?: StatementOptions) {
	return RegisterStatement("global",options);
}

function RegisterStatement(scope: Scope | Scope[], options?: StatementOptions) {
	return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
		console.log(target);
		if (!target.statements) {
			target.statements = [];
		}
		
		target.statements.push({options: {keyword: options ? options.keyword || propertyKey : propertyKey ,inclusive: options ? options.inclusive : false}, func: descriptor.value, scope: typeof scope == 'string' ? [scope] : scope});
	}
}

export class Evaluator {
	
	objectives: string[] = []
	loadFunction?: MCFunction;
	variables: {[name: string]: Lazy<any>}[] = [{}];
	currentFunction?: MCFunction;
	constructor(public namespace: Namespace, public editor: EditorHelper) {

	}

	addFunction(name: Token, statement: Statement): MCFunction | undefined {
		if (this.getFunction(name.value)) {
			this.editor.error(name.range,"Duplicate function " + name.value);
			return undefined;
		}
		let func = new MCFunction(this.namespace,name.value);
		this.currentFunction = func;
		this.enterBlock();
		statement(this);
		this.exitBlock();
		this.namespace.add(func);
		this.currentFunction = undefined;
		return func;
	}

	requireFunction(name: Token) {
		let func = this.getFunction(name.value);
		if (!func) {
			this.error(name.range,"Unknown function '" + name.value + "'");
		}
		return func;
	}

	getFunction(name: string) {
		return this.namespace.getFunction(name);
	}

	load(cmd: string) {
		if (!this.loadFunction) {
			this.loadFunction = this.namespace.createFunction("init");
			this.namespace.loads.push(this.loadFunction);
		}
		this.loadFunction.add(cmd);
	}

	write(cmd: string) {
		if (this.currentFunction) {
			this.currentFunction.add(cmd);
		}
	}

	evalFile(file: DPScript) {
		for (let s of file.statements) {
			s(this);
		}
	}

	error(range: Range, msg: string) {
		this.editor.error(range,msg);
	}

	ensureObjective(name: string) {
		if (this.objectives.indexOf(name) < 0) {
			this.objectives.push(name);
			this.load("scoreboard objectives add " + name + " dummy");
		}
	}

	enterBlock() {
		this.variables.push({});
	}

	exitBlock() {
		this.variables.pop();
	}

	setVariable<T>(name: string, variable: Lazy<T>) {
		this.variables[this.variables.length-1][name] = variable;
	}

	getVariable(name: string) {
		return this.variables[this.variables.length-1][name];
	}

	addLoadFunction(f: MCFunction) {
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
		this.namespace.ticks.push(f);
	}

	import(file: Token) {
		
	}

	valueOf(lazy: any, defValue?: any) {
		if (!lazy) return defValue;
		if (!(<Lazy<any>>lazy).name) return lazy;
		let res = lazy(this);
		if (!res) return defValue;
		return res.value || defValue;
	}
}

interface Operator {
	token: string;
	apply?: (l: any, r: any)=>any;
	valid: VariableType<any> | ((l: VariableType<any>, r: VariableType<any>)=>boolean);
	priority: number;
	unary?: (v: any)=>any;
	result: VariableType<any> | ((l: VariableType<any>, r: VariableType<any>)=>VariableType<any>);
	defaultResult?: VariableType<any>
}

const operators: Operator[] = [
	{
		token: "+",
		apply: (l,r)=>l + r,
		valid: (l,r)=>equalsOneOf([l,r],[VariableTypes.integer,VariableTypes.double,VariableTypes.string]),
		priority: 2,
		unary: (v)=>v,
		result: (l,r)=>equalsAll(VariableTypes.integer,l,r) ? VariableTypes.integer : equalsAny(VariableTypes.string,l,r) ? VariableTypes.string : VariableTypes.double,
		defaultResult: VariableTypes.string
	},
	{
		token: "-",
		apply: (l,r)=>l - r,
		valid: (l,r)=>equalsOneOf([l,r],[VariableTypes.double,VariableTypes.integer]),
		priority: 2,
		unary: (v)=>-v,
		result: (l,r)=>l == VariableTypes.double || r == VariableTypes.double ? VariableTypes.double : VariableTypes.integer
	},
	{
		token: "||",
		apply: (l,r)=>l && r,
		valid: VariableTypes.boolean,
		priority: 0,
		result: VariableTypes.boolean
	},
	{
		token: "&&",
		apply: (l,r)=>l || r,
		valid: VariableTypes.boolean,
		priority: 0,
		result: VariableTypes.boolean
	},
	{
		token: "!",
		valid: VariableTypes.boolean,
		priority: 0,
		result: VariableTypes.boolean,
		unary: (v)=>!v
	}
]

const dummyOperator: Operator = {
	token: "",
	apply: (l,r)=>undefined,
	valid: (l,r)=>true,
	priority: 0,
	result: VariableTypes.integer
}

type Scope = "global" | "function";

export class Parser {

	statements: RegisteredStatement[];
	constructor(public tokens: TokenIterator, protected ctx: CompilationContext) {
		
	}

	parse() {
		let script = new DPScript();
		script.statements.push(...this.parseMultiStatements('global'));
		return script;
	}

	parseStatement(scope: Scope): Statement {
		if (this.tokens.peek(true).type == TokenType.comment) {
			let comment = this.tokens.peek(true);
			this.tokens.next();
			return e=>{
				e.write("# " + comment.value);
			}
		}
		if (this.tokens.isTypeNext(TokenType.line_end)) {
			this.tokens.next();
			return undefined;
		}
		for (let st of this.statements) {
			for (let sc of st.scope) {
				if (sc == scope) {
					let pos = this.tokens.pos;
					if (!st.options.inclusive) {
						let kw = st.options.keyword;
						if (!kw) {
							kw = st.func.name;
						}
						let kwarr = typeof kw == 'string' ? [kw] : kw;
						this.tokens.suggestHere(...kwarr);
						if (!this.tokens.isNext(...kwarr)) {
							continue
						}
						this.tokens.next();
					}
					try {
						console.log("trying to parse statement " + st.options.keyword);
						let ret = st.func.call(this);
						if (ret) {
							return ret;
						}
					} catch (err) {
						console.log("An internal compiler exception was thrown: " + err);
					}
					this.tokens.pos = pos;
				}
			}
		}
		return undefined;
	}

	@NormalStatement({inclusive: true})
	block(scope: Scope): Statement {
		if (!this.tokens.isNext('{')) return undefined;
		this.tokens.expectValue('{');
		this.ctx.enterBlock();
		let statements: Statement[] = this.parseMultiStatements(scope,'}');
		this.tokens.expectValue('}');
		this.ctx.exitBlock();
		return e=>{
			e.enterBlock();
			for (let s of statements) {
				s(e);
			}
			e.exitBlock();
		}
	}

	parseMultiStatements(scope: Scope, delim?: string) {
		let statements: Statement[] = [];
		while (this.tokens.hasNext() && (!delim || this.tokens.peek(true).value != delim)) {
			if (this.tokens.peek(true).type == TokenType.line_end) {
				this.tokens.next();
				continue;
			}
			let s = this.parseStatement(scope);
			if (s) {
				statements.push(s);
				this.tokens.nextLine(true);
			} else {
				this.tokens.error(this.tokens.nextPos,"Invalid statement " + Tokens.tokenString(this.tokens.peek()));
				this.tokens.nextLine(false);
			}
		}
		return statements;
	}
	
	@GlobalStatement()
	import(): Statement {
		let path = this.tokens.expectType(TokenType.string,()=>codeHelper.suggestImports(this.ctx.dir));
		return e=>{
			e.import(path);
		}
	}

	@GlobalStatement()
	load(): Statement {
		let name: Token = {range: this.tokens.nextPos, value: "init", type: TokenType.identifier};
		if (this.tokens.isTypeNext(TokenType.identifier)) {
			name = this.tokens.next();
		}
		let code = this.block("function");
		if (!code) {
			this.tokens.errorNext("Expected code block");
			return e=>{};
		}
		return e=>{
			let f = e.addFunction(name,code);
			if (f) {
				e.addLoadFunction(f);
			}
		}
	}

	@GlobalStatement()
	tick(): Statement {
		let name: Token = {range: this.tokens.nextPos, value: "loop", type: TokenType.identifier};
		if (this.tokens.isTypeNext(TokenType.identifier)) {
			name = this.tokens.next();
		}
		let code = this.block("function");
		if (!code) {
			this.tokens.errorNext("Expected code block");
			return e=>{};
		}
		return e=>{
			let f = e.addFunction(name,code);
			if (f) {
				e.addTickFunction(f);
			}
		}
	}

	@GlobalStatement()
	function(): Statement {
		let name = this.tokens.expectType(TokenType.identifier);
		let code = this.block("function");
		if (!code) {
			this.tokens.errorNext("Expected code block");
			return e=>{};
		}
		return e=>{
			e.addFunction(name,code);
		}
	}

	@GlobalStatement()
	const(): Statement {
		let name = this.tokens.expectType(TokenType.identifier);
		this.tokens.expectValue('=');
		let value = parseExpression(this.tokens,VariableTypes.integer);
		this.ctx.addVariable(name.value,VariableTypes.score);
		return e=>{
			e.ensureObjective("Consts");
			e.setVariable(name.value,Lazy.literal(Score.constant(name.value),VariableTypes.score));
			e.load(`scoreboard players set ${name.value} Consts ${e.valueOf(value)}`);
		}
	}

	@RegisterStatement(["global","function"])
	global(): Statement {
		let name = this.tokens.expectType(TokenType.identifier);
		let value: Lazy<number>;
		if (this.tokens.skip('=')) {
			value = parseExpression(this.tokens,VariableTypes.integer);
		}
		this.ctx.addVariable(name.value,VariableTypes.score);
		return e=>{
			e.ensureObjective(name.value);
			e.setVariable(name.value,Lazy.literal(Score.global(name.value),VariableTypes.score));
			if (value) {
				e.load("scoreboard objectives set " + name.value + " Global " + e.valueOf(value));
			}
		}
	}

	@RegisterStatement(["global","function"])
	bossbar(): Statement {
		let name = this.tokens.expectType(TokenType.identifier);
		let displayName: Lazy<any>;
		if (this.tokens.skip('=')) {
			displayName = praseJsonText(this.tokens,TextContext.title);
		}
		this.ctx.addVariable(name.value,VariableTypes.bossbar);
		return e=>{
			e.ensureObjective(name.value);
			e.setVariable(name.value,Lazy.literal(name.value,VariableTypes.bossbar));
			e.load("bossbar add " + name.value + " " + (displayName ? e.valueOf(displayName) : ""));
		}
	}

	@RegisterStatement(["global","function"])
	objective(): Statement {
		let name = this.tokens.expectType(TokenType.identifier);
		this.ctx.addVariable(name.value,VariableTypes.objective);
		return e=>{
			e.ensureObjective(name.value);
			e.setVariable(name.value,Lazy.literal(name.value,VariableTypes.objective));
		}
	}

	@NormalStatement()
	print(): Statement {
		let msg = parseExpression(this.tokens,VariableTypes.string);
		return e=>{
			e.write("say " + e.valueOf(msg));
		}
	}

	@NormalStatement({keyword: "@"})
	selector(): Statement {
		let selector = parseSelector(this.tokens);
		if (!selector) return undefined;
		let cmd = parseSelectorCommand(this.tokens);
		if (!cmd) {
			return e=>{};
		}
		return e=>{
			return cmd(selector,e);
		}
	}
	
	
}

export function parseExpression<T>(tokens: TokenIterator, type?: VariableType<T>, required: boolean = true): Lazy<T> {
	let expr: (Operator | Lazy<any>)[] = [];
	let range: Range = {...tokens.nextPos};
	let prevUnary: Operator | undefined = undefined;
	let unaryFunc: undefined | ((v: any)=>any) = undefined;
	let skipNextValue = false;
	let prevValue = false;
	while (tokens.hasNext()) {
		if (tokens.isTypeNext(TokenType.operator)) {
			prevValue = false;
			let opcode = tokens.next();
			let op = operators.find(o=>o.token == opcode.value);
			if (!op) {
				tokens.error(opcode.range,"Unknown operator");
				op = dummyOperator;
			}
			if (expr.length == 0 || (expr[expr.length-1] as Operator).token) {
				if (op.unary) {
					if (prevUnary && unaryFunc) {
						let prevFunc: (v: any)=>any = unaryFunc;
						unaryFunc = (v)=>prevFunc(v);
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
					expr.push(<Lazy<any>>((e)=>({value: unary(e.valueOf(value)),type: fpu.result})));
				} else {
					expr.push(value);
				}
			} else {
				break;
			}
		}
	}
	tokens.endRange(range);
	if (expr.length == 0) {
		if (required) {
			tokens.errorNext("Expected " + (type ? type.name + ' ' : '') + "expression");
		}
		return undefined;
	}
	for (let p = 0; p < 10; p++) {
		for (let i = 0; i < expr.length; i++) {
			let node = expr[i] as Operator;
			if (node.token && node.priority == p) {
				let lazyleft = expr[i-1] as Lazy<any>;
				let lazyright = expr[i+1] as Lazy<any>;
				
				let combined: Lazy<any> = e=>{
					let left = lazyleft(e);
					let right = lazyright(e);
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
						return {value: node.apply(left.value,right.value), type: resultType};
					} else {
						e.error(range,"Operator " + node.token + " cannot be applied to " + leftType + ", " + rightType);
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
		tokens.error(range,"Cannot combine expression");
	}
	return e=>{
		let res = (expr[0] as Lazy<any>)(e);
		if (res && !VariableType.canCast(res.type,type)) {
			e.error(range,"Expected " + type.name + " expression");
		}
		return res;
	}
}

function parseSingleValue(tokens: TokenIterator): Lazy<any> | undefined {
	let pos = tokens.pos;
	if (tokens.skip('(')) {
		let expr = parseExpression(tokens);
		tokens.expectValue(')');
		return expr;
	}
	if (tokens.isTypeNext(TokenType.identifier) && !tokens.isNext("true","false")) {
		let id = tokens.next();
		return getLazyVariable(id);
	}
	for (let n of VariableType.all()) {
		if (n.literalParser) {
			let value = n.literalParser(tokens);
			if (<Lazy<any>>value) return value;
			if (Lazy) return Lazy.literal(value,n);
		} else if (n.tokens) {
			if (tokens.isTypeNext(...n.tokens)) {
				return Lazy.literal(VariableType.castValue(tokens.next().value,n),n);
			}
		}
	}
	tokens.pos = pos;
}

export function getLazyVariable(name: Token): Lazy<any> {
	return e=>{
		let v = e.getVariable(name.value);
		if (!v) {
			e.error(name.range,"Unknown variable " + name.value);
			return {value: undefined,type: undefined};
		}
		return v(e);
	}
}

export function parseList<T>(tokens: TokenIterator, open: string, close: string, valueParser: ()=>T): T[] {
	let arr: T[] = [];
	tokens.expectValue(open);
	while (tokens.hasNext() && !tokens.isNext(close)) {
		let v = valueParser();
		arr.push(v);
		if (!tokens.skip(',')) {
			break;
		}
	}
	tokens.expectValue(close);
	return arr;
}

export function parseIdentifierOrIndex(tokens: TokenIterator, name: string, ...values: string[]): Lazy<string> {
	tokens.suggestHere(...values);
	if (tokens.isTypeNext(TokenType.string,TokenType.identifier)) {
		for (let v of values) {
			if (v.toLowerCase() == tokens.peek().value.toLowerCase()) {
				tokens.next();
				return Lazy.literal(v,VariableTypes.string);
			}
		}
	}
	let span = {...tokens.nextPos};
	let value: Lazy<any> = parseExpression(tokens);
	if (!value) return undefined;
	span.end = tokens.lastPos.end;
	return e=>{
		let res = value(e);
		if (res.type == VariableTypes.string) {
			for (let v of values) {
				if (v.toLowerCase() == res.value.toLowerCase()) {
					return {value: v,type: VariableTypes.string}
				}
			}
			e.error(span,"Expected one of " + values.join(', '));
			return {value: values[0],type: VariableTypes.string};
		} else if (res.type == VariableTypes.integer) {
			let i: number = res.value;
			console.log("number: '" + i + "'")
			if (i < 0 || i > values.length) {
				e.error(span,"Invalid " + name + " index, must be between 0 and " + (values.length-1));
				return {value: values[0],type: VariableTypes.string};
			}
			return {value: values[i],type: VariableTypes.string};
		}
		e.error(span,"Expected " + name + " expression to be an integer or a string");
		return {value: values[0],type: VariableTypes.string};
	}
}

export function parseResourceLocation(tokens: TokenIterator, tag?: boolean) {
	let loc = "";
	if (tokens.isTypeNext(TokenType.string)) {
		let t = tokens.next();
		if (t.value.startsWith('#') && !tag) {
			tokens.error(t.range,"Tags are not supported here");
		}
		return t.value;
	}
	if (tokens.isNext('#')) {
		if (tag) {
			loc += '#';
		} else {
			tokens.errorNext('Tags are not supported here');
		}
		tokens.next();
	}
	loc += tokens.expectType(TokenType.identifier).value;
	let path = false;
	if (tokens.skip(':')) {
		loc += ':';
		path = true;
	}
	if (tokens.skip('/') || path) {
		if (!path) {
			loc += '/';
		}
		while (tokens.hasNext()) {
			loc += tokens.expectType(TokenType.identifier).value;
			if (tokens.skip('/')) {
				loc += '/';
			} else {
				break
			}
		}
	}
	return loc;
}