
import { Scope, RegisterStatement, Statement, parseExpression } from '../parser';
import { TokenType, Token, Tokens } from '../tokenizer';
import * as oop from '../oop';
import { VariableTypes, Score, parsePathToken } from '../util';
import { mapFullPath } from '../compiler';
import * as fs from 'fs';
import * as paths from 'path';

export class GlobalScope extends Scope {

	@RegisterStatement()
	import(): Statement {
		if (this.tokens.suggestHere('pack')) {
			this.tokens.skip();
			let path = parsePathToken(this.tokens,TokenType.line_end);
			return e=>{
				if (path.extension) {
					e.importPackFromZip(path);
				} else {
					e.importPackFromDir(path);
				}
			}
		}
		let path = parsePathToken(this.tokens,TokenType.line_end);
		for (let i = 0; i < path.nodes.length; i++) {
			let node = path.nodes[i];
			let fullPath = mapFullPath(this.ctx.dir,path,i);
			if (i == path.nodes.length -1) fullPath += '.dps';
			console.log("full imported path:",fullPath);
			let files = fs.readdirSync(paths.dirname(fullPath));
			console.log('files in dir:',files);
			this.tokens.suggest(node.range,...files.filter(f=>paths.extname(f) === '.dps').map(f=>paths.basename(f,'.dps')).filter(f=>f != this.ctx.script.name));
			if (!fs.existsSync(fullPath)) {
				this.tokens.error(node.range,"This " + (i < path.nodes.length - 1 || path.all ? 'directory' : 'file') + " does not exist!");
				break;
			}
		}
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
			let f = e.createFunction(name,code,true);
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
			let f = e.createFunction(name,code,true);
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
		let func = this.ctx.script.createFunction(name.value,true);
		return e=>{
			let newE = e.recreate();
			newE.target = func;
			code(newE);
			e.addFunction(func);
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