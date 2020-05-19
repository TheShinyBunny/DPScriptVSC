import { VariableType, VariableTypes, parseList, parseResourceLocation, parseRangeComparison, parseScoreModification, Variable, MethodParameter, parseMethod, getSignatureFromParams, ValueTypeObject, parseValueTypeObject, parseIdentifierOrVariable } from './util';
import { TokenIterator, TokenType } from './tokenizer'
import { Lazy, parseExpression, Evaluator, getLazyVariable } from './parser'
import { entityEffects } from './entities';
import { Range, CompletionItemKind } from 'vscode-languageserver';
import { getSignatureParamLabel } from '../server';

import * as entities from './registries/entities.json'
import { SignatureParameter } from './compiler';
import { parseNBTPath, nbtRegistries, parseNBTAccess, NBTPathContext, parseNBTValue, setValueInNBTByPath, toStringNBT } from './nbt';

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
	expr?: Range
	type: string
	target: SelectorTarget
	params: {key: string, value: Lazy<string>}[]
}

export namespace Selector {
	export const SELF: Selector = {params: [],type: undefined,target: SelectorTarget.self}

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
		if (selector.target !== SelectorTarget.allEntities) {
			return;
		}
		if (selector.type == 'player') {
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
				return {value: neg + res,type: VariableTypes.string};
			},
			allowMore: multiNonNegated || neg == '!'
		}
	}
}

export function negatableIdentifier(multiNonNegated: boolean): SelectorParamParser {
	return t=>{
		let neg = '';
		if (t.skip('!')) {
			neg = '!';
		}
		let v = parseIdentifierOrVariable(t);
		return {
			res: e=>{
				let res = e.valueOf(v.value);
				return {value: neg + res,type: VariableTypes.string};
			},
			allowMore: multiNonNegated || neg == '!'
		}
	}
}

interface selectorParam {
	key: string,
	realKey?: string,
	parser: SelectorParamParser,
	multi?: boolean;
	desc: string;
	snippet?: string;
}

export const selectorParams: selectorParam[] = [
	{
		key: "distance",
		parser: range(()=>VariableTypes.double),
		desc: "The range of distance from the current location to the target entity"
	},
	{
		key: "level",
		parser: range(()=>VariableTypes.double),
		desc: "The range of experience levels the target player should have"
	},
	{
		key: "pitch",
		desc: "The range of pitch (vertical orientation) of the target",
		parser: range(()=>VariableTypes.double)
	},
	{
		key: "yaw",
		desc: "The range of yaw (horizontal orientation) of the target",
		parser: range(()=>VariableTypes.double)
	},
	{
		key: "volume",
		desc: "Defines a cube volume of blocks relative to the position of execution the target entity has to be in",
		parser: undefined,
		snippet: "volume=($1,$2,$3)$0"
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
		parser: negatableIdentifier(true),
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
	["e","Targets all entities"],
	["a","Targets all players"],
	["s","Targets the executing entity"],
	["r","Targets a random entity"],
	["p","Targets the closest player"]
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
			if (ta[0] == typeId.value) {
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
	//console.log("selector target: " + target);
	if (target == SelectorTarget.self && !tokens.ctx.currentEntity) {
		tokens.warn(tokens.lastPos,"No entity in the current context!")
	}
	if (tokens.skip('[')) {
		//console.log("parsing selector params");
		let noMore = [];
		let scores: [string,Lazy<string>][] = [];
		let nbt: Lazy<any> = undefined;
		if (tokens.isNext(']')) {
			tokens.suggestHere(...selectorParams.map(p=>({value: p.key, desc: p.desc, snippet: p.snippet, type: CompletionItemKind.Property})))
		}
		while (tokens.hasNext() && !tokens.skip(']')) {
			tokens.suggestHere(...selectorParams.map(p=>({value: p.key, desc: p.desc, snippet: p.snippet, type: CompletionItemKind.Property})))
			let key = tokens.next();
			let found = false;
			for (let p of selectorParams) {
				if (p.key == key.value) {
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
						if (!parser.customEquals) {
							tokens.expectValue('=');
						}
						res = parser.parse(tokens);
					}
					if (!add) continue;
					if (Lazy.is(res)) {
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
			if (!found && key.value == 'nbt') {
				let path = parseNBTPath(tokens,true,NBTPathContext.create(nbtRegistries.entities,type));
				tokens.expectValue('=');
				let value = parseNBTValue(tokens);
				found = true;
				let prevNBT = nbt;
				nbt = e=>{
					let p = e.valueOf(prevNBT);
					if (p === undefined) {
						p = {};
					}
					setValueInNBTByPath(path,p,value,e);
					return {type: VariableTypes.nbt, value: p};
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
		if (nbt) {
			params.push({key: "nbt",value: Lazy.remap(nbt,(v,e)=>({value: toStringNBT(v,e),type: VariableTypes.string}))})
		}
	}
	tokens.endRange(span);
	return {expr: span,target,params,type};
}

interface SelectorMember<T> {
	name: string
	desc?: string
	type?: ValueTypeObject
	signature?: SignatureParameter[]
	values?: string[]
	params?: MethodParameter[]
	eval: (params: T, selector: string, e: Evaluator)=>void
	playersOnly?: boolean
}

interface AdvancementSelector {
	method: string
	advancement?: string
	criterion?: string
}

function parseAdvancementRange(t: TokenIterator): AdvancementSelector {
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
					command += ' ' + Math.round(dur / 20);
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
			params: [
				{
					key: "advancement",
					type: parseOnlyAdvancement
				}
			],
			signature: [{label: "<advancementId>.[criterion]"}],
			playersOnly: true,
			desc: "Gives a single advancement to the player",
			eval: (adv,sel,e)=>{
				e.write('advancement grant ' + sel + ' only ' + adv.advancement + (adv.criterion ? ' ' + adv.criterion : ''));
			}
		},
		<SelectorMember<AdvancementSelector>>{
			name: "grant",
			params: [
				{
					key: "range",
					type: parseAdvancementRange
				}
			],
			signature: [{label: "(from | until | through) <advancementId>"}],
			playersOnly: true,
			desc: "Gives a range of advancement to the player",
			eval: (adv,sel,e)=>{
				e.write('advancement grant ' + sel + ' ' + adv.method + ' ' + adv.advancement);
			}
		},
		{
			name: "grant",
			params: [
				{
					type: (t)=>{
						if (t.skip('*')) {
							return true;
						}
					}
				}
			],
			signature: [{label: '*'}],
			eval: (_,sel,e)=>{
				e.write('advancement grant ' + sel + ' everything');
			}
		},
		<SelectorMember<AdvancementSelector>>{
			name: "revoke",
			params: [
				{
					key: "advancement",
					type: parseOnlyAdvancement
				}
			],
			signature: [{label: "<advancementId>.[criterion]"}],
			playersOnly: true,
			desc: "Removes a single advancement from the player",
			eval: (adv,sel,e)=>{
				e.write('advancement revoke ' + sel + ' only ' + adv.advancement + (adv.criterion ? ' ' + adv.criterion : ''));
			}
		},
		<SelectorMember<AdvancementSelector>>{
			name: "revoke",
			params: [
				{
					key: "range",
					type: parseAdvancementRange
				}
			],
			signature: [{label: "(from | until | through) <advancementId>"}],
			playersOnly: true,
			desc: "Removes a range of advancement from the player",
			eval: (adv,sel,e)=>{
				e.write('advancement revoke ' + sel + ' ' + adv.method + ' ' + adv.advancement);
			}
		},
		{
			name: "revoke",
			params: [
				{
					type: (t)=>{
						if (t.skip('*')) {
							return true;
						}
					}
				}
			],
			signature: [{label: '*'}],
			eval: (_,sel,e)=>{
				e.write('advancement revoke ' + sel + ' everything');
			}
		},
		{
			name: "cure",
			desc: "Cures the specified effect from the entity",
			params: [
				{
					key: 'effect',
					type: (t)=>{
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
					}
				}
			],
			signature: [{label: "effect",type: "effectId"}],
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
			params: [
				{
					type: (t)=>{
						if (t.skip('*')) {
							return true;
						}
					}
				}
			],
			desc: "Cures all effects from the entity",
			signature: [{label: "*"}],
			eval: (_,sel,e)=>{
				e.write(`effect clear ${sel}`);
			}
		},
		{
			name: "give",
			desc: "Gives the specified item to this player",
			params: [
				{
					key: "item",
					type: VariableTypes.item,
					desc: "The item to give"
				},
				{
					key: "count",
					type: VariableTypes.integer,
					desc: "The amount of the item to give",
					optional: true
				}
			],
			playersOnly: true,
			eval: (params,sel,e)=>{
				e.write('give ' + sel + ' ' + e.stringify(params.item) + (params.count ? ' ' + e.valueOf(params.count) : ''));
			}
		},
		{
			name: "clear",
			desc: "Clears the specified item or item tag from the player's inventory",
			params: [
				{
					key: "item",
					type: VariableTypes.item.taggable,
					desc: "The item predicate to clear",
					optional: true
				},
				{
					key: "count",
					type: VariableTypes.integer,
					desc: "The amount of items to clear",
					optional: true
				}
			],
			playersOnly: true,
			eval: (params,sel,e)=>{
				if (!params.item) {
					e.write('clear ' + sel);
					return;
				}
				e.write('clear ' + sel + ' ' + e.stringify(params.item) + (params.count ? ' ' + e.valueOf(params.count) : ''));
			}
		},
		{
			name: "count",
			desc: "Counts the items that match the specified item in the player's inventory",
			params: [
				{
					key: 'item',
					type: VariableTypes.item.taggable,
					desc: "The item predicate to count",
				}
			],
			playersOnly: true,
			eval: (params,sel,e)=>{
				e.write('clear ' + sel + ' ' + VariableTypes.item.stringify(params,e) + ' 0');
			}
		}
	]
}

export function parseSelectorCommand(tokens: TokenIterator, getsValue: boolean, type?: string): (selector: Selector, e: Evaluator)=>Variable<any> | void {
	if (tokens.skip('/')) {
		let path = parseNBTPath(tokens,false,NBTPathContext.create(nbtRegistries.entities,type));
		if (getsValue) {
			return (s,e)=>{
				return {type: VariableTypes.nbtAccess, value: {path, selector: 'entity ' + Selector.toString(s,e)}};
			}
		}
		let access = parseNBTAccess(tokens,path);
		return (s,e)=>{
			access({type: 'entity',value: Selector.toString(s,e)},e);
		}
	}
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
				params = parseValueTypeObject(tokens,m.type,m.values);
			} else {
				params = Lazy.literal('',VariableTypes.string);
			}
		} else {
			if (!tokens.skip('(')) {
				found = true;
				break;
			}
			let ps = m.params;
			if (ps) {
				params = parseMethod(tokens,sigParams,ps)
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
			m.eval(pval,str,e);
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
			return mod({entry: Selector.asLazyString(sel),objective: e.valueOf(obj)},e);
		}
	}
}

function getMethodSignature(m: SelectorMember<any>): SignatureParameter[] {
	if (m.signature) {
		return m.signature;
	}
	if (!m.params) return []
	return getSignatureFromParams(m.params);
}

function getSignatureString(m: SelectorMember<any>) {
	let sig = getMethodSignature(m);
	return '@selector.' + m.name + (m.type ? '' : '(' + sig.map(p=>getSignatureParamLabel(p)).join(', ') + ')')
}

