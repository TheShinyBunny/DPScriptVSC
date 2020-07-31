import { VariableType, VariableTypes, parseResourceLocation, parseRangeComparison, parseScoreModification, Variable, ValueTypeObject, parseValueTypeObject, parseIdentifierOrVariable, BaseMemberEntry, MemberGroup, parseLocation, toStringPos, getTypeAnnotation, Score, toStringMemberSignature, IdentifierOrVariable, Ranges } from './util';
import { TokenIterator, TokenType, Token } from './tokenizer'
import { Lazy, parseExpression, Evaluator, getLazyVariable, parseSingleValue } from './parser'
import { allAttributes, getVanillaAttributeId } from './entities';
import { Range, CompletionItemKind, SymbolKind, DocumentHighlightKind } from 'vscode-languageserver';

import * as entities from './registries/entities.json'
import { FutureSuggestion } from './compiler';
import { parseNBTPath, parseNBTAccess, NBTPathContext, parseNBTValue, setValueInNBTByPath, toStringNBT, NBTAccess, NBTPath } from './nbt';
import { Registry } from './registries';
import { Parsers } from './parsers/parsers';
import { toStringItem } from './parsers/item';
import { Predicate, getPredicateLocation } from './predicates';
import { ResourceLocation } from '.';

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

	export function toString(selector: Selector | Lazy<Selector>, e: Evaluator) {
		let sel = Lazy.is(selector) ? e.valueOf(selector) : selector;
		let str = "" + sel.target;
		if (sel.params.length > 0) {
			str += '[';
			str += sel.params.map(p=>p.key + '=' + e.valueOf(p.value)).join(',');
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
			let range = parseRangeComparison(t,type());
			return e=>{
				return {value: Ranges.toString(range(e)), type: VariableTypes.string}
			}
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

export function negatableIdentifier(t: TokenIterator, multiNonNegated: boolean, suggestor?: (e: Evaluator)=>FutureSuggestion[]): {var: IdentifierOrVariable, res: ParamParserResult} {
	let neg = '';
	if (t.skip('!')) {
		neg = '!';
	}
	let v = parseIdentifierOrVariable(t);
	return {
		var: v,
		res: {
			res: e=>{
				let res = e.valueOf(v.value);
				if (suggestor) {
					e.suggestAt(v.range,...suggestor(e));
				}
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
		desc: "A custom tag the entity is assigned to (assign tags using @<selector>.tag(myTag). Add a ! before the string to only entities without that tag.",
		parser: t=>{
			let r = negatableIdentifier(t,true,e=>e.entityTags);
			if (r.var.literal) {
				if (t.ctx.script.usedEntityTags.indexOf(r.var.literal) < 0) {
					t.ctx.script.usedEntityTags.push(r.var.literal);
				}
			}
			return r.res;
		},
		multi: true,
		snippet: "tag=$0"
	},
	/* {
		key: "tags",
		realKey: "tag",
		desc: "A list of tags the entity has to be assigned to (assign tags using @<selector>.tag('test')",
		parser: t=>{
			let l = parseList(t,'[',']',()=>parseExpression(t,VariableTypes.string));
			return {res: l, allowMore: false}
		},
		snippet: "tags=[$0]"
	}, */
	{
		key: "limit",
		desc: "Limits the number of entities matched by this selector",
		parser: t=>parseExpression(t,VariableTypes.integer)
	},
	{
		key: "team",
		desc: "Selects only entities in the specified team",
		parser: (t)=>{
			if (!t.suggestHere('none','any')) {
				let team = t.expectVariable(VariableTypes.team);
				return team;
			}
			let na = t.next().value;
			return Lazy.literal(na == 'none' ? '' : '!',VariableTypes.string);
		}
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
		if (!tokens.skip('@')) return undefined;
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
				if (ta[0] == 'p' || ta[0] == 'a') {
					type = 'player';
				} else if (ta[0] && tokens.ctx.currentEntity) {
					type = tokens.ctx.currentEntity.type;
				}
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
	/* if (target == SelectorTarget.self && !tokens.ctx.currentEntity) {
		tokens.warn(tokens.lastPos,"No entity in the current context!")
	} */
	if (tokens.skip('[')) {
		//console.log("parsing selector params");
		let noMore = [];
		let scores: [string,Lazy<string>][] = [];
		let nbt: Lazy<any> = undefined;
		while (tokens.hasNext()) {
			tokens.suggestHere(...selectorParams.map(p=>({value: p.key, desc: p.desc, snippet: p.snippet, type: CompletionItemKind.Property})))
			tokens.suggestHere(...tokens.ctx.getVariableSuggestions(VariableTypes.score,VariableTypes.predicate,VariableTypes.trigger));
			if (tokens.isNext(']')) break
			let key = tokens.next();
			let found = false;
			for (let p of selectorParams) {
				if (p.key == key.value) {
					tokens.ctx.editor.setHover(key.range,{desc: p.desc,syntax: '(parameter) @selector[' + p.key + ']'})
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
					} else if (res !== undefined) {
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
				let path = parseNBTPath(tokens,true,Registry.entities.createPathContext(type));
				if (tokens.skip('==')) {
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
				} else {
					/* let r = range(()=>VariableTypes.double);                               this is supposed to make things like that possible:
					if (typeof r !== 'function') {                                            @a[nbt/Pos[1] < 40]
						let range = r.parse(tokens);                                          by storing the nbt value to a score and comparing that score in the selector
						scores.push(['temp',Lazy.map(range as Lazy<string>,(r,e)=>{           but unfortunately, it's impossible currently :(
							e.write('execute store result score Global temp run data get ')   future me would probably find some wacky, incredibly complicated solution at some point.
							return r;
						})]);
					} */ 
				}
			}
			if (!found) {
				if (tokens.ctx.hasVariable(key.value,VariableTypes.score,VariableTypes.trigger)) {
					this.ctx.editor.addSymbol(key.range,key.value,SymbolKind.Variable,DocumentHighlightKind.Read)
					let parser = range(()=>VariableTypes.integer);
					if (typeof parser !== 'function') {
						let res = parser.parse(tokens);
						scores.push([key.value,res as Lazy<string>]);
					}
				} else {
					let pred = parseExpression(tokens,VariableTypes.predicate);
					params.push({key:'predicate',value: Lazy.remap(pred,(p,e)=>({value: getPredicateLocation(e,p).toString(), type: VariableTypes.string}))})
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

type ResloveSM = (selector: string, e: Evaluator)=>void | boolean

interface SelectorMember extends BaseMemberEntry<ResloveSM> {
	resolve: (params: any)=>ResloveSM
	playersOnly?: boolean
}

interface AdvancementSelector {
	method: string
	advancement?: string
	criterion?: string
}

function parseAdvancementRange(t: TokenIterator): AdvancementSelector {
	if (t.isNext("from","through","until")) {
		let method = t.expectValue("from","through","until");
		let adv = parseResourceLocation(t);
		return {method, advancement: adv}
	}
}

function parseOnlyAdvancement(t: TokenIterator): AdvancementSelector {
	if (!t.isTypeNext(TokenType.string,TokenType.identifier) || t.isNext('from','through','until')) return;
	let adv = parseResourceLocation(t);
	let crit = "";
	if (t.skip('.')) {
		crit = " " + t.expectType(TokenType.identifier).value;
	}
	return {method: 'only', advancement: adv, criterion: crit}
}

function parseAsterisk() {
	return ValueTypeObject.custom('*',t=>{
		if (t.skip('*')) return true;
	})
}

type AttributeCmdGetter = (e: Evaluator)=>string

interface AttributeArgs {
	attr: Token,
	cmd: AttributeCmdGetter
}

let _selectorMembers: MemberGroup<SelectorMember,ResloveSM>;

function getSelectorMembers() {
	if (_selectorMembers) return _selectorMembers;
	class AttributeMethodGroup extends MemberGroup<BaseMemberEntry<AttributeCmdGetter>,AttributeCmdGetter> {
		
		init(): BaseMemberEntry<AttributeCmdGetter>[] {
			return [
				{
					name: 'base',
					desc: 'Get or set the base value of the attribute',
					type: ValueTypeObject.custom("AttributeValue",
						t=>{
							if (t.skip('=')) {
								return {op: 'set', val: parseExpression(t,VariableTypes.double)};
							}
							let scale: Lazy<number>;
							if (t.skip('*')) {
								scale = parseSingleValue(t,VariableTypes.double);
							}
							return {op: 'get', val: scale};
						}
					),
					noEqualSign: true,
					resolve: (p)=>{
						if (p.op == 'set') {
							return e=>'base set ' + e.stringify(p.val)
						} else {
							return e=>'base get ' + e.stringify(p.val)
						}
					}
				},
				{
					name: 'addModifier',
					desc: 'Add a modifier to this attribute',
					params: [
						{
							key: 'uuid',
							type: VariableTypes.string,
							desc: "The new modifier's unique ID"
						},
						{
							key: 'name',
							type: VariableTypes.string,
							desc: "The modifier's display name"
						},
						{
							key: 'value',
							type: VariableTypes.double,
							desc: "The modifier value, to change the base value using the specified operation"
						},
						{
							key: 'operation',
							type: Parsers.enum.configured({values: ['add','multiply','multiply_base']}),
							desc: "The operation to apply to the base value with this modifier's value"
						}
					],
					resolve: (params)=>{
						return e=>e.valueOf(params.uuid) + ' ' + e.valueOf(params.name) + ' ' + e.stringify(params.value) + ' ' + e.valueOf(params.operation)
					}
				},
				{
					name: 'removeModifier',
					desc: 'Remove a modifier from this attribute',
					params: [
						{
							key: 'uuid',
							type: VariableTypes.string,
							desc: "The uuid modifier to remove"
						}
					],
					resolve: (uuid)=>{
						return e=>'modifier remove ' + e.valueOf(uuid);
					}
				},
				{
					name: 'getModifier',
					desc: 'Gets the value of a modifier in this attribute',
					params: [
						{
							key: 'uuid',
							type: VariableTypes.string,
							desc: "The UUID of the modifier to get its value",
						},
						{
							key: 'scale',
							type: VariableTypes.double,
							optional: true,
							desc: 'An optional scale multiplier'
						}
					],
					resolve: (params)=>{
						return e=>'modifier value get ' + e.valueOf(params.uuid) + ' ' + e.stringify(params.scale)
					}
				}
			]
		}

		getSignatureString(member: BaseMemberEntry<AttributeCmdGetter>): string {
			return ''
		}
	}

	class SelectorMembers extends MemberGroup<SelectorMember,ResloveSM> {
		
		init(): SelectorMember[] {
			let attributeMethods = new AttributeMethodGroup();
			return [
				{
					name: "effect",
					desc:"Adds an effect to the entity",
					params:[
						{
							key: "effect",
							type: Parsers.effect.configured({tier: true}),
							desc:"The effect to give, in the format of <id> [tier]. The ID can be any minecraft effect ID, and the tier is optional, but can be an integer between 0-255 or a roman number"
						},
						{
							optional: true,
							key: "duration",
							type: Parsers.duration,
							desc:"The duration of the effect. Accepts values like 10s (= 10 seconds), 400t (= 400 ticks), 3m (= 3 minutes), etc."
						},
						{
							optional: true,
							key: "hide",
							type: Parsers.enum.configured({values:['hide']})
						}
					],
					resolve: (params) =>(sel,e)=>{
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
					type: Parsers.enum.configured({values: ["survival","creative","adventure","spectator"]},'GameMode'),
					desc: "Changes the gamemode of the target player",
					playersOnly: true,
					resolve: (value)=>(sel,e)=>e.write(`gamemode ${value} ${sel}`)
				},
				{
					name: "kill",
					params: [],
					desc: "Kills the entity",
					resolve: (_)=>(sel,e)=>{e.write('kill ' + sel)}
				},
				{
					name: "grant",
					params: [
						{
							key: "advancement",
							type: ValueTypeObject.custom('<advancementId>.[criterion]',parseOnlyAdvancement)
						}
					],
					playersOnly: true,
					desc: "Gives a single advancement to the player",
					resolve: (adv: AdvancementSelector)=>(sel,e)=>{
						e.write('advancement grant ' + sel + ' only ' + adv.advancement + (adv.criterion ? ' ' + adv.criterion : ''));
						return true
					}
				},
				{
					name: "grant",
					params: [
						{
							key: "range",
							type: ValueTypeObject.custom('(from | until | through) <advancementId>',parseAdvancementRange)
						}
					],
					playersOnly: true,
					desc: "Gives a range of advancement to the player",
					resolve: (adv: AdvancementSelector)=>(sel,e)=>{
						e.write('advancement grant ' + sel + ' ' + adv.method + ' ' + adv.advancement);
						return true
					}
				},
				{
					name: "grant",
					desc: "Gives all advancements to the player",
					params: [
						{
							key: undefined,
							type: parseAsterisk()
						}
					],
					resolve: (_)=>(sel,e)=>{
						e.write('advancement grant ' + sel + ' everything');
					}
				},
				{
					name: "revoke",
					params: [
						{
							key: "advancement",
							type: ValueTypeObject.custom('<advancementId>.[criterion]',parseOnlyAdvancement)
						}
					],
					playersOnly: true,
					desc: "Removes a single advancement from the player",
					resolve: (adv: AdvancementSelector)=>(sel,e)=>{
						e.write('advancement revoke ' + sel + ' only ' + adv.advancement + (adv.criterion ? ' ' + adv.criterion : ''));
						return true
					}
				},
				{
					name: "revoke",
					params: [
						{
							key: "range",
							type: ValueTypeObject.custom('(from | until | through) <advancementId>',parseAdvancementRange)
						}
					],
					playersOnly: true,
					desc: "Removes a range of advancement from the player",
					resolve: (adv: AdvancementSelector)=>(sel,e)=>{
						e.write('advancement revoke ' + sel + ' ' + adv.method + ' ' + adv.advancement);
						return true
					}
				},
				{
					name: "revoke",
					desc: "Removes all advancements from the player",
					params: [
						{
							key: undefined,
							type: parseAsterisk()
						}
					],
					resolve: (_)=>(sel,e)=>{
						e.write('advancement revoke ' + sel + ' everything');
					}
				},
				{
					name: "cure",
					desc: "Cures the specified effect from the entity",
					params: [
						{
							key: 'effect',
							type: ValueTypeObject.custom('EffectId',(t)=>{
								t.suggestHere(...Registry.effects)
								if (t.isNext('*')) return;
								let effectRange = {...t.nextPos};
								let effectId: Lazy<string>;
								if (t.isNext(...Registry.effects)) {
									effectId = Lazy.literal(t.next().value,VariableTypes.string);
								} else {
									effectId = parseExpression(t,VariableTypes.string,false);
								}
								if (!effectId) return;
								return {range: effectRange,lazy: effectId};
							})
						}
					],
					resolve: (res)=>(sel,e)=>{
						let effect = e.valueOf(res.lazy);
						if (Registry.effects.indexOf(effect) < 0) {
							e.error(res.range,"Unknown effect ID");
						}
						e.write(`effect clear ${sel} ${effect}`);
						return true
					}
				},
				{
					name: "cure",
					params: [
						{
							key: undefined,
							type: parseAsterisk()
						}
					],
					desc: "Cures all effects from the entity",
					resolve: (_)=>(sel,e)=>{
						e.write(`effect clear ${sel}`);
					}
				},
				{
					name: "give",
					desc: "Gives the specified item to this player",
					params: [
						{
							key: "item",
							type: Parsers.item.configured({tag: false}),
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
					resolve: (params)=>(sel,e)=>{
						e.write('give ' + sel + ' ' + toStringItem(params.item(e),e) + (params.count ? ' ' + e.valueOf(params.count) : ''));
					}
				},
				{
					name: "clear",
					desc: "Clears the specified item or item tag from the player's inventory",
					params: [
						{
							key: "item",
							type: Parsers.item.configured({tag: true}),
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
					resolve: (params)=>(sel,e)=>{
						if (!params.item) {
							e.write('clear ' + sel);
							return;
						}
						e.write('clear ' + sel + ' ' + toStringItem(params.item(e),e) + (params.count ? ' ' + e.valueOf(params.count) : ''));
						return true
					}
				},
				{
					name: "count",
					desc: "Counts the items that match the specified item in the player's inventory",
					params: [
						{
							key: 'item',
							type: Parsers.item.configured({tag: true}),
							desc: "The item predicate to count",
						}
					],
					playersOnly: true,
					resolve: (params)=>(sel,e)=>{
						e.write('clear ' + sel + ' ' + toStringItem(params(e),e) + ' 0');
						return true
					}
				},
				{
					name: "attributes",
					desc: "Gets or modifies the entity's attributes",
					type: ValueTypeObject.custom('Attributes',(t)=>{
						t.expectValue('.');
						let attr = t.expectType(TokenType.identifier,()=>allAttributes);
						if (allAttributes.indexOf(attr.value) < 0) {
							t.error(attr.range,"Unknown attribute '" + attr.value + "'");
						}
						if (!t.skip('.')) {
							let scale: Lazy<number>;
							if (t.skip('*')) {
								scale = parseSingleValue(t,VariableTypes.double);
							}
							return <AttributeArgs>{attr, cmd: e=>'get ' + e.stringify(scale)}
						}
						let cmd = attributeMethods.parse(t,true);
						return <AttributeArgs>{attr, cmd: cmd ? cmd.res : undefined};
					}),
					noEqualSign: true,
					resolve: (args: AttributeArgs)=>(sel,e)=>{
						let attrId = getVanillaAttributeId(args.attr.value);
						e.write('attribute ' + sel + ' ' + attrId + ' ' + args.cmd(e));
					}
				},
				{
					name: "spread",
					desc: "Spreads the entities randomly around the specified center coords",
					params: [
						{
							key: 'center',
							type: ValueTypeObject.custom('HorizontalLocation',(t)=>{
								return parseLocation(t,false)
							}),
							desc: "The XZ center of the spreading area"
						},
						{
							key: 'distance',
							desc: "The distance in blocks between each teleport location",
							type: VariableTypes.double
						},
						{
							key: 'maxRange',
							desc: "The maximum distance from the center to spread the entities",
							type: VariableTypes.double
						},
						{
							key: 'respectTeams',
							type: Parsers.enum.configured({values: ['teams','individual']}),
							desc: "Use 'teams' to teleport entities of the same team to the same location, or 'individual' to teleport each entity separately.",
							optional: true
						},
						{
							key: 'maxHeight',
							type: VariableTypes.integer,
							desc: "The maximum height to teleport to",
							optional: true
						}
					],
					resolve: (params)=>(sel,e)=>{
						let cmd = 'spreadplayers ' + toStringPos(params.center,e) + ' ' + e.valueOf(params.distance) + ' ' + e.valueOf(params.maxRange);
						if (params.maxHeight) {
							cmd += ' under ' + e.stringify(params.maxHeight);
						}
						if (params.respectTeams) {
							cmd += ' ' + (params.respectTeams == 'teams')
						} else {
							cmd += ' false'
						}
						e.write(cmd + ' ' + sel);
					}
				},
				{
					name: 'equip',
					desc: "Equips the specified item to the specified slot in the entity's inventory",
					params: [
						{
							key: 'slot',
							type: Parsers.enum.configured({values: Object.keys(Registry.allEquipmentSlots)},'Slot'),
						},
						{
							key: 'item',
							type: Parsers.item.configured({tag: false})
						}
					],
					resolve: (params)=>(sel,e)=>{
						e.write('replaceitem entity ' + sel + ' ' + Registry.allEquipmentSlots[params.slot] + ' ' + toStringItem(params.item(e),e))
					}
				},
				{
					name: 'tag',
					desc: "Adds a custom tag to the entity. Can be used to select it with the [tag=] parameter.",
					params: [
						{
							key: 'tag',
							type: ValueTypeObject.custom('Identifier',t=>{
								let res = parseIdentifierOrVariable(t);
								if (res.literal) {
									if (t.ctx.script.usedEntityTags.indexOf(res.literal) < 0) {
										t.ctx.script.usedEntityTags.push(res.literal);
									}
								}
								return res;
							})
						}
					],
					resolve: t=>(sel,e)=>{
						let tok = e.valueOf(t);
						e.suggestAt(tok.range,...e.entityTags);
						e.write('tag ' + sel + ' add ' + e.stringify(tok.value))
					}
				},
				{
					name: 'untag',
					desc: "Removes a custom tag from the entity.",
					params: [
						{
							key: 'tag',
							type: ValueTypeObject.custom('Identifier',t=>{
								return parseIdentifierOrVariable(t);
							})
						}
					],
					resolve: t=>(sel,e)=>{
						e.suggestAt(t.range,...e.entityTags);
						e.write('tag ' + sel + ' remove ' + e.stringify(t.value))
					}
				},
				{
					name: "join",
					desc: "Join this entity to a team",
					params: [
						{
							key: "team",
							type: VariableTypes.team
						}
					],
					resolve: t=>(sel,e)=>{
						e.write('team join ' + e.valueOf(t) + ' ' + sel);
					}
				},
				{
					name: "leaveTeam",
					desc: "Removes this entity from its team",
					params: [],
					resolve: t=>(sel,e)=>{
						e.write('team leave ' + sel);
					}
				},
				{
					name: "enable",
					desc: "Enables a trigger objective for this player to use",
					params: [
						{
							key: "trigger",
							type: VariableTypes.trigger
						}
					],
					resolve: t=>(sel,e)=>{
						e.write('scoreboard players enable ' + sel + ' ' + e.valueOf(t))
					}
				},
				{
					name: "tellraw",
					desc: "Sends a JSON text message to this player",
					params: [
						{
							key: "text",
							type: Parsers.compound.configured({json_type: 'chat'})
						}
					],
					resolve: json=>(sel,e)=>{
						e.write('tellraw ' + sel + ' ' + e.stringify(json))
					}
				}
			]
		}
		getSignatureString(member: SelectorMember): string {
			return '@selector.' + toStringMemberSignature(member);
		}

	}
	return _selectorMembers = new SelectorMembers()
}



export function parseSelectorCommand(tokens: TokenIterator, type?: string, canAssign: boolean = true): (selector: Selector, e: Evaluator)=>Variable<any> | boolean | void {
	if (tokens.skip('/')) {
		let path = parseNBTPath(tokens,false,Registry.entities.createPathContext(type).strict(type !== undefined));
		let access = parseNBTAccess(tokens,canAssign);
		return (s,e)=>{
			return access({path, selector: {type: 'entity',value: Selector.toString(s,e)}},e);
		}
	}
	if (!tokens.expectValue('.')) return undefined;
	let selectorMembers = getSelectorMembers();
	//tokens.suggestHere(...selectorMembers.map(k=>({value: k.name, detail: getSignatureString(k), desc: k.desc, type: k.type ? CompletionItemKind.Property : CompletionItemKind.Method})));
	tokens.suggestHere(...tokens.ctx.getVariableSuggestions(VariableTypes.objective,VariableTypes.trigger));
	let pos = tokens.pos;
	let res = selectorMembers.parse(tokens,false);
	if (res) {
		return (sel,e)=>{
			let str = Selector.toString(sel,e);
			if (res.used.playersOnly) {
				Selector.ensurePlayer(sel,e);
			}
			return res.res(str,e);
		}
	}
	tokens.pos = pos;
	let k = tokens.expectType(TokenType.identifier);
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
		if (!canAssign) {
			return (sel,e)=>{
				return {type: VariableTypes.score, value: {entry: Lazy.literal(sel,VariableTypes.selector), objective: e.valueOf(obj)}}
			}
		}
		let mod = parseScoreModification(tokens);
		return (sel,e)=>{
			return mod({entry: Selector.asLazyString(sel),objective: e.valueOf(obj)},e);
		}
	}
}

export interface SelectorUsage {
	selector: Lazy<Selector>
	nbt?: NBTPath
	score?: Lazy<Score>
}

/* export function parseSelectorUsage(t: TokenIterator): SelectorUsage {
	let selector: Lazy<Selector>;
	let type: string
	if (t.isTypeNext(TokenType.identifier) && !t.isNext('self')) {
		selector = t.expectVariable(VariableTypes.selector);
	} else {
		let s = parseSelector(t);
		type = s.type;
		if (!s) return;
		selector = Lazy.literal(s,VariableTypes.selector);
	}
	if (t.isNext('/')) {
		let path = parseNBTPath(t,false,NBTPathContext.create(nbtRegistries.entities,type));
		return {selector, nbt: path};
	}
	if (t.isNext('.')) {
		let cmd = parseSelectorCommand(t,type,false);
		return {
			selector,
			score: e=>{
				let newE = e.recreate();
				let c: string[] = []
				newE.assignTarget(c);
				let res = cmd(e.valueOf(selector),newE);
				if (res && res.type == VariableTypes.score) {
					return res.value;
				}
				let temp = e.generateTempScore('score');
				e.write('execute store result score ' + temp.asString + ' run ' + e.getLastCommand(c));
				return temp.asScore;
			}
		}
	}
} */