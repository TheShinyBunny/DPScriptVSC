import { Scope, RegisterStatement, Statement, Lazy, parseExpression } from '../parser';
import { TokenType } from '../tokenizer';
import { VariableTypes, Score, VariableType } from '../util';
import { praseJson, JsonContext, JsonTextType } from '../json_text';
import * as oop from '../oop';


export class UtilityScope extends Scope {
	@RegisterStatement({desc: "Create a score entry that is assigned to a fake entity"})
	global(): Statement {
		let name = this.tokens.expectType(TokenType.identifier);
		let value: Lazy<number>;
		if (this.tokens.skip('=')) {
			value = parseExpression(this.tokens,VariableTypes.integer);
		}
		this.ctx.addVariable(name,VariableTypes.score);
		return e=>{
			e.ensureObjective('Global');
			e.setVariable(name.value,{value: Score.global(name.value),type: VariableTypes.score});
			if (value) {
				e.load("scoreboard objectives set " + name.value + " Global " + e.valueOf(value));
			}
		}
	}

	@RegisterStatement()
	bossbar(): Statement {
		let name = this.tokens.expectType(TokenType.identifier);
		let displayName: Lazy<any>;
		if (this.tokens.skip('=')) {
			displayName = praseJson(this.tokens,new JsonContext(JsonTextType.title));
		}
		this.ctx.addVariable(name,VariableTypes.bossbar);
		return e=>{
			e.setVariable(name.value,{value: name.value,type: VariableTypes.bossbar});
			e.load("bossbar add " + name.value + " " + (displayName ? e.stringify(displayName) : ""));
		}
	}

	@RegisterStatement()
	objective(): Statement {
		let name = this.tokens.expectType(TokenType.identifier);
		this.ctx.addVariable(name,VariableTypes.objective);
		return e=>{
			e.ensureObjective(name.value);
			e.setVariable(name.value,{value: name.value,type: VariableTypes.objective});
		}
	}

	@RegisterStatement({inclusive: true})
	varDeclaration(): Statement {
		if (!this.tokens.isTypeNext(TokenType.identifier)) return;
		let type = this.tokens.expectType(TokenType.identifier);
		for (let t of VariableType.all()) {
			if (t.name === type.value) {
				let name = this.tokens.expectType(TokenType.identifier);
				this.tokens.expectValue('=')
				let val = parseExpression(this.tokens,t);
				if (val) {
					this.ctx.addVariable(name,t);
					return e=>{
						e.setVariable(name.value,val(e));
					}
				} else {
					this.tokens.errorNext("Expected " + t.name + " value");
				}
				return;
			}
		}
		let name = this.tokens.expectType(TokenType.identifier);
		if (!this.tokens.isNext('=')) return;
		this.tokens.expectValue('=');
		let res = oop.parseNewInstanceCreation(this.tokens);
		this.ctx.addVariable(name,VariableType.create(type.value));
		if (!res) return e=>{};
		return e=>{
			let v = res(e);
			e.setVariable(name.value,v);
		}
	}
}