import { VariableType, VariableTypes, Item, parseList, parseResourceLocation, parseRangeComparison, parseScoreModification, Score } from './util';
import { TokenIterator, TokenType, Tokens } from './tokenizer'
import { Lazy, parseExpression, Evaluator, getLazyVariable, parseSingleValue } from './parser'
import { entityEffects } from './entities';
import { Range, CompletionItemKind } from 'vscode-languageserver';
import { getSignatureParamLabel } from '../server';

import * as entities from './registries/entities.json'
import { SignatureParameter } from './compiler';
import { isArray } from 'util';

export enum SelectorTarget {
	self = "@s",
	allPlayers = "@a",
	allEntities = "@e",
	random = "@r",
	closestPlayer = "@p"
}

export interface DoubleRange {
	min?: number;
	max?: number;
}

export interface Selector {
	expr: Range
	type?: string
	target: SelectorTarget
	params: {key: string, value: Lazy<string>}[]
}

export namespace Selector {
	export function toString(selector: Selector, e: Evaluator) {
		let str = "" + selector.target;
		if (selector.params.length > 0) {
			str += '[';
			str += selector.params.map(p=>p.key + '=' + e.valueOf(p.value)).join(',');
			str += ']';
		}
		return str;
	}

	export function ensurePlayer(selector: Selector, e: Evaluator) {
		if (selector.target == SelectorTarget.allPlayers || selector.target == SelectorTarget.closestPlayer) {
			return;
		}
		let t = selector.params.find(p=>p.key === 'type');
		if (t && e.valueOf(t.value) === 'player') {
			return;
		}
		e.warn(selector.expr,"This selector can target non-players");
	}

	export function asLazyString(selector: Selector): Lazy<string> {
		return e=>({value: Selector.toString(selector,e),type: VariableTypes.string});
	}
}

interface ParamParserResult {res: Lazy<any> | Lazy<any>[],allowMore: boolean};

export type SelectorParamParser = {
	parse: (t: TokenIterator)=> Lazy<any> | ParamParserResult;
	customEquals?: boolean;
} | ((t: TokenIterator)=> Lazy<any> | ParamParserResult);

export function range(type: ()=>VariableType<number>): SelectorParamParser {
	return {
		customEquals: true,
		parse: (t)=>{
			return parseRangeComparison(t,type());
		}
	}
}

export function negatableString(multiNonNegated: boolean): SelectorParamParser {
	return t=>{
		let neg = '';
		if (t.skip('!')) {
			neg = '!';
		}
		let str = parseExpression(t,VariableTypes.string);
		return {
			res: e=>{
				let res = e.valueOf(str);
				console.log("negated string value: " + res);
				return {value: neg + res,type: VariableTypes.string};
			},
			allowMore: multiNonNegated || neg == '!'
		}
	}
}

interface selectorParam {
	key: string,
	aliases?: string[],
	realKey?: string,
	parser: SelectorParamParser,
	multi?: boolean;
	desc: string;
	snippet?: string;
}

export const selectorParams: selectorParam[] = [
	{
		key: "distance",
		aliases: ["dist"],
		parser: range(()=>VariableTypes.double),
		desc: "The range of distance from the current location to the target entity"
	},
	{
		key: "level",
		aliases: ["lvl"],
		parser: range(()=>VariableTypes.double),
		desc: "The range of experience levels the target player should have"
	},
	{
		key: "x_rotation",
		aliases: ["x_rot","pitch"],
		desc: "The range of pitch (vertical orientation) of the target",
		parser: range(()=>VariableTypes.double)
	},
	{
		key: "y_rotation",
		aliases: ["y_rot","yaw"],
		desc: "The range of yaw (horizontal orientation) of the target",
		parser: range(()=>VariableTypes.double)
	},
	{
		key: "volume",
		aliases: ["vol"],
		desc: "Defines a cube volume of blocks relative to the position of execution the target entity has to be in",
		parser: undefined,
		snippet: "<alias>=($1,$2,$3)$0"
	},
	{
		key: "name",
		desc: "The display name of the entity",
		parser: negatableString(false),
		multi: true,
		snippet: "name=\"$0\""
	},
	{
		key: "tag",
		desc: "A custom tag the entity is assigned to (assign tags using @<selector>.tag('test'). Add a ! before the string to only entities without that tag.",
		parser: negatableString(true),
		multi: true,
		snippet: "tag=\"$0\""
	},
	{
		key: "tags",
		realKey: "tag",
		desc: "A list of tags the entity has to be assigned to (assign tags using @<selector>.tag('test')",
		parser: t=>{
			let l = parseList(t,'[',']',()=>parseExpression(t,VariableTypes.string));
			return {res: l, allowMore: false}
		},
		snippet: "tags=[\"$1\"$0]"
	},
	{
		key: "limit",
		desc: "Limits the number of entities matched by this selector",
		parser: t=>parseExpression(t,VariableTypes.integer)
	}
]

const targetSelectors: string[][] = [
	["e","Targets all entities","entities","all"],
	["a","Targets all players","players"],
	["s","Targets the executing entity","self"]
]

export function parseSelector(tokens: TokenIterator): Selector {
	let target = undefined;
	let span = {...tokens.nextPos};
	let type: string = undefined;
	let params: {key: string, value: Lazy<any>}[] = [];
	if (tokens.skip('self')) {
		target = '@s';
		if (tokens.ctx.currentEntity) {
			type = tokens.ctx.currentEntity.type;
		}
	} else {
		if (!tokens.isNext('@')) return undefined;
		tokens.skip();
		for (let ta of targetSelectors) {
			for (let i = 0; i < ta.length; i++) {
				if (i != 1) {
					tokens.suggestHere({value: ta[i],detail: i == 0 ? undefined : 'Alias for @' + ta[0],desc: ta[1]})
				}
			}
		}
		let entityIds = Object.keys(entities.values).filter(k=>!entities.values[k].abstract);
		tokens.suggestHere(...entityIds);
		let typeId = tokens.expectType(TokenType.identifier);
		for (let ta of targetSelectors) {
			if (ta.indexOf(typeId.value) >= 0) {
				target = '@' + ta[0];
			}
		}
		if (!target) {
			if (entityIds.indexOf(typeId.value) >= 0) {
				target = "@e";
				params.push({key: "type",value: Lazy.literal(typeId.value,VariableTypes.string)});
				type = typeId.value;
			}
		}
		if (!target) {
			tokens.error(typeId.range,"Unknown target of selector");
			target = "@e";
		}
	}
	console.log("selector target: " + target);
	if (target == SelectorTarget.self && !tokens.ctx.currentEntity) {
		tokens.warn(tokens.lastPos,"No entity in the current context!")
	}
	if (tokens.skip('[')) {
		console.log("parsing selector params");
		let noMore = [];
		let scores: [string,Lazy<string>][] = [];
		if (tokens.isNext(']')) {
			tokens.suggestHere(...selectorParams.map(p=>({value: p.key, desc: p.desc, type: CompletionItemKind.Property})))
		}
		while (tokens.hasNext() && !tokens.skip(']')) {
			tokens.suggestHere(...selectorParams.map(p=>({value: p.key, desc: p.desc, type: CompletionItemKind.Property})))
			let key = tokens.next();
			console.log("param key: " + key.value);
			let found = false;
			for (let p of selectorParams) {
				if (p.key == key.value || (p.aliases && p.aliases.indexOf(key.value) >= 0)) {
					console.log("param key exists!");
					let add = true;
					found = true;
					if (noMore.indexOf(p.key) >= 0) {
						tokens.error(key.range,"Duplicate of this param is not allowed");
						add = false;
					}
					let parser = p.parser;
					let res: Lazy<any> | ParamParserResult;
					if (typeof parser == 'function') {
						tokens.expectValue('=');
						res = parser(tokens);
					} else {
						console.log('parsing special param parser')
						if (!parser.customEquals) {
							tokens.expectValue('=');
						}
						res = parser.parse(tokens);
						console.log('special param result:')
						console.log(res);
					}
					if (!add) continue;
					console.log('sel param result:')
					console.log(res);
					if (Lazy.is(res)) {
						console.log('result is lazy');
						params.push({key: p.realKey || p.key,value: res})
					} else {
						let val = (res as ParamParserResult).res;
						if (Lazy.is(val)) {
							params.push({key: p.realKey || p.key,value: val});
						} else {
							for (let v of (val as Lazy<any>[])) {
								params.push({key: p.realKey || p.key,value: v});
							}
						}
						if (!(res as ParamParserResult).allowMore) {
							noMore.push(p.key);
						}
					}
					break;
				}
			}
			if (!found) {
				let parser = range(()=>VariableTypes.integer);
				if (typeof parser !== 'function') {
					let res = parser.parse(tokens);
					scores.push([key.value,res as Lazy<string>]);
				}
			}
			if (!tokens.skip(',')) {
				tokens.expectValue(']');
				break;
			}
		}
		if (scores.length > 0) {
			let scoreString: Lazy<string> = e=>{
				let str = '{' + scores.map(v=>v[0] + '=' + e.valueOf(v[1])).join(',') + '}';
				return {value: str, type: VariableTypes.string};
			}
			params.push({key: "scores",value: scoreString});
		}
	}
	tokens.endRange(span);
	return {expr: span,target,params,type};
}

interface KeylessMethodParameter {
	optional?: boolean
	type: VariableType<any> | TokenType
	desc?: string
	values?: string[]
}

type MethodParameter = KeylessMethodParameter & {
	key: string
}

type AnyMethodParam = KeylessMethodParameter | ((t:TokenIterator)=>any)

interface SelectorMember<T> {
	name: string
	desc?: string
	type?: VariableType<any> | TokenType
	signature?: SignatureParameter[]
	values?: string[]
	params?: AnyMethodParam | MethodParameter[]
	eval: (params: T, selector: string, e: Evaluator)=>any
	playersOnly?: boolean
}

interface AdvancementSelector {
	method: string
	advancement?: string
	criterion?: string
}

function parseAdvancementRange(t: TokenIterator) {
	if (t.suggestHere("from","through","until")) {
		let method = t.expectValue("from","through","until");
		let adv = parseResourceLocation(t);
		return {method, advancement: adv}
	}
}

function parseOnlyAdvancement(t: TokenIterator): AdvancementSelector {
	if (!t.isTypeNext(TokenType.string,TokenType.identifier)) return;
	let adv = parseResourceLocation(t);
	let crit = "";
	if (t.skip('.')) {
		crit = " " + t.expectType(TokenType.identifier).value;
	}
	t.expectValue(')');
	return {method: 'only', advancement: adv, criterion: crit}
}

let selectorMembers: SelectorMember<any>[];

function initSelectorMembers() {
	if (selectorMembers) return;
	selectorMembers = [
		{
			name: "effect",
			desc:"Adds an effect to the entity",
			params:[
				{
					key: "effect",
					type: VariableTypes.tieredEffect,
					desc:"The effect to give, in the format of <id> [tier]. The ID can be any minecraft effect ID, and the tier is optional, but can be an integer between 0-255 or a roman number"
				},
				{
					optional: true,
					key: "duration",
					type: VariableTypes.duration,
					desc:"The duration of the effect. Accepts values like 10s (= 10 seconds), 400t (= 400 ticks), 3m (= 3 minutes), etc."
				},
				{
					optional: true,
					key: "hide",
					type: TokenType.identifier,
					values:["hide"]
				}
			],
			eval: (params,sel,e)=>{
				let effect = e.valueOf(params.effect);
				let command = 'effect give ' + sel + ' ' + effect.id;
				let hasDuration = false;
				let dur = e.valueOf(params.duration);
				if (dur && dur > 0) {
					hasDuration = true;
					command += ' ' + dur;
				}
				let tier = effect.tier;
				let hasTier = false;
				if (tier && tier > 0) {
					hasTier = true;
					if (!hasDuration) {
						command += ' ' + (effect.id.startsWith('instant') ? '1' : '30');
					}
					command += ' ' + tier;
				}
				if (params.hide) {
					if (!hasDuration) {
						command += ' ' + (effect.id.startsWith('instant') ? '1' : '30');
					}
					if (!hasTier) {
						command += ' 0';
					}
					command += ' true';
				}
				e.write(command)
			}
		},
		{
			name: "gamemode",
			type: TokenType.identifier,
			values: ["survival","creative","adventure","spectator"],
			desc: "Changes the gamemode of the target player",
			playersOnly: true,
			eval:(value,sel,e)=>e.write(`gamemode ${value} ${sel}`)
		},
		{
			name: "kill",
			desc: "Kills the entity",
			eval: (_,sel,e)=>{e.write('kill ' + sel)}
		},
		<SelectorMember<AdvancementSelector>>{
			name: "grant",
			params: parseOnlyAdvancement,
			signature: [{label: "<advancementId>.[criterion]"}],
			playersOnly: true,
			desc: "Gives a single advancement to the player",
			eval: (adv,sel,e)=>{
				e.write('advancement grant ' + sel + ' only ' + adv.advancement + (adv.criterion ? ' ' + adv.criterion : ''));
			}
		},
		<SelectorMember<AdvancementSelector>>{
			name: "grant",
			params: parseAdvancementRange,
			signature: [{label: "(from | until | through) <advancementId>"}],
			playersOnly: true,
			desc: "Gives a range of advancement to the player",
			eval: (adv,sel,e)=>{
				e.write('advancement grant ' + sel + ' ' + adv.method + ' ' + adv.advancement);
			}
		},
		{
			name: "grant",
			params: (t)=>{
				if (t.skip('*')) {
					return true;
				}
			},
			signature: [{label: '*'}],
			eval: (_,sel,e)=>{
				e.write('advancement grant ' + sel + ' everything');
			}
		},
		<SelectorMember<AdvancementSelector>>{
			name: "revoke",
			params: parseOnlyAdvancement,
			signature: [{label: "<advancementId>.[criterion]"}],
			playersOnly: true,
			desc: "Removes a single advancement from the player",
			eval: (adv,sel,e)=>{
				e.write('advancement revoke ' + sel + ' only ' + adv.advancement + (adv.criterion ? ' ' + adv.criterion : ''));
			}
		},
		<SelectorMember<AdvancementSelector>>{
			name: "revoke",
			params: parseAdvancementRange,
			signature: [{label: "(from | until | through) <advancementId>"}],
			playersOnly: true,
			desc: "Removes a range of advancement from the player",
			eval: (adv,sel,e)=>{
				e.write('advancement revoke ' + sel + ' ' + adv.method + ' ' + adv.advancement);
			}
		},
		{
			name: "revoke",
			params: (t)=>{
				if (t.skip('*')) {
					return true;
				}
			},
			signature: [{label: '*'}],
			eval: (_,sel,e)=>{
				e.write('advancement revoke ' + sel + ' everything');
			}
		},
		{
			name: "cure",
			desc: "Cures the specified effect from the entity",
			params: (t)=>{
				t.suggestHere(...entityEffects)
				if (t.isNext('*')) return;
				let effectRange = {...t.nextPos};
				let effectId: Lazy<string>;
				if (t.isNext(...entityEffects)) {
					effectId = Lazy.literal(t.next().value,VariableTypes.string);
				} else {
					effectId = parseExpression(t,VariableTypes.string,false);
				}
				if (!effectId) return;
				return {range: effectRange,lazy: effectId};
			},
			signature: [{label: "effectId",type: "identifier"}],
			eval: (res,sel,e)=>{
				let effect = e.valueOf(res.lazy);
				if (entityEffects.indexOf(effect) < 0) {
					e.error(res.range,"Unknown effect ID");
				}
				e.write(`effect clear ${sel} ${effect}`)
			}
		},
		{
			name: "cure",
			params: (t)=>{
				if (t.skip('*')) {
					return true;
				}
			},
			desc: "Cures all effects from the entity",
			signature: [{label: "*"}],
			eval: (_,sel,e)=>{
				e.write(`effect clear ${sel}`)
			}
		},
		<SelectorMember<Item>>{
			name: "give",
			desc: "Gives the specified item to this player",
			params: {
				type: VariableTypes.item,
				desc: "The item to give",
			},
			eval: (item,sel,e)=>{
				e.write('give ' + sel + ' ' + VariableTypes.item.stringify(item,e))
			}
		}
	]
}

export function parseSelectorCommand(tokens: TokenIterator): (selector: Selector, e: Evaluator)=>any {
	if (!tokens.expectValue('.')) return undefined;
	initSelectorMembers();
	tokens.suggestHere(...selectorMembers.map(k=>({value: k.name, detail: getSignatureString(k), desc: k.desc, type: k.type ? CompletionItemKind.Property : CompletionItemKind.Method})));
	let k = tokens.expectType(TokenType.identifier);
	let pos = tokens.pos;
	let members = selectorMembers.filter(v=>v.name === k.value);
	let found = false;
	for (let m of members) {
		let sigParams = getMethodSignature(m);
		let params;
		if (m.type) {
			if (tokens.expectValue('=')) {
				params = parseValue(tokens,m.type,m.values);
			} else {
				params = Lazy.literal('',VariableTypes.string);
			}
		} else {
			if (!tokens.skip('(')) {
				found = true;
			}
			let ps = m.params;
			if (ps) {
				if (typeof ps == 'function') {
					params = ps(tokens);
				} else if (isArray(ps)) {
					params = {};
					let parr = <MethodParameter[]>ps;
					for (let i = 0; i < parr.length; i++) {
						let p = parr[i];
						let range = {...tokens.nextPos};
						params[p.key] = parseValue(tokens,p.type,p.values,p.optional);
						tokens.endRange(range);
						tokens.ctx.editor.setSignatureHelp({pos: range, desc: m.desc, method: k.value, params: sigParams, activeParam: i})
						if (i < parr.length - 1) {
							if (!parr[i+1].optional) {
								tokens.expectValue(',');
							} else if (!tokens.skip(',')) {
								break
							}
						}
					}
				} else {
					let p = <KeylessMethodParameter>ps;
					let range = {...tokens.nextPos};
					params = parseValue(tokens,p.type,p.values);
					tokens.endRange(range);
					tokens.ctx.editor.setSignatureHelp({pos: range, desc: m.desc, method: k.value, params: sigParams, activeParam: 0})
				}
				if (!params) {
					tokens.pos = pos;
					continue;
				} else {
					tokens.ctx.editor.setHover(k.range,{syntax: (m.type ? '(property)' : '(method)') + ' ' + getSignatureString(m), desc: m.desc})
					found = true;
				}
			}
			tokens.expectValue(')');
		}
		return (sel,e)=>{
			let str = Selector.toString(sel,e);
			if (m.playersOnly) {
				Selector.ensurePlayer(sel,e);
			}
			let pval = e.valueOf(params);
			return m.eval(pval,str,e);
		}
	}
	if (!found && members.length > 0) {
		tokens.skip(')');
		tokens.error(k.range,"Unknown overload of method " + k.value);
		return;
	}
	tokens.pos = pos;
	if (tokens.skip('(')) {
		tokens.expectValue(')');
		return (s,e)=>{
			let func = e.requireFunction(k);
			if (func) {
				e.write('execute as ' + Selector.toString(s,e) + ' at @s run function ' + func.toString());
			}
		}
	} else {
		let obj = getLazyVariable(k);
		let mod = parseScoreModification(tokens);
		return (sel,e)=>{
			mod({entry: Selector.asLazyString(sel),objective: e.valueOf(obj)},e);
		}
	}
	tokens.errorNext("Invalid selector member");
	return undefined;
}

function getMethodSignature(m: SelectorMember<any>): SignatureParameter[] {
	if (m.signature) {
		return m.signature;
	}
	if (!m.params) return []
	if (isArray(m.params)) {
		return (<MethodParameter[]>m.params).map(p=>({label: p.key, desc: p.desc, optional: p.optional, type: VariableType.is(p.type) ? p.type.name : p.values ? p.values.map(v=>"'" + v + "'").join(' | ') : TokenType[p.type]}))
	} else if (typeof m.params !== 'function') {
		let type = VariableType.is(m.params.type) ? m.params.type.name : TokenType[m.params.type]
		return [{label: type.toLowerCase(),optional: m.params.optional,type: type}]
	}
	return []
}

function getSignatureString(m: SelectorMember<any>) {
	let sig = getMethodSignature(m);
	return '@selector.' + m.name + (m.type ? '' : '(' + sig.map(p=>getSignatureParamLabel(p)).join(', ') + ')')
}

function parseValue(tokens: TokenIterator, type: VariableType<any> | TokenType, values?: string[], optional?: boolean) {
	if (VariableType.is(type)) {
		return parseExpression(tokens,<VariableType<any>>type,!optional);
	} else {
		if (values) {
			tokens.suggestHere(...values);
		}
		if (!tokens.isTypeNext(<TokenType>type) && optional) {
			return undefined;
		}
		return Lazy.literal(tokens.expectType(<TokenType>type).value,VariableTypes.string);
	}
}