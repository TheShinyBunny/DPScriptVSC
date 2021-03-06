import { CompletionItemKind, DiagnosticSeverity, MarkedString, MarkupContent, Range } from 'vscode-languageserver';
import { Position } from 'vscode-languageserver-textdocument';
import { Block, CompoundExpression, Expression, FunctionStatement, IdentifierExpression, UnaryExpression, Statement, ValueExpression, ObjectiveStatement, CastedExpression, PrintStatement } from './ast';
import { Datapack, DPScriptFile, MCFunction, ExportableType } from './project';
import { operators, Token, Tokenizer, TokenType } from './tokenizer';
import { Execute } from './execute'
import { ValueType, ValueTypes } from './types/types';
import { NumberType } from './types/numbers';
import { ResourceLocation } from './utils';
import { BinaryOperator, Operators } from './operators';
import { DPScript } from './compiler';
import {inspect} from 'util'

export abstract class AbstractContext {

	abstract getVariableType(name: Token): ValueType<any>

}

export interface Variable {
	name: Token
	type: ValueType<any>
	decl: Range
}


export interface Suggestion {
	kind?: CompletionItemKind
	value: string
	detail?: string
	desc?: string
}

export class Parser extends AbstractContext {
	

	token: Token
	prevToken: Token
	lookahead: Token[] = []
	script: DPScript
	contextSelfType?: ResourceLocation

	variables: {[name: string]: Variable}[] = [{}]
	uniques: {[id: string]: Token[]} = {}

	constructor(public tokens: Tokenizer,public file: DPScriptFile, public project: Datapack) {
		super()
		this.script = new DPScript(file.name,file.uri);
	}

	nextToken() {
		this.prevToken = this.token;
		if (this.lookahead.length > 0) {
			this.token = this.lookahead.shift();
		} else {
			this.token = this.tokens.getNextToken();
		}
		return this.prevToken;
	}

	peek(lookahead: number = 0): Token {
		if (lookahead == 0) {
			return this.token;
		} else {
			for (let i = this.lookahead.length; i < lookahead; i++) {
				this.lookahead.push(this.tokens.getNextToken());
			}
			return this.lookahead[lookahead - 1];
		}
	}
	

	hasNext() {
		return this.tokens.canRead();
	}

	isTypeNext(...type: TokenType[]) {
		return type.indexOf(this.peek().type) >= 0;
	}

	isNext(...value: string[]) {
		return value.indexOf(this.peek().value) >= 0;
	}

	expectType(type: TokenType) {
		if (this.isTypeNext(type)) {
			return this.nextToken()
		}
		this.error(this.token.range,"Expected " + TokenType[type]);
		return Token.dummy('',type)
	}

	expectValue(value: string) {
		if (this.isNext(value)) {
			this.nextToken()
			return true;
		}
		this.error(this.token.range,"Expected " + value);
		return false;
	}

	nextLine() {
		while (this.hasNext() && !this.isTypeNext(TokenType.line_end)) {
			this.nextToken()
		}
	}

	skipUntil(...values: string[]) {
		while (this.hasNext() && !this.isTypeNext(TokenType.line_end)) {
			if (this.isNext(...values)) break
			this.nextToken()
		}
	}

	error(range: Range, msg: string) {
		this.file.diagnostics.push({range,message: msg,severity: DiagnosticSeverity.Error})
	}

	suggestHere(...suggestions: Suggestion[]) {
		console.log('suggesting at',this.token.range,suggestions)
		this.file.addSuggestions(this.token.range,...suggestions)
	}

	setHover(range: Range, hover: MarkupContent | MarkedString | MarkedString[]) {
		this.file.setHover(range,hover)
	}

	pushVariables() {
		this.variables.unshift({})
	}

	popVariables() {
		this.variables.shift()
	}

	pushed(run: ()=>void) {
		this.pushVariables()
		run()
		this.popVariables()
	}

	addUnique(id: string, name: Token) {
		let arr = this.uniques[id]
		if (!arr) {
			arr = this.uniques[id] = []
		}
		if (arr.find(n=>n.value == name.value)) {
			this.error(name.range,"Duplicate " + id + ': ' + name.value)
		} else {
			arr.push(name)
		}
	}

	getVariableType(name: Token, require = false): ValueType<any> {
		let v = this.getVariable(name,require);
		if (v) return v.type
	}

	getVariable(name: Token, require = false): Variable {
		for (let f of this.variables) {
			if (f[name.value]) {
				return f[name.value]
			}
		}
		
		if (require) {
			this.error(name.range,"Unknown variable " + name.value)
		}
	}

	addVariable(name: string, v: Variable) {
		if (this.variables.length > 0) {
			this.variables[this.variables.length-1][name] = v
		}
	}

	parseFile(): DPScript {
		console.log('Compiling DPScript file',this.file.name);
		while (this.hasNext()) {
			this.nextToken();
			if (this.isTypeNext(TokenType.line_end)) {
				continue
			}
			let s = this.parseGlobalStatement();
		}
		console.log('Done compiling',inspect(this.script,true,null,false))
		return this.script;
	}

	parseGlobalStatement() {
		if (this.isTypeNext(TokenType.keyword)) {
			switch (this.token.value) {
				case 'tick':
					return this.parseTick();
				case 'load':
					return this.parseLoad();
				case 'function':
					return this.parseFunction();
				case 'declare':
				case 'objective':
					return this.parseObjective()
			}
		}
	}

	parseObjective() {
		let declareOnly = false;
		if (this.isNext('declare')) {
			declareOnly = true;
			this.nextToken()
			if (!this.isNext('objective')) return
		}
		this.nextToken()
		let criterion = 'dummy';
		if (this.isNext('<')) {
			this.nextToken();
			criterion = ""
			while (this.hasNext() && !this.isNext('>') && !this.isTypeNext(TokenType.line_end)) {
				criterion += this.nextToken().value
			}
		}
		if (!this.isTypeNext(TokenType.identifier)) {
			this.error(this.nextToken().range,"Expected objective name")
			return 
		}
		let name = this.nextToken()
		if (this.getVariableType(name)) {
			this.error(name.range,"Duplicate variable named " + name.value)
		} else {
			this.addVariable(name.value,{decl: name.range,name,type: ValueTypes.objective})
		}
		this.script.global.push(new ObjectiveStatement({name,type: criterion},declareOnly))
	}

	parseTick() {
		let startToken = this.token;
		this.nextToken()
		let name = startToken.withValue('loop');
		if (this.isTypeNext(TokenType.identifier)) {
			name = this.token;
			this.nextToken()
		}
		let code = this.parseCodeBlock();
		//this.file.addSymbolGroup(pos,this.pos,)
		let func = new FunctionStatement(name,code,'minecraft:tick');
		this.addUnique('function',name)
		this.script.global.push(func);
	}

	parseLoad() {
		let startToken = this.token;
		this.nextToken()
		let name = startToken.withValue('init');
		if (this.isTypeNext(TokenType.identifier)) {
			name = this.token;
			this.nextToken()
		}
		let code = this.parseCodeBlock();
		//this.file.addSymbolGroup(pos,this.pos,)
		let func = new FunctionStatement(name,code,'minecraft:load');
		this.addUnique('function',name)
		this.script.global.push(func)
	}

	parseFunction() {
		this.nextToken()
		let name = this.expectType(TokenType.identifier);
		//this.recoverTo('{');
		let code = this.parseCodeBlock();
		let func = new FunctionStatement(name,code);
		this.addUnique('function',name)
		this.script.global.push(func);
		this.file.export({name, type: ExportableType.function});
	}

	/**
	 * Defines this script to be a part of another script (and should be in the same namespace)
	 */
	parsePartOf() {

	}

	parseCodeBlock(): Block {
		if (!this.isNext('{')) {
			this.error(this.token.range,"Expected code block");
			return new Block([])
		}
		this.nextToken()
		let statements: Statement[] = []
		this.pushVariables()
		while (this.hasNext() && !this.isNext('}')) {
			if (this.isTypeNext(TokenType.line_end)) {
				this.nextToken()
				continue
			}
			console.log('parsing statement starting with: ',this.token)
			let s = this.parseStatement();
			if (s) {
				statements.push(s)
				console.log('added statement',s)
				if (this.hasNext()) {
					if (!this.isTypeNext(TokenType.line_end)) {
						this.error(this.token.range,"Unexpected token")
					}
					
					this.nextLine()
				}
			} else {
				this.error(this.token.range,'Unknown statement')
				this.nextLine()
			}
			
		}
		this.popVariables()
		this.expectValue('}')
		return new Block(statements);
	}

	parseStatement(): Statement {
		if (this.isTypeNext(TokenType.keyword)) {
			let kw = this.token.value;
			switch (kw) {
				case 'print':
					this.nextToken()
					let str = this.parseExpression(ValueTypes.string)
					return new PrintStatement(str)
				case 'for':
					return Execute.parseFor(this)
				case 'as':
					return Execute.parseAs(this)
				case 'at':
					return Execute.parseAt(this)
				case 'self':
					return this.parseSelectorStatement()
				case 'if':
					return Execute.parseIf(this)
			}
		}
		if (this.isNext('@')) return this.parseSelectorStatement()
		if (this.isNext('{')) return this.parseCodeBlock()
	}

	parseSelectorStatement() {
		let sel = ValueTypes.selector.parse(this);
		if (sel) {
			return ValueTypes.selector.parseAccess(this,sel,{},true)
		}
	}

	parseExpression<T>(type?: ValueType<T>): Expression<T> {
		let start = this.token.range.start
		let expr = this.parseOr()
		if (type && expr) {
			let res = expr.getResult(this)
			if (res && !res.matches(type)) {
				let casts = type.getCasts()
				if (!casts.find(c=>c.type.matches(res))) {
					this.error({start,end: this.prevToken.range.end},"Expected an expression of type " + type.getDetail({},''))
				} else {
					return new CastedExpression(expr,type)
				}
			}
			return expr
		}
		return expr
	}

	parseOr(): Expression<any> {
		let expr = this.parseAnd()
		while (this.isNext('||')) {
			let op = this.nextToken()
			let right = this.parseAnd()
			expr = CompoundExpression.make(this,expr,op,right);
		}
		return expr
	}

	parseAnd(): Expression<any> {
		let expr = this.parseComparison()
		while (this.isNext('&&')) {
			let op = this.nextToken()
			let right = this.parseComparison()
			expr = CompoundExpression.make(this,expr,op,right);
		}
		return expr
	}

	parseComparison(): Expression<any> {
		let expr = this.parseRange()
		if ([">","<",">=","<=","==","!="].indexOf(this.peek().value) >= 0) {
			let op = this.nextToken()
			let right = this.parseRange()
			expr = CompoundExpression.make(this,expr,op,right);
		}
		return expr
	}

	parseRange(): Expression<any> {
		let expr = this.parseTerm()
		if (this.isNext('..')) {
			let op = this.nextToken()
			let right = this.parseTerm()
			expr = CompoundExpression.make(this,expr,op,right);
		}
		return expr
	}

	parseTerm(): Expression<any> {
		let expr = this.parseFactor()
		while (this.isNext('+') || this.isNext('-')) {
			let op = this.nextToken()
			let right = this.parseFactor()
			expr = CompoundExpression.make(this,expr,op,right);
		}
		return expr
	}

	parseFactor(): Expression<any> {
		let expr = this.parseUnary()
		while (this.isNext('*') || this.isNext('/') || this.isNext('%')) {
			let op = this.nextToken()
			let right = this.parseUnary()
			expr = CompoundExpression.make(this,expr,op,right);
		}
		return expr
	}

	parseUnary(): Expression<any> {
		if (Operators.isUnary(this.peek().value)) {
			let op = this.nextToken()
			let right = this.parseUnary()
			return new UnaryExpression(right,op)
		}
		return this.parseValueWithAccess()
	}

	parseValueWithAccess(): Expression<any> {
		let val = this.parseSingleValue()
		if (val instanceof ValueExpression) {
			console.log('parsing access of ',val)
			let access = val.type.parseAccess(this,val.value,{},false)
			console.log('access',access)
			if (access) return access as Expression<any>
		} else {
			// parse class access etc., and allow access chain
		}
		return val
	}

	parseSingleValue(): Expression<any> {
		if (this.isNext('(')) {
			this.nextToken();
			let expr = this.parseExpression();
			this.expectValue(')')
			return expr;
		}
		if (this.isTypeNext(TokenType.integer,TokenType.float,TokenType.byte,TokenType.double,TokenType.long,TokenType.short)) {
			let t = NumberType.createValue(this.nextToken());
			return new ValueExpression(t.type,t)
		}
		if (this.isTypeNext(TokenType.string)) {
			return new ValueExpression(ValueTypes.string,this.nextToken().value)
		}
		if (this.isNext('true') || this.isNext('false')) {
			return new ValueExpression(ValueTypes.boolean,this.nextToken().value == 'true')
		}
		if (this.isNext('@') || this.isNext('self')) {
			let sel = ValueTypes.selector.parse(this)
			if (sel) return new ValueExpression(ValueTypes.selector,sel);
		}
		/* if (this.isNext('#')) {
			let loc = ValueType.location.parse(this);
			if (loc) {
				return new ValueExpression(ValueType.location,loc);
			}
		}
		if (this.isNext('block')) {
			let b = ValueType.block.parse(this);
			if (b) {
				return new ValueExpression(ValueType.block,b);
			}
		}
		if (this.isNext('storage')) {
			let s = ValueType.storage.parse(this);
			if (s) {
				return new ValueExpression(ValueType.storage,s);
			}
		} */
		if (this.isTypeNext(TokenType.identifier)) {
			return new IdentifierExpression(this.nextToken())
		}
	}

	parseResourceLocation(pathSuggestions?: string[]): ResourceLocation {
		let start = this.token.range.start
		this.suggestHere({value:'minecraft:'})
		let first = this.expectType(TokenType.identifier);
		if (!first.isValid()) return
		let namespace = 'minecraft'
		let path = ''
		if (this.isNext(':')) {
			namespace = first.value
			this.nextToken()
			if (pathSuggestions) {
				this.suggestHere(...pathSuggestions.map(s=>({value: s})))
			}
			path += this.expectType(TokenType.identifier).value;
		} else {
			path += first.value
		}
		while (this.hasNext()) {
			if (!this.isNext('/')) {
				break;
			}
			this.nextToken()
			path += this.expectType(TokenType.identifier).value;
		}
		return new ResourceLocation(namespace,path,{start, end: this.prevToken.range.end})
	}

}