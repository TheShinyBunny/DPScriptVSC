
import { Scope, RegisterStatement, Statement, parseExpression } from '../parser';
import { TokenType, Token, Tokens } from '../tokenizer';
import * as oop from '../oop';
import { VariableTypes, Score } from '../util';

export class GlobalScope extends Scope {

	@RegisterStatement()
	import(): Statement {
		let path = this.tokens.expectType(TokenType.string);
		return e=>{
			e.import(path);
		}
	}

	@RegisterStatement({desc: "Specify code to run when the datapack loads, on the first tick"})
	load(): Statement {
		let name: Token = {range: this.tokens.nextPos, value: "init", type: TokenType.identifier};
		if (this.tokens.isTypeNext(TokenType.identifier)) {
			name = this.tokens.next();
		}
		let code = this.parser.parseBlock("function");
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

	@RegisterStatement({desc: "Specify code to run every server tick, at the beginning of the tick"})
	tick(): Statement {
		let name: Token = {range: this.tokens.nextPos, value: "loop", type: TokenType.identifier};
		if (this.tokens.isTypeNext(TokenType.identifier)) {
			name = this.tokens.next();
		}
		let code = this.parser.parseBlock("function");
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

	@RegisterStatement({desc: "Define a custom .mcfunction file (also handy to not have to write code multiple times)"})
	function(): Statement {
		let name = this.tokens.expectType(TokenType.identifier);
		let code = this.parser.parseBlock("function");
		if (!code) {
			this.tokens.errorNext("Expected code block");
			return e=>{};
		}
		this.ctx.script.functions.push(name.value);
		return e=>{
			e.addFunction(name,code);
		}
	}

	@RegisterStatement({desc: "Create a constant integer variable to be used as a score"})
	const(): Statement {
		let name = this.tokens.expectType(TokenType.identifier);
		this.tokens.expectValue('=');
		let value = parseExpression(this.tokens,VariableTypes.integer);
		this.ctx.addVariable(name,VariableTypes.score);
		return e=>{
			e.setVariable(name.value,{value: Score.constant(name.value),type: VariableTypes.score});
			let v = e.valueOf(value);
			e.createConst(v,name.value);
		}
	}

	@RegisterStatement({inclusive: true})
	classDecl(): Statement {
		return oop.parseClassDeclaration(this.tokens);
	}
}