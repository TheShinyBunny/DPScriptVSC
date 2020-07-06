
import { Scope, RegisterStatement, Statement, parseExpression } from '../parser';
import { TokenType, Token, Tokens } from '../tokenizer';
import * as oop from '../oop';
import { VariableTypes, Score, parseImportPath, ensureUnique } from '../util';
import { mapFullPath } from '../compiler';
import * as fs from 'fs';
import * as paths from 'path';
import { SymbolKind } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { uriToFilePath } from 'vscode-languageserver/lib/files';
import { parseTagDeclaration } from '../tags';
import { MCFunction } from '..';
import { makeVariableStatement } from './utility';
import { SemanticType, SemanticModifier } from '../../server';

export class GlobalScope extends Scope {

	@RegisterStatement()
	import(): Statement {
		if (this.tokens.suggestHere('pack')) {
			this.tokens.skip();
			let path = parseImportPath(this.tokens,TokenType.line_end);
			return e=>{
				if (path.extension) {
					e.importPackFromZip(path);
				} else {
					e.importPackFromDir(path);
				}
			}
		}
		let path = parseImportPath(this.tokens,TokenType.line_end);
		/* for (let i = 0; i < path.nodes.length; i++) {
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
		} */
		if (fs.existsSync(uriToFilePath(path.uri))) {
			this.ctx.editor.links.push({range: path.fullRange, target: path.uri})
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
			if (name.value == 'init' && e.loadFunction) {
				e.addStatementToFunction(e.loadFunction,code);
			} else {
				let f = e.createFunction(name,code,true);
				e.addLoadFunction(f);
			}
		}
	}

	@RegisterStatement({desc: "Specify code to run every server tick, at the beginning of the tick"})
	tick(): Statement {
		let startToken = this.tokens.lastToken;
		let range = {...startToken.range}
		let name: Token = {range: this.tokens.nextPos, value: "loop", type: TokenType.identifier};
		if (this.tokens.isTypeNext(TokenType.identifier)) {
			name = this.tokens.next();
			startToken = name;
		}
		
		let code = this.parser.parseBlock("function");
		if (!code) {
			this.tokens.errorNext("Expected code block");
			return e=>{};
		}
		this.tokens.endRange(range);
		this.ctx.editor.addSymbolGroup(startToken,range,SymbolKind.Function);
		return e=>{
			let f = e.createFunction(name,code,true);
			if (f) {
				e.addTickFunction(f);
			}
		}
	}

	@RegisterStatement({desc: "Define a custom .mcfunction file (also handy to not have to write code multiple times)"})
	function(): Statement {
		let range = {...this.tokens.lastToken.range}
		let name = this.tokens.expectType(TokenType.identifier);
		this.ctx.editor.addSemantic(name.range,SemanticType.function,SemanticModifier.declaration)
		let code = this.parser.parseBlock("function");
		if (!code) {
			this.tokens.errorNext("Expected code block");
			return e=>{};
		}
		this.tokens.endRange(range);
		let func: MCFunction;
		if (ensureUnique(this.tokens,name,this.ctx.script.functions,f=>f.name,"function")) {
			func = this.ctx.script.createFunction(name.value,true);
			func.declaration = {name: name.range, uri: this.ctx.script.uri, fullRange: range}
		}
		this.ctx.editor.addSymbolGroup(name,range,SymbolKind.Function);
		return e=>{
			let newE = e.recreate();
			newE.target = func;
			code(newE);
		}
	}

	@RegisterStatement({desc: "Create a constant integer variable to be used as a score"})
	const(): Statement {
		let name = this.tokens.expectType(TokenType.identifier);
		this.tokens.expectValue('=');
		let value = parseExpression(this.tokens,VariableTypes.integer);
		return makeVariableStatement(this.tokens,name,VariableTypes.score,false,Score.constant(name.value),e=>{
			let v = e.valueOf(value);
			e.createConst(v,name.value);
		})
	}

	@RegisterStatement({inclusive: true})
	classDecl(): Statement {
		return oop.parseClassDeclaration(this.tokens);
	}

	@RegisterStatement({inclusive: true})
	tag(): Statement {
		return parseTagDeclaration(this.tokens);
	}
}