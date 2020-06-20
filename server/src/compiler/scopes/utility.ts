import { Scope, RegisterStatement, Statement, Lazy, parseExpression, Evaluator } from '../parser';
import { TokenType, Token } from '../tokenizer';
import { VariableTypes, Score, VariableType, chainSpaced, getRegistryEntries } from '../util';
import { praseJson, JsonContext, JsonTextType, colors } from '../json_text';
import * as oop from '../oop';
import { SymbolKind, DocumentHighlightKind, CompletionItemKind } from 'vscode-languageserver';
import * as criteriaList from '../registries/criteria.json'
import { FutureSuggestion } from '../compiler';

export class UtilityScope extends Scope {
	@RegisterStatement({desc: "Create a score entry that is assigned to a fake entity"})
	global(): Statement {
		let name = this.tokens.expectType(TokenType.identifier);
		let value: Lazy<any>;
		if (this.tokens.skip('=')) {
			value = parseExpression(this.tokens,[VariableTypes.integer,VariableTypes.score]);
		}
		return this.makeVariableStatement(name,VariableTypes.score,false,Score.global(name.value),e=>{
			e.ensureObjective('Global');
			if (value) {
				let res = value(e);
				if (res.type == VariableTypes.score) {
					e.write("scoreboard objectives operation " + name.value + " Global = " + Score.toString(res.value,e));
				} else if (res.type == VariableTypes.integer) {
					e.write("scoreboard objectives set " + name.value + " Global " + res.value);
				}
			}
		});
	}

	@RegisterStatement()
	objective(): Statement {
		let criteria = 'dummy';
		if (this.tokens.skip('<')) {
			let current = criteriaList;
			criteria = this.parseCriteriaNode(current);
			this.tokens.expectValue('>');
		}
		let name = this.tokens.expectType(TokenType.identifier);
		let displayName: Lazy<any>;
		if (this.tokens.skip('=')) {
			displayName = praseJson(this.tokens,new JsonContext(JsonTextType.chat))
		}
		return this.makeVariableStatement(name,VariableTypes.objective,false,name.value,e=>{
			e.load('scoreboard objectives add ' + chainSpaced(e,name.value,criteria,displayName))
		})
	}

	parseCriteriaNode(current: any) {
		let criteria = '';
		let values = this.getCriteriaValues(current)
		let crit = this.tokens.expectType(TokenType.identifier,()=>Object.keys(values).filter(k=>!k.startsWith(':')).map((k): FutureSuggestion=>{
			let v = current[k];
			let desc: string;
			if (typeof v == 'object') {
				desc = v[':desc'];
			} else {
				desc = v;
			}
			return {value: k, desc, type: CompletionItemKind.Event}
		}));
		let found = values[crit.value];
		criteria += (found && (found[':namespaced'] || current[':namespaced']) ? 'minecraft.' : '') + crit.value;
		if (typeof found == 'object') {
			criteria += found[':namespaced'] ? ':' : '.'
			if (!this.tokens.skip('.')) {
				this.tokens.error(crit.range,"This criterion must have an additional argument")
				return criteria;
			}
			return criteria + this.parseCriteriaNode(found);
		} else if (found === undefined && crit.value.length > 0) {
			this.tokens.error(crit.range,"Unknown criterion " + criteria);
		}
		return criteria;
		
	}

	getCriteriaValues(criteria: any) {
		if (criteria[':fill']) {
			let ent = getRegistryEntries(criteria[':fill']);
			let values = {};
			values[':namespaced'] = criteria[':namespaced']
			for (let e of ent) {
				values[e] = ''
			}
			return values;
		}
		return criteria;
	}

	@RegisterStatement()
	bossbar(): Statement {
		let name = this.tokens.expectType(TokenType.identifier);
		let displayName: Lazy<any>;
		if (this.tokens.skip('=')) {
			displayName = praseJson(this.tokens,new JsonContext(JsonTextType.title));
		}
		return this.makeVariableStatement(name,VariableTypes.bossbar,false,name.value,e=>{
			e.load('bossbar add ' + name.value + (displayName ? ' ' + e.stringify(displayName) : ''))
		})
	}

	@RegisterStatement({inclusive: true})
	varDeclaration(): Statement {
		if (!this.tokens.isTypeNext(TokenType.identifier)) return;
		this.tokens.suggestHere(...VariableType.all().map(t=>({value: t.name, type: CompletionItemKind.Class})))
		let type = this.tokens.expectType(TokenType.identifier);
		this.ctx.editor.addSymbol(type.range,type.value,SymbolKind.Class);
		for (let t of VariableType.all()) {
			if (t.instancible !== false && t.name === type.value) {
				let name = this.tokens.expectType(TokenType.identifier);
				return this.makeVariableStatement(name,t,true);
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

	makeVariableStatement(name: Token, type: VariableType<any>, parseValue: boolean, defaultVal?: any, additionalStatement?: (e: Evaluator)=>any): Statement {
		this.ctx.editor.addSymbol(name.range,name.value,SymbolKind.Variable,DocumentHighlightKind.Write);
		let val: Lazy<any>;
		if (defaultVal === undefined) {
			if (parseValue && this.tokens.expectValue('=')) {
				val = parseExpression(this.tokens,type);
			}
		} else {
			val = Lazy.literal(defaultVal,type);
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