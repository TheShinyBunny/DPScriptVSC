import { Scope, RegisterStatement, Statement, Lazy, parseExpression, Evaluator, getLazyVariable } from '../parser';
import { TokenType, Token, TokenIterator } from '../tokenizer';
import { VariableTypes, Score, VariableType, chainSpaced, Variable } from '../util';
import { praseJson, JsonContext, JsonTextType, colors } from '../json_text';
import * as oop from '../oop';
import { SymbolKind, DocumentHighlightKind, CompletionItemKind } from 'vscode-languageserver';
import * as criteriaList from '../registries/criteria.json'
import { FutureSuggestion } from '../compiler';
import { parseTeamDeclaration } from '../teams';
import { Registry } from '../registries';
import { PredicateItem } from '../predicates';
import { ResourceLocation } from '..';

export class UtilityScope extends Scope {
	@RegisterStatement({desc: "Create a score entry that is assigned to a fake entity"})
	global(): Statement {
		let name = this.tokens.expectType(TokenType.identifier);
		let value: Lazy<any>;
		if (this.tokens.skip('=')) {
			value = parseExpression(this.tokens,[VariableTypes.integer,VariableTypes.score]);
		}
		return makeVariableStatement(this.tokens,name,VariableTypes.score,false,Score.global(name.value),e=>{
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
			displayName = praseJson(this.tokens,JsonContext.of(JsonTextType.chat))
		}
		return makeVariableStatement(this.tokens,name,VariableTypes.objective,false,name.value,e=>{
			e.write('scoreboard objectives add ' + chainSpaced(e,name.value,criteria,displayName))
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
			let ent = Registry.getKeys(criteria[':fill']);
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
			displayName = praseJson(this.tokens,JsonContext.of(JsonTextType.title));
		}
		return makeVariableStatement(this.tokens,name,VariableTypes.bossbar,false,name.value,e=>{
			e.write('bossbar add ' + name.value + (displayName ? ' ' + e.stringify(displayName) : ''))
		})
	}

	@RegisterStatement({inclusive: true})
	varDeclaration(): Statement {
		if (!this.tokens.isTypeNext(TokenType.identifier)) return;
		this.tokens.suggestHere(...VariableType.all().filter(v=>v.instancible).map(t=>({value: t.name, type: CompletionItemKind.Class})))
		let type = this.tokens.expectType(TokenType.identifier);
		if (this.ctx.hasVariable(type.value)) return;
		this.ctx.editor.addSymbol(type.range,type.value,SymbolKind.Class);
		for (let t of VariableType.all()) {
			if (t.instancible !== false && t.name === type.value) {
				let name = this.tokens.expectType(TokenType.identifier);
				return makeVariableStatement(this.tokens,name,t,true);
			}
		}
		let name = this.tokens.expectType(TokenType.identifier);
		this.ctx.editor.addSymbol(name.range,name.value,SymbolKind.Variable,DocumentHighlightKind.Write);
		if (!this.tokens.isNext('=')) return;
		this.tokens.expectValue('=');
		let res = oop.parseNewInstanceCreation(this.tokens);
		if (!res) return;
		this.ctx.addVariable(name,VariableType.create(type.value));
		if (!res) return;
		return e=>{
			let v = res(e);
			if (v) {
				e.setVariable(name.value,{...v, decl: e.toLocation(name.range)});
			}
		}
	}

	

	@RegisterStatement({inclusive: true})
	varUsage(): Statement {
		this.tokens.suggestHere(...this.ctx.getAllVariables().map(v=>({value: v.name, detail: v.type.name, type: CompletionItemKind.Variable})));
		if (!this.tokens.isTypeNext(TokenType.identifier)) return;
		let name = this.tokens.expectType(TokenType.identifier);
		if (this.ctx.hasVariable(name.value)) {
			let type = this.ctx.getVariableType(name.value);
			this.ctx.editor.addSymbol(name.range,name.value,SymbolKind.Variable,DocumentHighlightKind.Read)
			if (type.usageParser) {
				return type.usageParser(this.tokens,getLazyVariable(name),name.value);
			} else {
				this.tokens.error(name.range,"This variable cannot be used as a statement")
				return e=>{}
			}
		}
	}

	@RegisterStatement()
	team(): Statement {
		let name = this.tokens.expectType(TokenType.identifier);
		let st = parseTeamDeclaration(this.tokens,name);
		return makeVariableStatement(this.tokens,name,VariableTypes.team,false,name.value,e=>{
			st(e)
		});
	}

	@RegisterStatement()
	predicate(): Statement {
		let name = this.tokens.expectType(TokenType.identifier);
		return makeVariableStatement(this.tokens,name,VariableTypes.predicate,true,undefined,(e,pred)=>{
			console.log('predicate(',pred.id,')=',JSON.stringify(pred.data,undefined,2))
			pred.loc = new ResourceLocation(e.file.namespace,name.value);
			e.file.namespace.add(new PredicateItem(pred,pred.loc))
		});
	}
}

export function makeVariableStatement<T>(t: TokenIterator, name: Token, type: VariableType<T>, parseValue: boolean, defaultVal?: T, additionalStatement?: (e: Evaluator,value: T)=>void | Variable<any>): Statement {
	t.ctx.editor.addSymbol(name.range,name.value,SymbolKind.Variable,DocumentHighlightKind.Write);
	let val: Lazy<T>;
	if (defaultVal === undefined) {
		if (parseValue && t.expectValue('=')) {
			val = parseExpression(t,type);
		}
	} else {
		val = Lazy.literal(defaultVal,type);
	}
	if (val) {
		t.ctx.addVariable(name,type);
		return e=>{
			let v = val(e);
			e.setVariable(name.value,{...v, decl: e.toLocation(name.range)});
			if (additionalStatement) {
				return additionalStatement(e,v.value);
			}
		}
	} else {
		t.errorNext("Expected " + type.name + " value");
	}
	return;
}