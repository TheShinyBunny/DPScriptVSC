import { Scope, RegisterStatement, Statement, Lazy, parseExpression, Evaluator } from '../parser';
import { TokenType, Token } from '../tokenizer';
import { VariableTypes, Score, VariableType } from '../util';
import { praseJson, JsonContext, JsonTextType } from '../json_text';
import * as oop from '../oop';
import { SymbolKind, DocumentHighlightKind } from 'vscode-languageserver';


export class UtilityScope extends Scope {
	@RegisterStatement({desc: "Create a score entry that is assigned to a fake entity"})
	global(): Statement {
		let name = this.tokens.expectType(TokenType.identifier);
		let value: Lazy<number>;
		if (this.tokens.skip('=')) {
			value = parseExpression(this.tokens,VariableTypes.integer);
		}
		return this.makeVariableStatement(name,VariableTypes.score,value,e=>{
			e.ensureObjective('Global');
			if (value) {
				e.load("scoreboard objectives set " + name.value + " Global " + e.valueOf(value));
			}
		});
	}

	@RegisterStatement()
	bossbar(): Statement {
		let name = this.tokens.expectType(TokenType.identifier);
		let displayName: Lazy<any>;
		if (this.tokens.skip('=')) {
			displayName = praseJson(this.tokens,new JsonContext(JsonTextType.title));
		}
		return this.makeVariableStatement(name,VariableTypes.bossbar,displayName,e=>{
			e.load('bossbar add ' + name.value + (displayName ? ' ' + e.stringify(displayName) : ''))
		})
	}

	@RegisterStatement({inclusive: true})
	varDeclaration(): Statement {
		if (!this.tokens.isTypeNext(TokenType.identifier)) return;
		let type = this.tokens.expectType(TokenType.identifier);
		this.ctx.editor.addSymbol(type.range,type.value,SymbolKind.Class);
		for (let t of VariableType.all()) {
			if (t.instancible !== false && t.name === type.value) {
				let name = this.tokens.expectType(TokenType.identifier);
				return this.makeVariableStatement(name,t);
			}
		}
		let name = this.tokens.expectType(TokenType.identifier);
		this.ctx.editor.addSymbol(name.range,name.value,SymbolKind.Variable,DocumentHighlightKind.Write);
		if (!this.tokens.isNext('=')) return;
		this.tokens.expectValue('=');
		let res = oop.parseNewInstanceCreation(this.tokens);
		this.ctx.addVariable(name,VariableType.create(type.value));
		if (!res) return;
		return e=>{
			let v = res(e);
			if (v) {
				e.setVariable(name.value,{...v, decl: e.toLocation(name.range)});
			}
		}
	}

	makeVariableStatement(name: Token, type: VariableType<any>, defaultVal?: Lazy<any>, additionalStatement?: (e: Evaluator)=>any): Statement {
		this.ctx.editor.addSymbol(name.range,name.value,SymbolKind.Variable,DocumentHighlightKind.Write);
		let val = defaultVal;
		if (!val) {
			this.tokens.expectValue('=')
			val = parseExpression(this.tokens,type);
		}
		if (val) {
			this.ctx.addVariable(name,type);
			return e=>{
				e.setVariable(name.value,{...val(e), decl: e.toLocation(name.range)});
				if (additionalStatement) {
					return additionalStatement(e);
				}
			}
		} else {
			this.tokens.errorNext("Expected " + type.name + " value");
		}
		return;
	}
}