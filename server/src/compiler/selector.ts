import { TokenIterator, TokenType } from './tokenizer'
import { Lazy, parseExpression, parseList, Evaluator, parseIdentifierOrIndex, parseResourceLocation } from './parser'
import { VariableType, StatementSyntax, VariableTypes } from './util';
import { entities } from './entities';
import { Range, CompletionItemKind } from 'vscode-languageserver';

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
	expr: Range,
	target: SelectorTarget,
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
		e.error(selector.expr,"This selector can target non-players");
	}
}

interface ParamParserResult {res: Lazy<any> | Lazy<any>[],allowMore: boolean};

export type SelectorParamParser = {
	parse: (t: TokenIterator)=> Lazy<any> | ParamParserResult;
	customEquals?: boolean;
} | ((t: TokenIterator)=> Lazy<any> | ParamParserResult);

export function range(type: VariableType<number>): SelectorParamParser {
	return {
		customEquals: true,
		parse: (t)=>{
			let op = t.expectValue(">","<",">=","<=","=","between");
			if (op == 'between') {
				t.expectValue('(');
				let min = parseExpression(t,type);
				t.skip(",");
				let max = parseExpression(t,type);
				t.expectValue(')');
				return e=>{
					return {value: e.valueOf(min) + ".." + e.valueOf(max),type: VariableTypes.string};
				}
			}
			let val = parseExpression(t,type);
			switch (op) {
				case ">":
					return e=>({value: (e.valueOf(val) + 1) + "..",type: VariableTypes.string});
				case ">=":
					return e=>({value: e.valueOf(val) + "..",type: VariableTypes.string});
				case "<":
					return e=>({value: ".." + (e.valueOf(val) - 1),type: VariableTypes.string});
				case "<=":
					return e=>({value: ".." + e.valueOf(val),type: VariableTypes.string});
				case "=":
					t.suggestHere("to");
					if (t.skip("to")) {
						let max = parseExpression(t,type);
						return e=>({value: e.valueOf(val) + ".." + e.valueOf(max),type: VariableTypes.string});
					}
					break;
				default:
					break;
			}
			return e=>{
				let v = e.valueOf(val);
				return {value: "" + v,type: VariableTypes.string};
			};
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
		parser: range(VariableTypes.double),
		desc: "The range of distance from the current location to the target entity"
	},
	{
		key: "level",
		aliases: ["lvl"],
		parser: range(VariableTypes.double),
		desc: "The range of experience levels the target player should have"
	},
	{
		key: "x_rotation",
		aliases: ["x_rot","pitch"],
		desc: "The range of pitch (vertical orientation) of the target",
		parser: range(VariableTypes.double)
	},
	{
		key: "y_rotation",
		aliases: ["y_rot","yaw"],
		desc: "The range of yaw (horizontal orientation) of the target",
		parser: range(VariableTypes.double)
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
	["s","Targets the executing entity","self","this"]
]

export function parseSelector(tokens: TokenIterator): Selector {
	for (let ta of targetSelectors) {
		for (let i = 0; i < ta.length; i++) {
			if (i != 1) {
				tokens.suggestHere({value: ta[i],desc: ta[1]})
			}
		}
	}
	let entityIds = entities.map(e=>e.id);
	tokens.suggestHere(...entityIds);
	let span = {...tokens.nextPos}
	let typeId = tokens.expectType(TokenType.identifier);
	let target = undefined;
	let params: {key: string, value: Lazy<any>}[] = [];
	for (let ta of targetSelectors) {
		if (ta.indexOf(typeId.value) >= 0) {
			target = '@' + ta[0];
		}
	}
	if (!target) {
		if (entityIds.indexOf(typeId.value) >= 0) {
			target = "@e";
			params.push({key: "type",value: Lazy.literal(typeId.value,VariableTypes.string)});
		}
	}
	if (!target) {
		tokens.error(typeId.range,"Unknown target of selector");
		target = "@e";
	}
	console.log("selector target: " + target);
	if (tokens.skip('[')) {
		console.log("parsing selector params");
		let noMore = [];
		let scores: [string,Lazy<string>][] = [];
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
						if (!parser.customEquals) {
							tokens.expectValue('=');
						}
						res = parser.parse(tokens);
					}
					if (!add) continue;
					if ((res as Lazy<any>).name) {
						params.push({key: p.realKey || p.key,value: res as Lazy<any>})
					} else {
						let val = (res as ParamParserResult).res;
						if ((val as Lazy<any>).name) {
							params.push({key: p.realKey || p.key,value: val as Lazy<any>});
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
				let parser = range(VariableTypes.integer);
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
	return {expr: span,target,params};
}

interface SelectorMember {
	key: string | string[],
	desc?: string,
	syntax?: StatementSyntax,
	parser: (t: TokenIterator)=>(selector: Selector, e: Evaluator)=>any
}

function command(key: string | string[], parser: (t: TokenIterator)=>(selector: Selector, e: Evaluator)=>string, desc?: string): SelectorMember {
	return {
		key: key,
		desc: desc,
		parser: (t)=>{
			let res = parser(t);
			return (s,e)=>e.write(res(s,e));
		}
	}
}

function parseAdvancement(t: TokenIterator, mode: string): (selector: Selector, e: Evaluator)=>string {
	t.expectValue('(');
	if (t.suggestHere("from","through","until")) {
		let method = t.expectValue("from","through","until");
		let adv = parseResourceLocation(t);
		t.expectValue(')');
		return (s,e)=>{
			Selector.ensurePlayer(s,e);
			return `advancement ${mode} ${Selector.toString(s,e)} ${method} ${adv}`;
		}
	}
	if (t.skip('*')) {
		t.expectValue(')')
		return (s,e)=>{
			Selector.ensurePlayer(s,e);
			return `advancement ${mode} ${Selector.toString(s,e)} everything`;
		}
	}
	let adv = parseResourceLocation(t);
	let crit = "";
	if (t.skip('.')) {
		crit = " " + t.expectType(TokenType.identifier).value;
	}
	t.expectValue(')');
	return (s,e)=>{
		Selector.ensurePlayer(s,e);
		return `advancement ${mode} ${Selector.toString(s,e)} only ${adv}${crit}`;
	}
}

let selectorMembers: SelectorMember[] = [
	command('gamemode',(t)=>{
		t.expectValue('=');
		let gm: Lazy<string> = parseIdentifierOrIndex(t,"gamemode","survival","creative","adventure","spectator");
		return (s,e)=>{
			Selector.ensurePlayer(s,e);
			return `gamemode ${e.valueOf(gm)} ${Selector.toString(s,e)}`
		};
	},"Changes the gamemode of the target player"),
	command('tag',(t)=>{
		t.expectValue('(');
		let tag = parseExpression(t,VariableTypes.string);
		return (s,e)=>`tag ${Selector.toString(s,e)} add ${e.valueOf(tag)}`
	},"Adds a tag to the entity. Entities can be filtered by tag using @e[tag=...]"),
	command('untag',(t)=>{
		t.expectValue('(');
		let tag = parseExpression(t,VariableTypes.string);
		t.expectValue(')');
		return (s,e)=>`tag ${Selector.toString(s,e)} remove ${e.valueOf(tag)}`
	},"Removes an existing tag from the entity. Does nothing if that tag is not set."),
	command(['kill','remove'],(t)=>{
		t.expectValue('(');
		t.expectValue(')');
		return (s,e)=>'kill ' + Selector.toString(s,e);
	},"Kills the entity"),
	command('grant',t=>parseAdvancement(t,'grant')),
	command('revoke',t=>parseAdvancement(t,'revoke'))
]

export function parseSelectorCommand(tokens: TokenIterator): (selector: Selector, e: Evaluator)=>any {
	if (!tokens.expectValue('.')) return undefined;
	tokens.suggestHere(...selectorMembers.map(m=>({value: typeof m.key == 'string' ? m.key : m.key[0], desc: m.desc, type: CompletionItemKind.Method})));
	for (let m of selectorMembers) {
		if ((typeof m.key == 'string' && tokens.skip(m.key)) || (typeof m.key != 'string' && tokens.skip(...m.key))) {
			return m.parser(tokens);
		}
	}
	if (tokens.isTypeNext(TokenType.identifier)) {
		let pos = tokens.pos;
		let id = tokens.next();
		if (tokens.skip('(')) {
			tokens.expectValue(')');
			return (s,e)=>{
				let func = e.requireFunction(id);
				if (func) {
					e.write('execute as ' + Selector.toString(s,e) + ' at @s run function ' + func.toString());
				}
			}
		}
		tokens.pos = pos;
	}
	tokens.errorNext("Unknown selector member");
	return undefined;
}