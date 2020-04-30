import { Scope, ScopeType, RegisterStatement, Statement, parseExpression, getLazyVariable, parseCondition, TempScore } from '../parser';
import { VariableTypes, parseLocation, toStringPos, parseBlock } from '../util';
import * as selectors from '../selector';
import { TokenType } from '../tokenizer';
import { CompletionItemKind } from 'vscode-languageserver';
import { nbtRegistries, parseNBT, createNBTContext } from '../nbt';

export class NormalScope extends Scope {

	@RegisterStatement()
	codeBlock(scope: ScopeType): Statement {
		if (!this.tokens.isNext('{')) return undefined;
		return this.parser.parseBlock(scope);
	}

	@RegisterStatement()
	print(): Statement {
		let msg = parseExpression(this.tokens,VariableTypes.string);
		return e=>{
			e.write("say " + e.valueOf(msg));
		}
	}

	@RegisterStatement({inclusive: true})
	selector(): Statement {
		let selector = selectors.parseSelector(this.tokens);
		if (!selector) return undefined;
		let cmd = selectors.parseSelectorCommand(this.tokens);
		if (!cmd) {
			return e=>{};
		}
		return e=>{
			return cmd(selector,e);
		}
	}

	@RegisterStatement({inclusive: true})
	varUsage(): Statement {
		this.tokens.suggestHere(...this.ctx.getAllVariables().map(v=>({value: v.name, detail: v.type.name, type: CompletionItemKind.Variable})));
		if (!this.tokens.isTypeNext(TokenType.identifier)) return;
		let name = this.tokens.expectType(TokenType.identifier);
		if (this.ctx.hasVariable(name.value)) {
			let type = this.ctx.getVariableType(name.value);
			if (type.usageParser) {
				return type.usageParser(this.tokens,getLazyVariable(name),name.value);
			} else {
				this.tokens.error(name.range,"This variable cannot be used as a statement")
			}
		}
	}

	@RegisterStatement({desc: "Iterates over entities, an array or through a range"})
	for(): Statement {
		if (this.tokens.isNext('new')) {

		} else {
			let p = this.ctx.currentEntity;
			let selector = selectors.parseSelector(this.tokens);
			this.ctx.currentEntity = selector;
			let code = this.parser.parseStatement('function');
			console.log('parsed for code');
			this.ctx.currentEntity = p;
			return e=>{
				e.write('execute as ' + selectors.Selector.toString(selector,e) + ' at @s ' + e.getCommandWithRun('for',code))
			}
		}
	}

	@RegisterStatement({desc: "Executes the following statement with the specified entity selector as the context entity/s"})
	as(): Statement {
		let p = this.ctx.currentEntity;
		let selector = selectors.parseSelector(this.tokens);
		this.ctx.currentEntity = selector;
		let code = this.parser.parseStatement('function');
		this.ctx.currentEntity = p;
		return e=>{
			e.write('execute as ' + selectors.Selector.toString(selector,e) + ' ' + e.getCommandWithRun('as',code));
		}
	}

	@RegisterStatement({desc: "Executes the following statement at the position of the specified entity/s"})
	at(): Statement {
		let selector = selectors.parseSelector(this.tokens);
		let code = this.parser.parseStatement('function');
		return e=>{
			e.write('execute at ' + selectors.Selector.toString(selector,e) + ' ' + e.getCommandWithRun('at',code));
		}
	}

	@RegisterStatement()
	if(): Statement {
		let cond = parseCondition(this.tokens);
		let code = this.parser.parseStatement('function');
		if (!code) return e=>{}
		let hasElse = false;
		let elseCode: Statement = undefined;
		if (this.tokens.skip('else')) {
			hasElse = true;
		} else {
			let pos = this.tokens.pos;
			while (this.tokens.isTypeNext(TokenType.line_end)) {
				this.tokens.skip();
			}
			if (this.tokens.skip('else')) {
				hasElse = true;
			} else {
				this.tokens.pos = pos;
			}
		}
		if (hasElse) {
			elseCode = this.parser.parseStatement('function');
		}
		return e=>{
			let temp: TempScore;
			if (elseCode) {
				temp = e.generateTempScore('ranIf');
				e.write(temp.set(0));
				let oldCode = code;
				code = e=>{
					oldCode(e);
					e.write(temp.set(1))
				}
			}
			e.write('execute ' + e.stringify(cond) + ' ' + e.getCommandWithRun('if',code));
			if (elseCode) {
				e.write('execute if ' + temp.matches(0) + ' ' + e.getCommandWithRun('else',elseCode));
			}
			e.resetTempScore('ranIf');
		}
	}

	@RegisterStatement()
	while(): Statement {
		let cond = parseCondition(this.tokens);
		let code = this.parser.parseStatement('function');
		if (!code) return e=>{}
		return e=>{
			let func = e.generateFunction('while');
			e.write('execute ' + e.stringify(cond) + ' run function ' + func.toString());
			let prev = e.target;
			e.target = func;
			code(e);
			e.write('execute ' + e.stringify(cond) + ' run function ' + func.toString());
			e.target = prev;
		}
	}

	@RegisterStatement()
	block(): Statement {
		let pos = parseLocation(this.tokens);
		if (this.tokens.skip('=')) {
			let block = parseBlock(this.tokens,false);
			return e=>{
				e.write('setblock ' + toStringPos(pos,e) + ' ' + e.stringify(block));
			}
		}
	}

	@RegisterStatement()
	summon(): Statement {
		let id = this.tokens.expectType(TokenType.identifier);
		let entity = nbtRegistries.entities.entries[id.value];
		if (!entity) {
			this.tokens.error(id.range,"Unknown entity ID " + id.value);
			entity = nbtRegistries.entities.base;
		}
		let pos = parseLocation(this.tokens);
		let tp = this.tokens.pos;
		let readNBT = true;
		if (this.tokens.skip('{')) {
			if (this.tokens.isTypeNext(TokenType.line_end)) {
				readNBT = false;
			} else {
				readNBT = true;
			}
			this.tokens.pos = tp;
		} else {
			readNBT = false;
		}
		let nbt;
		if (readNBT) {
			nbt = parseNBT(this.tokens,createNBTContext(nbtRegistries.entities,id.value,true)); 
		}
		return e=>{
			e.write('summon ' + id.value + ' ' + toStringPos(pos,e) + (nbt ? ' ' + e.stringify(nbt) : ''));
		}
	}
}