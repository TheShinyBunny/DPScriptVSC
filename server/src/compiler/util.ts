

import { Lazy, Statement, parseExpression, Evaluator, parseSingleValue, Condition, evalCond, getCondEval, parseCondition, parseConditionNode } from "./parser";
import { TokenIterator, TokenType, Tokens, Token } from "./tokenizer";
import { parseBossbarField } from './bossbar';
import { parseEffect, Effect, TieredEffect, parseTieredEffect, TieredEnchantment, parseEnchantment } from './entities';
import { parseNBT, toStringNBT, parseFutureNBT, NBTAccess, parseFullNBTAccess, NBTSelector, parseNBTPath, NBTPathContext, toStringNBTPath, NBTRegistry, toStringNBTAccess, setValueInNBTByPath } from './nbt';
import { Selector, parseSelector, parseSelectorCommand, SelectorTarget } from './selector';

import { parseObjectInstanceAccess } from './oop';
import { Range, CompletionItemKind, SignatureHelp } from 'vscode-languageserver';
import { SignatureParameter, PathNode, ImportPath, mapFullPath, FutureSuggestion, SignatureItem, DeclarationSpan } from './compiler';

import * as fs from 'fs';
import * as paths from 'path';
import { URI } from 'vscode-uri';
import { TagTypes } from './tags';
import { isArray, isBoolean } from 'util';
import { praseJson, JsonContext, JsonTextType } from './json_text';
import { parseTeamUsage } from './teams';
import { Registry } from './registries';
import { parsePredicateNode, Predicate, flattenPredicate, PredicateItem } from './predicates';
import { ResourceLocation } from '.';

export interface SpecialNumber {
	num: number
	suffix: string
}

export enum CompareOperator {
	lt = '<',
	gt = '>',
	le = '<=',
	ge = '>=',
	eq = '='
}

export class Block {

	constructor(public tagged: boolean, public id: string, public state?: any, public nbt?: any) {}

	stringify(e: Evaluator) {
		return (this.tagged ? '#' : '') + 
			this.id + 
			(this.state ? '[' + Object.keys(this.state).map(k=>k + '=' + this.state[k]).join(',') + ']' : '') + 
			(this.nbt ? toStringNBT(this.nbt,e) : '')
	}
}

export interface VariableType<T> {
	name: string;
	isPrimitive: boolean;
	usageParser?: (tokens: TokenIterator, value: Lazy<T>, name: string)=>Statement;
	defaultValue: T;
	parser?: (t: TokenIterator)=>Lazy<T>
	stringify: (v: T, e: Evaluator)=>string;
	fromString?: (str: string)=>T;
	casts?: {from: ()=>VariableType<any>, apply: (v: any, e: Evaluator)=>T}[]
	isClass?: boolean
	instancible?: boolean
	compatible?: string[] 
}

export namespace VariableTypes {
	export const any: VariableType<any> = {
		name: "any",
		defaultValue: "any",
		isPrimitive: false,
		stringify: (a,e)=>"",
		instancible: false
	}
	export const objective: VariableType<string> = {
		name: "Objective",
		defaultValue: "",
		instancible: false,
		isPrimitive: false,
		usageParser: (t,v,name)=>{
			if (t.skip('=')) {
				let value = parseExpression(t,integer);
				return e=>{
					e.write('scoreboard players set * ' + name + ' ' + e.valueOf(value))
				}
			}
		},
		stringify: (obj,e)=>obj
	};
	export const string: VariableType<string> = {
		name: "string",
		defaultValue: "",
		stringify: (s)=>s,
		parser: t=>tokenParser(TokenType.string,()=>string)(t,v=>true),
		fromString: s=>s,
		isPrimitive: true,
		compatible: ['int','double']
	}
	export const score: VariableType<Score> = {
		name: "Score",
		defaultValue: {entry: undefined, objective: "Consts"},
		isPrimitive: true,
		usageParser: (t,val,name)=>{
			let mod = parseScoreModification(t);
			return e=>{
				let v = e.valueOf(val);
				return mod(v,e);
			}
		},
		stringify: (score,e)=>Score.toString(score,e)
	}
	export const integer: VariableType<number> = {
		name: "int",
		defaultValue: 0,
		fromString: (str)=>Number(str),
		stringify: (n)=>n.toString(),
		parser: t=>tokenParser(TokenType.int,()=>integer)(t,v=>true),
		isPrimitive: true,
		casts: [
			{
				from: ()=>VariableTypes.double,
				apply: (d)=>d
			}
		],
		compatible: ['double']
	}
	export const double: VariableType<number> = {
		name: "double",
		defaultValue: 0.0,
		fromString: (str)=>Number(str),
		stringify: (n)=>n.toString(),
		parser: t=>tokenParser(TokenType.double,()=>double)(t,v=>true),
		isPrimitive: true,
		casts: [
			{
				from: ()=>VariableTypes.integer,
				apply: (i)=>i
			}
		],
		compatible: ['int']
	}
	export const boolean: VariableType<boolean> = {
		name: "boolean",
		defaultValue: false,
		fromString: (str)=>str === 'true' ? true : false,
		stringify: (b)=>'' + b,
		parser: (t)=>{
			if (t.isNext('true','false')) return Lazy.literal(Boolean(t.next().value),boolean);
		},
		isPrimitive: true
	}
	export const json: VariableType<any> = {
		name: "json",
		defaultValue: {},
		parser: (t)=>praseJson(t,JsonContext.of(JsonTextType.title)),
		stringify: (json)=>JSON.stringify(json),
		isPrimitive: false
	}
	export const nbt: VariableType<any> = {
		name: "nbt",
		defaultValue: {},
		stringify: (nbt,e)=>toStringNBT(nbt,e),
		isPrimitive: false,
		parser: (t)=>parseNBT(t)
	}
	export const selector: VariableType<Selector> = {
		name: "Selector",
		defaultValue: {target: SelectorTarget.allEntities, params: [], type: ''},
		usageParser: (t,sel)=>{
			let cmd = parseSelectorCommand(t);
			return (e)=>{
				let s = e.valueOf(sel);
				let r = cmd(s,e);
			}
		},
		stringify: (s,e)=>{
			return Selector.toString(s,e);
		},
		parser: (t)=>{
			if (!t.isNext('self','@')) return
			return Lazy.literal(parseSelector(t),selector)
		},
		isPrimitive: true
	}
	export const bossbar: VariableType<string> = {
		name: "Bossbar",
		defaultValue: "unknown",
		usageParser: (t,v,name)=>parseBossbarField(t,name),
		isPrimitive: false,
		stringify: (b,e)=>b,
		instancible: false
	}
	export const tieredEffect: VariableType<TieredEffect> = {
		name:"TieredEffect",
		defaultValue: {id:"unknown_effect"},
		isPrimitive: false,
		stringify: (effect,e)=>{
			return effect.id + ' ' + (effect.tier || 0);
		},
		parser: parseTieredEffect
	}
	export const effect: VariableType<Effect> = {
		name: "Effect",
		defaultValue: {id: {id: "unknown_effect"}},
		isPrimitive: false,
		stringify: (effect,e)=>'',
		parser: parseEffect
	}
	export const duration: VariableType<number> = {
		name:"Duration",
		defaultValue: 0,
		isPrimitive: false,
		stringify: (d,e)=>'',
		parser: parseDuration
	}
	export const item: VariableType<Item> = {
		name:"Item",
		defaultValue: {id: "air"},
		stringify: (i,e)=>(i.tagged ? '#' : '') + i.id + (i.nbt ? toStringNBT(i.nbt,e) : ''),
		isPrimitive: false,
		parser: parseItem
	}
	export const taggableItem: VariableType<Item> = {
		name: "TaggableItem",
		defaultValue: {id: "air"},
		isPrimitive: false,
		stringify: (i,e)=>(i.tagged ? '#' : '') + i.id + (i.nbt ? toStringNBT(i.nbt,e) : ''),
		parser: (t)=>parseItem(t,true),
		casts: [
			{
				from: ()=>VariableTypes.item,
				apply: (i)=>i
			}
		]
	}
	export const block: VariableType<Block> = {
		name: "Block",
		defaultValue: new Block(false,'air'),
		stringify: (b,e)=>b.stringify(e),
		isPrimitive: false,
		parser: t=>parseBlock(t,true,false)
	}
	export const blockstate: VariableType<Block> = {
		name: "BlockState",
		defaultValue: new Block(false,'air'),
		stringify: (b,e)=>b.stringify(e),
		isPrimitive: false,
		parser: t=>parseBlock(t,false,false)
	}
	export const location: VariableType<Location> = {
		name: "Location",
		defaultValue: {x: undefined, y: undefined, z: undefined,rotated: false},
		isPrimitive: false,
		stringify: (loc,e)=>toStringPos(loc,e),
		parser: t=>Lazy.literal(parseLocation(t),location)
	}
	export const condition: VariableType<Condition> = {
		name: "Condition",
		defaultValue: {eval: e=>''},
		isPrimitive: true,
		casts: [
			{
				from: ()=>VariableTypes.selector,
				apply: (s: Selector)=>{
					return e=>'entity ' + Selector.toString(s,e)
				}
			},
			{
				from: ()=>VariableTypes.nbtAccess,
				apply: (a: NBTAccess)=>{
					return e=>'data ' + toStringNBTAccess(a,e)
				}
			},
			{
				from: ()=>VariableTypes.predicate,
				apply: (pred: Predicate, e)=>{
					let id: ResourceLocation
					if (pred.loc) {
						id = pred.loc;
					} else {
						id = new ResourceLocation(e.file.namespace,'predicate_' + pred.id + '_' + Math.round(Math.random() * 100))
						e.file.namespace.add(new PredicateItem(pred,id));
					}
					return e=>'predicate ' + id.toString()
				}
			}
		],
		stringify: evalCond,
		compatible: ['Score','Selector','int','double','boolean','string','Objective','NBTAccess']
	}
	export const specialNumber: VariableType<SpecialNumber> = {
		defaultValue: {num: 0, suffix: ''},
		isPrimitive: false,
		name: "number",
		stringify: (n)=>n.num + n.suffix
	}
	export const nbtAccess: VariableType<NBTAccess> = {
		defaultValue: {path: [], selector: {type: 'entity', value: '@s'}},
		isPrimitive: true,
		name: "NBTAccess",
		stringify: toStringNBTAccess,
		parser: parseFullNBTAccess
	}
	export const enchantment: VariableType<TieredEnchantment> = {
		defaultValue: {id: "protection"},
		isPrimitive: false,
		name: "Enchantment",
		stringify: (te,e)=>te.id + ' ' + te.lvl,
		parser: parseEnchantment
	}
	export const team: VariableType<string> = {
		defaultValue: 'defaultTeam',
		isPrimitive: false,
		name: "Team",
		instancible: false,
		stringify: (t,e)=>t,
		usageParser: (t,v,name)=>{
			return parseTeamUsage(t,name);
		}
	}
	export const range: VariableType<NumberRange> = {
		defaultValue: 0,
		isPrimitive: false,
		name: "Range",
		stringify: (r,e)=>Ranges.toString(r),
		compatible: ['int','double'],
		casts: [
			{
				from: ()=>VariableTypes.integer,
				apply: (i)=>i
			},
			{
				from: ()=>VariableTypes.double,
				apply: (i)=>i
			}
		],
		instancible: false,
		parser: (t)=>Ranges.parse(t,VariableTypes.double)
	}
	export const predicate: VariableType<Predicate> = {
		defaultValue: {id: "unknown",data: {}},
		isPrimitive: true,
		name: "Predicate",
		instancible: false,
		stringify: (p)=>p.loc ? p.loc.toString() : p.id,
		parser: (t)=>parsePredicateNode(t)
	}
}

export namespace VariableType {
	export function canCast(from: VariableType<any>, to: VariableType<any>) {
		return getCastPriority(from,to) > 0
	}

	export function getCastPriority(from: VariableType<any>, to: VariableType<any>): number {
		if (from == to) return 2;
		if (getImplicitCast(from,to) !== undefined) return 1;
		return 0;
	}

	export function getImplicitCast<T>(from: VariableType<any>, to: VariableType<T>): (v: any, e: Evaluator)=>T {
		if (!to.casts) return;
		let r = to.casts.find(c=>c.from() == from);
		return r ? r.apply : undefined
	}

	export function all(): VariableType<any>[] {
		return Object.keys(VariableTypes).map(k=>VariableTypes[k]);
	}
	
	export function is(obj: any): obj is VariableType<any> {
		return typeof obj == 'object' && 'name' in obj;
	}

	export function byTokenType(type: TokenType): VariableType<any> {
		switch (type) {
			case TokenType.string:
				return VariableTypes.string
			case TokenType.int:
				return VariableTypes.integer
			case TokenType.double:
				return VariableTypes.double
		}
		return undefined;
	}

	export function from(type: VariableType<any> | TokenType): VariableType<any> {
		return is(type) ? type : byTokenType(type);
	}

	export function getById(id: string) {
		return all().find(v=>v.name == id);
	}

	export function create(name: string): VariableType<any> {
		return {
			name: name,
			stringify: (a,e)=>"",
			isPrimitive: false,
			defaultValue: undefined,
			isClass: true,
			usageParser: (t,v)=>{
				return parseObjectInstanceAccess(t,v);
			}
		}
	}

	export function nonNatives() {
		return all().filter(t=>!t.isPrimitive);
	}
}

type ValueParser = (t: TokenIterator, isTypeAllowed: (type: VariableType<any>)=>boolean)=>Lazy<any>

function tokenParser<T>(token: TokenType, type: ()=>VariableType<T>): ValueParser {
	return (t,check)=>{
		if (t.isTypeNext(token) && check(type())) return Lazy.literal(type().fromString(t.next().value),type());
		return undefined;
	}
}

function selectorValueParser(t: TokenIterator, check: (type: VariableType<any>)=>boolean): Lazy<any> {
	if (t.isNext('@','self')) {
		let sel = parseSelector(t);
		if (t.isNext('.','/')) {
			if (!check(VariableTypes.score) && !check(VariableTypes.nbtAccess)) return;
			let range = t.startRange();
			let cmd = parseSelectorCommand(t,sel.type,false);
			t.endRange(range);
			if (cmd) {
				return e=>{
					let newE = e.recreate();
					let cmds: string[] = []
					newE.assignTarget(cmds);
					let res = cmd(sel,newE);
					if (isBoolean(res)) {
						let temp = e.generateTempScore('score');
						e.write('execute store result score ' + temp.asString + ' run ' + e.getLastCommand(cmds));
						return {value: temp.asScore, type: VariableTypes.score}
					} else if (res && (res.type == VariableTypes.nbtAccess || res.type == VariableTypes.score)) {
						return res;
					}
					e.error(range,"This method does not return a value");
				}
			}
		} else {
			if (!check(VariableTypes.selector)) return;
			return Lazy.literal(sel,VariableTypes.selector)
		}
	}
}

export const ValueParsers: ValueParser[] = [
	tokenParser(TokenType.int,()=>VariableTypes.integer),
	tokenParser(TokenType.string,()=>VariableTypes.string),
	tokenParser(TokenType.double,()=>VariableTypes.double),
	(t,c)=>{
		if (t.suggestHere('true','false') && c(VariableTypes.boolean)) return Lazy.literal(VariableTypes.boolean.fromString(t.next().value),VariableTypes.boolean);
	},
	selectorValueParser,
	(t,c)=>{
		if (!c(VariableTypes.score)) return
		let v = parseResultSuccessValue(t,false);
		if (!v) return;
		return e=>{
			let res = v.toCommand(e);
			if (res.literal) {
				return {value: Score.constant('#' + res.cmd), type: VariableTypes.score}
			} else if (res.value && res.value.type == VariableTypes.score) {
				return res.value;
			} else {
				let temp = e.generateTempScore('score');
				e.write('execute store ' + v.rs + ' score ' + temp.asString + ' ' + res.cmd);
				return {value: temp.asScore, type: VariableTypes.score}
			}
		}
	}
]



export interface Variable<T> {
	value: T
	type: VariableType<T>
}

export type DeclaredVariable<T> = Variable<T> & {decl: DeclarationSpan}

export interface Score {
	entry: Lazy<string>;
	objective: string;
}

export namespace Score {

	export function constant(entry: string): Score {
		return {entry: Lazy.literal(entry,VariableTypes.string), objective: "Consts"};
	}

	export function global(entry: string): Score {
		return {entry: Lazy.literal(entry,VariableTypes.string),objective: "Global"};
	}

	export function toString(score: Score | Lazy<Score>, e: Evaluator): string {
		let v = Lazy.is(score) ? e.valueOf(score) : score;
		return !score ? "" : e.stringify(v.entry) + ' ' + v.objective;
	}

	export function is(obj: any): obj is Score {
		return typeof obj == 'object' && 'objective' in obj;
	}
}

export function equalsAll<T>(to: T, ...values: T[]) {
	for (let v of values) {
		if (v !== to) return false;
	}
	return true;
}

export function equalsAny<T>(to: T, ...values: T[]) {
	for (let v of values) {
		if (v === to) return true;
	}
	return false;
}

export function equalsOneOf<T>(a: T[],b: T[]) {
	for (let i of a) {
		if (!equalsAny(i,...b)) {
			return false;
		}
	}
	return true;
}

export function equalsAnyOrOther<T>(values: T[], requires: T, optional: T) {
	return equalsAll(requires,...values) || (equalsAny(requires,...values) && equalsAny(optional,...values));
}

export function equalsXOR<T>(a1: T, a2: T, b1: T, b2: T) {
	return a1 != a2 && b1 != b2 && equalsOneOf([a1,a2],[b1,b2])
}

export function getAsArray<T>(val: T | T[]) {
	if (isArray(val)) return val;
	return [val];
}

export function getEnumByValue(enumCls: any, value: any) {
	return Object.keys(enumCls).map(k=>enumCls[k]).find(v=>v.valueOf() == value);
}

export function escapeString(str: string, escapeRegex: RegExp = /[\\'"]/g) {
    return str.replace(escapeRegex, '\\$&').replace(/\u0000/g, '\\0');
}

export type NumberRange = number | {min: number, max: number};

export namespace Ranges {
	export function toString(range: NumberRange) {
		return typeof range == 'number' ? range.toString() : ((range.min ? range.min.toString() : '') + '..' + (range.max ? range.max.toString() : ''))
	}

	export function is(value :any): value is NumberRange {
		return typeof value == 'number' || 'from' in value || 'to' in value;
	}

	export function inRange(range: NumberRange, n: number) {
		if (typeof range == 'number') return range == n;
		return (range.min === undefined || range.min <= n) && (range.max === undefined || range.max >= n); 
	}

	export function parse(t: TokenIterator, type: VariableType<number>): Lazy<NumberRange> {
		let min: Lazy<number>, max: Lazy<number>;
		let range = t.startRange();
		if (!t.isNext('..')) {
			min = parseExpression(t,type);
		}
		if (t.skip('..')) {
			max = parseExpression(t,type,false);
			t.endRange(range);
			return e=>{
				let nv = e.valueOf(min);
				let xv = e.valueOf(max);
				if (nv !== undefined && xv !== undefined) {
					if (nv >= xv) {
						e.error(range,"Minimum value must be greater than the maximum!")
					}
				}
				return {type: VariableTypes.range, value: {min: nv,max: xv}}
			}
		}
		return e=>{
			return {type: VariableTypes.range, value: e.valueOf(min)}
		}
	}
}


export function toLowerCaseUnderscored(str: string): string {
	let res = "";
	for (let i = 0; i < str.length; i++) {
		let c = str[i];
		if (i != 0 && c.match(/[A-Z]/g)) {
			if (i < str.length - 1) {
				return res + (str[i+1].match(/[A-Z]/g) ? '' : '_') + c.toLowerCase() + toLowerCaseUnderscored(str.substring(i+1));
			}
			return res + c.toLowerCase();
		}
		if (c.match(/[a-zA-Z0-9_]/g)) {
			res += c.toLowerCase();
		}
	}
	return res;
}



export interface StatementSyntax {
	label: string,
	syntax: SyntaxNode[]
}

export type SyntaxNode = string | {
	name: string,
	desc?: string,
	examples?: string
}

export function simpleVariableParser<T>(type: VariableType<T>): (t: TokenIterator)=>Lazy<T> {
	return (t)=>{
		return parseExpression(t,type);
	}
}

export function readRomanNumber(str: string): number {
	let num = romanToInt(str[0]);
	if (num < 0) return undefined;
	let prev = num, curr;
	for (let i = 1; i < str.length; i++) {
		curr = romanToInt(str[i]);
		if (!curr) return undefined;
		if (curr <= prev) {
			num += curr;
		} else {
			num = num - prev * 2 + curr;
		}
		prev = curr;
	}
	return num;
}

function romanToInt(c: string) {
	switch (c) {
		case 'I': return 1;
		case 'V': return 5;
		case 'X': return 10;
		case 'L': return 50;
		case 'C': return 100;
		case 'D': return 500;
		case 'M': return 1000;
		default: return -1;
	}
}

export interface IdentifierOrVariable {
	value: Lazy<string>
	range: Range
	literal?: string
}

export function parseIdentifierOrVariable(t: TokenIterator): IdentifierOrVariable {
	if (t.skip('$')) {
		let r = t.nextPos;
		return {value: t.expectVariable(VariableTypes.string), range: r};
	}
	if (t.isTypeNext(TokenType.identifier)) {
		let tok = t.next();
		return {value: Lazy.literal(tok.value,VariableTypes.string), range: tok.range, literal: tok.value};
	}
}

export function parseDuration(t: TokenIterator): Lazy<number> {
	let nodes: {n: Lazy<number>, factor: number}[] = [];
	let num = parseSingleValue(t,VariableTypes.integer);
	if (!num) return undefined;
	while (t.hasNext()) {
		t.suggestHere('s','t','ms','m','h','d');
		if (t.isTypeNext(TokenType.identifier)) {
			let unit = t.next();
			let stop = false;
			switch(unit.value) {
				case 's':
				case 'secs':
				case 'seconds':
					nodes.push({n: num, factor: 20})
					break;
				case 't':
				case 'ticks':
					nodes.push({n: num, factor: 1})
					break;
				case 'ms':
				case 'millis':
				case 'milliseconds':
					nodes.push({n: num, factor: 0.001})
					break;
				case 'm':
				case 'mins':
				case 'minutes':
					nodes.push({n: num, factor: 1200});
					break;
				case 'h':
				case 'hours':
					nodes.push({n: num, factor: 72000});
					break;
				case 'd':
				case 'days':
					nodes.push({n: num, factor: 1728000});
					break;
				case 'hide':
					stop = true;
					break;
				default:
					t.error(unit.range,'Invalid duration unit');
			}
			if (stop) {
				nodes.push({n: num, factor: 1});
				break;
			}
			num = parseSingleValue(t,VariableTypes.integer);
			if (!num) {
				break;
			}
		} else {
			nodes.push({n: num, factor: 1});
			break;
		}
	}
	console.log('Token after parsing duration:',t.peek())
	return e=>{
		let result = 0;
		for (let n of nodes){
			let a = e.valueOf(n.n);
			result += a * n.factor;
		}
		result = Math.round(result);
		return {value: result, type: VariableTypes.integer};
	}
}

export interface Item {
	tagged?: boolean
	id: string
	nbt?: any
}

export function parseItem(t: TokenIterator, taggable: boolean = false): Lazy<Item> {
	t.suggestHere(...Registry.items.keys());
	let tagged = false;
	if (taggable) {
		tagged = t.skip('#');
	}
	let id = parseIdentifierOrVariable(t);
	if (!id) return;
	let nbt: Lazy<any> = undefined;
	if (t.isNext('{')) {
		nbt = parseFutureNBT(t,Lazy.untyped(e=>{
			return Registry.items.createContext(e.valueOf(id.value))
		}))
	}
	return e=>{
		let realId = e.valueOf(id.value);
		if (realId !== "" && !tagged && Registry.items.get(realId) === undefined) {
			e.error(id.range,"Unknown item ID " + realId);
		}
		if (tagged) {
			e.suggestAt(id.range,...e.tags.filter(t=>t.type == TagTypes.item).map(t=>({value: t.id, type: CompletionItemKind.Enum})))
			let tag = e.requireTag({type: TagTypes.item, token: {range: id.range, value: realId, type: TokenType.identifier}});
			realId = tag.loc.toString();
		}
		return {value: {id: realId,nbt: e.valueOf(nbt), tagged},type: VariableTypes.item}
	}
}



export function parseBlock(t: TokenIterator, allowNBT: boolean, tag: boolean): Lazy<Block> {
	t.suggestHere(...Object.keys(Registry.blocks));
	let tagged = false;
	if (tag) {
		tagged = t.skip('#');
	}
	let id = parseIdentifierOrVariable(t);
	if (!id) return;
	let state = undefined;
	let nbt = undefined;
	if (t.isNext('[')) {
		state = parseBlockState(t,id.literal);
	}
	let pos = t.pos;
	if (allowNBT && t.skip('{')) {
		let readNBT = true;
		if (t.isTypeNext(TokenType.line_end)) {
			readNBT = false;
		}
		t.pos = pos;
		if (readNBT) {
			nbt = parseFutureNBT(t,Lazy.untyped((e)=>{
				let block = Registry.blocks[e.valueOf(id.value)];
				let te = block === undefined ? undefined : block.tile_entity;
				return Registry.tile_entities.createContext(te);
			}));
		}
	}
	return e=>{
		let realId = e.valueOf(id.value);
		if (Registry.blocks[realId] === undefined) {
			e.error(id.range,"Unknown block ID " + realId);
		}
		if (tagged) {
			e.suggestAt(id.range,...e.tags.filter(t=>t.type == TagTypes.block).map(t=>({value: t.id, type: CompletionItemKind.Enum})))
			let tag = e.requireTag({type: TagTypes.block, token: {range: id.range, value: realId, type: TokenType.identifier}});
			realId = tag.loc.toString();
		}
		return {value: new Block(tagged,realId,state,e.valueOf(nbt)),type: VariableTypes.block}
	}
}

export function parseBlockState(t: TokenIterator, blockId: string): any {
	t.expectValue('[');
	let state = {};
	let props = blockId ? (Registry.blocks[blockId] || {}).props : undefined;
	while (t.hasNext()) {
		if (props) {
			t.suggestHere(...Object.keys(props));
		}
		if (t.isNext(']')) break;
		let key = t.expectType(TokenType.identifier);
		let values = props ? props[key.value] : undefined;
		if (props && !values) {
			t.error(key.range,"Unknown property for block " + blockId + ": '" + key.value + "'");
		}
		t.expectValue('=');
		if (values) {
			t.suggestHere(...values);
		}
		let value = t.next();
		if (values && values.indexOf(value.value) < 0) {
			t.error(value.range,"Invalid value for property " + key.value);
		}
		state[key.value] = value.value;
		if (!t.skip(',')) {
			break
		}
	}
	t.expectValue(']');
	return state;
}

export function parseList<T>(tokens: TokenIterator, open: string, close: string, valueParser: (index: number, listSoFar: T[])=>T, itemCount?: NumberRange): T[] {
	let arr: T[] = [];
	if (!tokens.expectValue(open)) return [];
	let i = 0;
	let outOfRange: Range;
	while (tokens.hasNext() && !tokens.isNext(close)) {
		let inRange = !itemCount || Ranges.inRange(itemCount,i);
		if (!inRange) {
			if (!outOfRange) {
				outOfRange = tokens.startRange();
			}
		}
		let v = valueParser(i,arr);
		
		if (inRange) {
			arr.push(v);
		}
		if (!tokens.skip(',')) {
			break;
		}
		i++;
	}
	if (outOfRange) {
		tokens.endRange(outOfRange);
		tokens.error(outOfRange,"Expected only " + Ranges.toString(itemCount) + " items, but found " + i);
	}
	tokens.expectValue(close);
	return arr;
}

export function parseIdentifierOrIndex(tokens: TokenIterator, name: string, ...values: string[]): Lazy<string> {
	tokens.suggestHere(...values);
	if (tokens.isTypeNext(TokenType.string,TokenType.identifier)) {
		for (let v of values) {
			if (v.toLowerCase() == tokens.peek().value.toLowerCase()) {
				tokens.next();
				return Lazy.literal(v,VariableTypes.string);
			}
		}
	}
	let span = {...tokens.nextPos};
	let value: Lazy<any> = parseExpression(tokens);
	if (!value) return undefined;
	span.end = tokens.lastPos.end;
	return e=>{
		let res = value(e);
		if (res.type == VariableTypes.string) {
			for (let v of values) {
				if (v.toLowerCase() == res.value.toLowerCase()) {
					return {value: v,type: VariableTypes.string}
				}
			}
			e.error(span,"Expected one of " + values.join(', '));
			return {value: values[0],type: VariableTypes.string};
		} else if (res.type == VariableTypes.integer) {
			let i: number = res.value;
			console.log("number: '" + i + "'")
			if (i < 0 || i > values.length) {
				e.error(span,"Invalid " + name + " index, must be between 0 and " + (values.length-1));
				return {value: values[0],type: VariableTypes.string};
			}
			return {value: values[i],type: VariableTypes.string};
		}
		e.error(span,"Expected " + name + " expression to be an integer or a string");
		return {value: values[0],type: VariableTypes.string};
	}
}

export function parseResourceLocation(tokens: TokenIterator, tag?: boolean) {
	let loc = "";
	if (tokens.isTypeNext(TokenType.string)) {
		let t = tokens.next();
		if (t.value.startsWith('#') && !tag) {
			tokens.error(t.range,"Tags are not supported here");
		}
		return t.value;
	}
	if (tokens.isNext('#')) {
		if (tag) {
			loc += '#';
		} else {
			tokens.errorNext('Tags are not supported here');
		}
		tokens.next();
	}
	loc += tokens.expectType(TokenType.identifier).value;
	let path = false;
	if (tokens.skip(':')) {
		loc += ':';
		path = true;
	}
	if (tokens.skip('/') || path) {
		if (!path) {
			loc += '/';
		}
		while (tokens.hasNext()) {
			loc += tokens.expectType(TokenType.identifier).value;
			if (tokens.skip('/')) {
				loc += '/';
			} else {
				break
			}
		}
	}
	return loc;
}

export interface Location {
	rotated: boolean
	x: Coordinate
	y: Coordinate
	z: Coordinate
}

export interface Rotation {
	yaw: Coordinate
	pitch: Coordinate
}

export interface Coordinate {
	relative: boolean
	value: Lazy<number>
}

export function parseLocation(tokens: TokenIterator, verticalCoord: boolean = true): Location {
	let x: Coordinate, y: Coordinate, z: Coordinate;
	let first = true;
	if (!tokens.skip('[')) return;
	let rotated = tokens.skip('^');
	let definedProps: string[] = [];
	while (tokens.hasNext()) {
		if (rotated) {
			tokens.suggestHere(...['here','up','down','left','right','forward','backward'].filter(a=>definedProps.indexOf(a) < 0))
		} else {
			tokens.suggestHere(...['here','x',...(verticalCoord ? ['y','up','down'] : []),'z','north','south','east','west'].filter(a=>definedProps.indexOf(a) < 0))
		}
		console.log(tokens.peek());
		if (tokens.skip(']')) break;
		let token = tokens.next();
		let found = true;
		switch (token.value) {
			case 'here':
				if (!first) {
					tokens.warn(token.range,"'here' can only be used by itself in a location")
				}
				x = z = {relative: true, value: Lazy.literal(0,VariableTypes.double)}
				if (verticalCoord) {
					y = x;
				}
				tokens.expectValue(']');
				return {rotated,x,y,z}
			case 'x': {
				x = parseLiteralCoordinate(x,token,tokens,rotated);
				break
			}
			case 'y': {
				if (!verticalCoord) {
					found = false;
					break;
				}
				y = parseLiteralCoordinate(y,token,tokens,rotated);
				break
			}
			case 'z':{
				z = parseLiteralCoordinate(z,token,tokens,rotated);
				break
			}
			case 'north':
			case 'south': {
				if (rotated) {
					tokens.error(token.range,"This property cannot be used in a rotated position");
				}
				if (z) {
					tokens.warn(token.range,"Z-coordinate already defined!");
				}
				let neg = token.value == 'north'? -1 : 1;
				if (tokens.isNext(',',']')) {
					z = {relative: true, value: Lazy.literal(neg,VariableTypes.double)}; 
					break;
				}
				neg *= tokens.skip('-') ? -1 : 1;
				let n = parseSingleValue(tokens,[VariableTypes.double,VariableTypes.integer]) || 1;
				z = {relative: true, value: e=>({value: <number>e.valueOf(n) * neg,type: VariableTypes.double})}
				break
			}
			case 'east':
			case 'west': {
				if (rotated) {
					tokens.error(token.range,"This property cannot be used in a rotated position");
				}
				if (x) {
					tokens.warn(token.range,"X-coordinate already defined!");
				}
				let neg = token.value == 'west'? -1 : 1;
				console.log('token after east/west:',tokens.peek());
				if (tokens.isNext(',',']')) {
					x = {relative: true, value: Lazy.literal(neg,VariableTypes.double)}; 
					break;
				}
				neg *= tokens.skip('-') ? -1 : 1;
				let n = parseSingleValue(tokens,[VariableTypes.double,VariableTypes.integer]) || 1;
				x = {relative: true, value: e=>({value: <number>e.valueOf(n) * neg,type: VariableTypes.double})}
				break
			}
			case 'left':
			case 'right': {
				if (!rotated) {
					tokens.error(token.range,'This property can only be used in a rotated position')
				}
				if (x) {
					tokens.warn(token.range,"Leftward-coordinate already defined!");
				}
				let neg = token.value == 'right'? -1 : 1;
				if (tokens.isNext(',',']')) {
					x = {relative: true, value: Lazy.literal(neg,VariableTypes.double)}; 
					break;
				}
				neg *= tokens.skip('-') ? -1 : 1;
				let n = parseSingleValue(tokens,[VariableTypes.double,VariableTypes.integer]) || 1;
				x = {relative: true, value: e=>({value: <number>e.valueOf(n) * neg,type: VariableTypes.double})}
				break
			}
			case 'up':
			case 'down': {
				if (!verticalCoord) {
					found = false;
					break;
				}
				if (y) {
					tokens.warn(token.range,"Upward-coordinate already defined!");
				}
				let neg = token.value == 'down'? -1 : 1;
				if (tokens.isNext(',',']')) {
					y = {relative: true, value: Lazy.literal(neg,VariableTypes.double)}; 
					break;
				}
				neg *= tokens.skip('-') ? -1 : 1;
				let n = parseSingleValue(tokens,[VariableTypes.double,VariableTypes.integer]) || 1;
				y = {relative: true, value: e=>({value: <number>e.valueOf(n) * neg,type: VariableTypes.double})}
				break
			}
			case 'forward':
			case 'backward': {
				if (!rotated) {
					tokens.error(token.range,'This property can only be used in a rotated position')
				}
				if (z) {
					tokens.warn(token.range,"Forward-coordinate already defined!");
				}
				let neg = token.value == 'backward'? -1 : 1;
				if (tokens.isNext(',',']')) {
					z = {relative: true, value: Lazy.literal(neg,VariableTypes.double)}; 
					break;
				}
				neg *= tokens.skip('-') ? -1 : 1;
				let n = parseSingleValue(tokens,[VariableTypes.double,VariableTypes.integer]) || 1;
				z = {relative: true, value: e=>({value: <number>e.valueOf(n) * neg,type: VariableTypes.double})}
				break
			}
			default:
				found = false;
		}
		console.log(tokens.peek());
		first = false;
		if (found) {
			definedProps.push(token.value);
		} else {
			tokens.error(token.range,'Unknown location property');
		}
		if (!tokens.isNext(',',']')) {
			tokens.errorNext('Expected , or ] after property');
			break
		}
		else if (tokens.skip(']')) {
			break;
		} else {
			tokens.skip(',');
		}
	}
	if (!x) {
		x = {relative: true,value: Lazy.literal(0,VariableTypes.double)}
	}
	if (!y) {
		y = {relative: true,value: Lazy.literal(0,VariableTypes.double)}
	}
	if (!verticalCoord) {
		y = undefined
	}
	if (!z) {
		z = {relative: true,value: Lazy.literal(0,VariableTypes.double)}
	}
	return {rotated,x,y,z}
}

function parseLiteralCoordinate(currentValue: Coordinate, token: Token, tokens: TokenIterator, rotated: boolean): Coordinate {
	if (rotated) {
		tokens.error(token.range,"This property cannot be used in a rotated position")
	}
	if (currentValue) {
		tokens.warn(token.range,token.value.toUpperCase() + "-coordinate already defined!");
	}
	if (tokens.skip('=')) {
		return {relative: false,value: parseExpression(tokens,VariableTypes.double)}
	} else if (tokens.skip('+')) {
		return {relative: true, value: parseSingleValue(tokens,[VariableTypes.double,VariableTypes.integer])}
	} else if (tokens.skip('-')) {
		return {relative: true, value: parseSingleValue(tokens,[VariableTypes.double,VariableTypes.integer])}
	} else {
		tokens.errorNext("Expected +, - or =");
	}
}

export function toStringPos(pos: Location, e: Evaluator) {
	if (!pos) return '~ ~ ~';
	let res = [];
	for (let c of [pos.x,pos.y,pos.z]) {
		if (!c) continue;
		let str = '';
		if (pos.rotated) {
			str += '^';
		} else if (c.relative) {
			str += '~';
		}
		let v = e.valueOf(c.value);
		if (v != 0 || str == '') {
			str += v;
		}
		res.push(str);
	}
	return res.join(' ');
}

export function parseRotation(tokens: TokenIterator): Rotation {
	let yaw: Coordinate, pitch: Coordinate;
	if (!tokens.isNext('[')) return;
	let first = true;
	let definedProps: string[] = [];
	while (tokens.hasNext()) {
		tokens.suggestHere(...['same','yaw','pitch'].filter(a=>definedProps.indexOf(a) < 0))
		if (tokens.skip(']')) break;
		let token = tokens.next();
		let found = true;
		switch (token.value) {
			case 'same':
				if (!first) {
					tokens.warn(token.range,"'same' can only be used by itself in a rotation")
				}
				yaw = pitch = {relative: true, value: Lazy.literal(0,VariableTypes.double)}
				tokens.expectValue(']');
				return {yaw,pitch};
			case 'yaw': {
				yaw = parseLiteralCoordinate(yaw,token,tokens,false);
				break
			}
			case 'pitch': {
				pitch = parseLiteralCoordinate(pitch,token,tokens,false);
				break
			}
		}
		first = false;
		if (found) {
			definedProps.push(token.value);
		}
		if (!tokens.skip(',')) {
			tokens.expectValue(']');
			break
		}
	}
}

export function toStringRot(rot: Rotation, e: Evaluator) {
	if (!rot) return '~ ~';
	let res = [];
	for (let c of [rot.yaw,rot.pitch]) {
		let str = '';
		if (c.relative) {
			str += '~';
		}
		let v = e.valueOf(c.value);
		if (v != 0 || str == '') {
			str += v;
		}
		res.push(str);
	}
	return res.join(' ');
}


export enum Opcode {
	not = '!',
	and = '&&',
	or = '||',
	lt = '<',
	le = '<=',
	gt = '>',
	ge = '>=',
	equal = '==',
	ne = '!=',
	modulo = '%',
	multi = '*',
	divide = '/',
	plus = '+',
	minus = '-',
	dummy = ''
}

export interface Operator {
	token: Opcode
	operations: VariableOperation[]
	apply: (l: any, r: any, e: Evaluator)=>any
	unary?: UnaryMode
	defaultResult?: VariableType<any>
}

export interface VariableOperation {
	type: VariableType<any>
	second?: VariableType<any> | VariableType<any>[]
	result: VariableType<any>
}

const DEFAULT_NUMBER_OPERATION: VariableOperation[] = [
	{
		type: VariableTypes.integer,
		result: VariableTypes.integer
	},
	{
		type: VariableTypes.double,
		second: [VariableTypes.double,VariableTypes.integer],
		result: VariableTypes.double
	}
]

const DEFAULT_SCORE_OPERATION: VariableOperation[] = [
	{
		type: VariableTypes.score,
		second: [VariableTypes.score,VariableTypes.integer],
		result: VariableTypes.score
	}
]

const SCORE_CONDITION: VariableOperation[] = [
	{
		type: VariableTypes.score,
		second: [VariableTypes.score,VariableTypes.integer],
		result: VariableTypes.condition
	}
]

export const NBT_LIKE_VARS = [VariableTypes.integer,VariableTypes.specialNumber,VariableTypes.double,VariableTypes.boolean,VariableTypes.string,VariableTypes.nbt]

export enum UnaryMode {
	never,
	allowed,
	always
}

export const operators: Operator[] = [
	{
		token: Opcode.plus,
		apply: (l,r)=>{
			if (r === undefined) return l;
			return l + r;
		},
		unary: UnaryMode.allowed,
		operations: [
			{
				type: VariableTypes.integer,
				result: VariableTypes.integer
			},
			{
				type: VariableTypes.double,
				second: [VariableTypes.integer,VariableTypes.double],
				result: VariableTypes.double
			},
			{
				type: VariableTypes.string,
				second: [VariableTypes.string,VariableTypes.integer,VariableTypes.double],
				result: VariableTypes.string
			}
		],
		defaultResult: VariableTypes.string
	},
	{
		token: Opcode.minus,
		apply: (l,r,e)=>{
			if (r === undefined) return -l;
			return l - r;
		},
		operations: DEFAULT_NUMBER_OPERATION,
		defaultResult: VariableTypes.double,
		unary: UnaryMode.allowed
	},
	{
		token: Opcode.multi,
		apply: (l,r,e)=>{
			return l * r;
		},
		operations: DEFAULT_NUMBER_OPERATION,
		defaultResult: VariableTypes.double
	},
	{
		token: Opcode.divide,
		apply: (l,r,e)=>{
			return l / r;
		},
		operations: DEFAULT_NUMBER_OPERATION,
		defaultResult: VariableTypes.double
	},
	{
		token: Opcode.modulo,
		apply: (l,r)=>{
			return l % r;
		},
		operations: DEFAULT_NUMBER_OPERATION,
		defaultResult: VariableTypes.double
	},
	{
		token: Opcode.plus,
		operations: DEFAULT_SCORE_OPERATION,
		apply: (l,r,e)=>{
			return operateScores(l,r,e,'+','add');
		}
	},
	{
		token: Opcode.minus,
		apply: (l,r,e)=>{
			return operateScores(l,r,e,'-','remove');
		},
		operations: DEFAULT_SCORE_OPERATION
	},
	
	{
		token: Opcode.multi,
		apply: (l,r,e)=>{
			return operateScores(l,r,e,'*');
		},
		operations: DEFAULT_SCORE_OPERATION
	},
	{
		token: Opcode.divide,
		apply: (l,r,e)=>{
			return operateScores(l,r,e,'/');
		},
		operations: DEFAULT_SCORE_OPERATION
	},
	{
		token: Opcode.modulo,
		apply: (l,r,e)=>{
			return operateScores(l,r,e,'%');
		},
		operations: DEFAULT_SCORE_OPERATION
	},
	{
		token: Opcode.or,
		apply: (l,r): Condition=>{
			return {
				includesNegation: true,
				eval: (e,neg)=>{
					let t = e.generateTempScore('orFlag');
					e.write(t.set(0))
					e.write('execute ' + evalCond(l,e) + ' run ' + t.set(1));
					e.write('execute ' + evalCond(r,e) + ' run ' + t.set(1));
					return negationStr(neg) + ' score ' + t.matches(1);
				}
			}
		},
		operations: [
			{
				type: VariableTypes.condition,
				result: VariableTypes.condition
			}
		]
	},
	{
		token: Opcode.and,
		apply: (l,r): Condition=>{
			return {
				eval: e=>evalCond(l,e) + ' ' + evalCond(r,e),
				includesNegation: true,
				negate: false
			}
		},
		operations: [
			{
				type: VariableTypes.condition,
				result: VariableTypes.condition
			}
		]
	},
	{
		token: Opcode.not,
		operations: [
			{
				type: VariableTypes.condition,
				result: VariableTypes.condition
			}
		],
		apply: (v,_,e)=>{
			console.log('negating condition',v)
			return <Condition>{
				eval: getCondEval(v), 
				negate: true,
				includesNegation: typeof v == 'function' ? false : v.includesNegation
			}
		},
		unary: UnaryMode.always
	},
	{
		token: Opcode.lt,
		operations: SCORE_CONDITION,
		apply: (l,r,e)=>{
			return compareScores(l,r,'<');
		}
	},
	{
		token: Opcode.gt,
		operations: SCORE_CONDITION,
		apply: (l,r)=>{
			return compareScores(l,r,'>')
		}
	},
	{
		token: Opcode.le,
		operations: SCORE_CONDITION,
		apply: (l,r)=>{
			return compareScores(l,r,'<=')
		}
	},
	{
		token: Opcode.ge,
		operations: SCORE_CONDITION,
		apply: (l,r)=>{
			return compareScores(l,r,'>=')
		}
	},
	{
		token: Opcode.equal,
		operations: SCORE_CONDITION,
		apply: (l,r)=>{
			return compareScores(l,r,'=')
		}
	},
	{
		token: Opcode.ne,
		operations: SCORE_CONDITION,
		apply: (l,r): Condition=>{
			let cond = compareScores(l,r,'=');
			return {
				negate: true,
				eval: getCondEval(cond)
			}
		}
	},
	{
		token: Opcode.equal,
		operations: [
			{
				type: VariableTypes.nbtAccess,
				second: NBT_LIKE_VARS,
				result: VariableTypes.condition
			}
		],
		apply: (l,r,e): Condition=>{
			let nbtAccess: NBTAccess = l.path && l.selector ? l : r;
			let value = nbtAccess == l ? r : l;
			let nbt = {};
			setValueInNBTByPath(nbtAccess.path,nbt,value,e);
			if (!nbtAccess) return undefined
			let selector = nbtAccess.selector.value;
			if (nbtAccess.selector.type != 'entity') return undefined
			let hasParams = selector.indexOf('[') >= 0
			return e=>'entity ' + (hasParams ? selector + ' if entity ' + selector.substring(0,selector.indexOf('[')) : selector) + '[nbt=' + toStringNBT(nbt,e) + ']'
		}
	},
	{
		token: Opcode.ne,
		operations: [
			{
				type: VariableTypes.nbtAccess,
				second: NBT_LIKE_VARS,
				result: VariableTypes.condition
			}
		],
		apply: (l,r,e): Condition=>{
			let nbtAccess: NBTAccess = l.path && l.selector ? l : r;
			let value = nbtAccess == l ? r : l;
			let nbt = {};
			setValueInNBTByPath(nbtAccess.path,nbt,value,e);
			if (!nbtAccess) return undefined
			let selector = nbtAccess.selector.value;
			if (nbtAccess.selector.type != 'entity') return undefined
			let hasParams = selector.indexOf('[') >= 0
			return {
				eval: e=>(hasParams ? 'if' : 'unless') + ' entity ' + (hasParams ? selector + ' unless entity ' + selector.substring(0,selector.indexOf('[')) : selector) + '[nbt=' + toStringNBT(nbt,e) + ']',
				includesNegation: true
			}
		}
	},
	{
		token: Opcode.or,
		operations: [
			{
				type: VariableTypes.predicate,
				result: VariableTypes.predicate
			}
		],
		apply: (p,p2,e): Predicate=>{
			return {id: "alternative", data: {terms: [...(p.id == 'alternative' ? p.data.terms : [flattenPredicate(p)]),...(p2.id == 'alternative' ? p2.data.terms : [flattenPredicate(p2)])]}}
		}
	},
	{
		token: Opcode.and,
		operations: [
			{
				type: VariableTypes.predicate,
				result: VariableTypes.predicate
			}
		],
		apply: (p,p2,e): Predicate=>{
			return {id: "list",data: [...(p.id == 'list' ? p.data : [flattenPredicate(p)]),...(p2.id == 'list' ? p2.data : [flattenPredicate(p2)])]}
		}
	},
	{
		token: Opcode.not,
		operations: [
			{
				type: VariableTypes.predicate,
				result: VariableTypes.predicate
			}
		],
		apply: (p): Predicate=>{
			return {id: "inverted", data: flattenPredicate(p)}
		}
	}
]

export function negationStr(neg: boolean) {
	return neg ? 'unless' : 'if'
}

function operateScores(l: Score | number, r: Score | number, e: Evaluator, operator: string, operationName?: string): Score {
	let temp = e.generateTempScore('exprTemp');
	let n: number;
	let score: Score;
	if (Score.is(l)) {
		if (Score.is(r)) {
			e.write('scoreboard players operation ' + temp.asString + ' = ' + Score.toString(l,e));
			e.write('scoreboard players operation ' + temp.asString + ' ' + operator + '= ' + Score.toString(r,e));
			return temp.asScore;
		} else {
			n = r;
		}
	} else {
		n = l;
		score = <Score>r;
	}
	e.write('scoreboard players operation ' + temp.asString + ' = ' + Score.toString(score,e));
	if (operationName) {
		e.write('scoreboard players ' + operationName + ' ' + temp.asString + ' ' + n);
	} else {
		let temp2 = e.createConst(n);
		e.write('scoreboard players operation ' + temp.asString + ' ' + operator + '= ' + Score.toString(temp2,e));
	}
	return temp.asScore;
}

function compareScores(left: Score | number, right: Score | number, op: string): Condition {
	return e=>'score ' + toStringScoreComparison(left,right,e,op);
}

export function toStringScoreComparison(left: Score | number, right: Score | number, e: Evaluator, op: string) {
	let n = undefined;
	let score: Score;
	if (typeof left == 'number') {
		n = left;
		score = <Score>right;
	} else if (typeof right == 'number') {
		n = right;
		score = left;
	}
	if (n !== undefined) {
		return Score.toString(score,e) + ' matches ' + Ranges.toString(formatRange(n,op));
	}
	return Score.toString(<Score>left,e) + ' ' + op + ' ' + Score.toString(<Score>right,e);
}

export const dummyOperator: Operator = {
	token: Opcode.dummy,
	apply: (l,r)=>undefined,
	operations: []
}

export function parseRangeComparison(t: TokenIterator, type: VariableType<number>): Lazy<NumberRange> {
	let op = t.expectValue(">","<",">=","<=","==","between");
	if (op == 'between') {
		t.expectValue('(');
		let min = parseExpression(t,type);
		t.skip(",");
		let max = parseExpression(t,type);
		t.expectValue(')');
		return e=>{
			return {value: {min: e.valueOf(min),max: e.valueOf(max)},type: VariableTypes.range};
		}
	}
	let val = parseExpression(t,type);
	t.suggestHere('to');
	if (op == '==' && t.skip('to')) {
		let max = parseExpression(t,type);
		return e=>({value: {min: e.valueOf(val), max: e.valueOf(max)},type: VariableTypes.range});
	}
	return e=>{
		let n = e.valueOf(val);
		return {value: formatRange(n,op),type: VariableTypes.range};
	}
}

export function formatRange(val: number, op: string): NumberRange {
	switch(op) {
		case ">":
			return {min: val + 1, max: undefined}
		case ">=":
			return {min: val,max: undefined}
		case "<":
			return {min: undefined, max: val - 1}
		case "<=":
			return {min: undefined, max: val}
		case '=':
		case '==':
			return val;
	}
	return val;
}

interface ScoreModifier {
	unary?: boolean
	literalCommand?: string
	operator?: string
	noLiteral?: boolean
}

const scoreModifiers: {[t: string]: ScoreModifier} = {
	'++': {
		unary: true,
		literalCommand: "add"
	},
	'--': {
		unary: true,
		literalCommand: "remove"
	},
	'-=': {
		literalCommand: "remove"
	},
	'+=': {
		literalCommand: "add"
	},
	'*=': {},
	'/=': {},
	'%=': {},
	'><': {
		noLiteral: true
	},
	'<=': {
		operator: '<'
	},
	'>=': {
		operator: '>'
	},
	'=':{
		literalCommand: "set"
	}
}

export function parseScoreModification(t: TokenIterator): (score: Score, e: Evaluator)=>Variable<any> | void {
	if (!t.isNext(...Object.keys(scoreModifiers))) {
		return (s,e)=>{
			e.write('scoreboard players get ' + Score.toString(s,e));
			return {type: VariableTypes.score, value: s}
		}
	}
	let opcode = t.expectType(TokenType.operator);
	let op = scoreModifiers[opcode.value];
	if (op === undefined) {
		if (opcode.type == TokenType.operator) {
			t.error(opcode.range,"Unknown score operator");
		}
		return e=>{}
	}
	if (op.unary) {
		return (score,e)=>{
			e.write('scoreboard players ' + op.literalCommand + ' ' + Score.toString(score,e) + ' 1');
		}
	}
	/* let value: Lazy<Score>;
	let rs = 'result';
	let st: Statement = undefined;
	t.suggestHere({value: 'result', snippet: 'result($0)'},{value: 'success', snippet: 'success($0)'});
	if (t.isNext('result','success')) {
		rs = t.next().value;
		t.expectValue('(');
		st = t.ctx.parser.parseStatement('function');
		if (st) {
			t.expectValue(')');
		} else {
			st = (e)=>{}
		}
	} else {
		value = parseExpression(t,VariableTypes.score);
	} */
	let value = parseResultSuccessValue(t,true);
	return (score,e)=>{
		let res = value.toCommand(e);
		if (res.literal) {
			e.write('scoreboard players set ' + Score.toString(score,e) + ' ' + res.cmd)
		} else {
			e.write('execute store ' + value.rs + ' score ' + Score.toString(score,e) + ' ' + res.cmd);
		}
		return {value: score, type: VariableTypes.score};
		/* let source: Score;
		if (st) {
			let r = e.getCommand('store',st,true);
			if (typeof r == 'string') {
				if (opcode.value == '=') {
					e.write('execute store ' + rs + ' score ' + Score.toString(score,e) + ' run ' + r);
					return {value: score, type: VariableTypes.score};
				} else {
					let gen = e.generateTempScore('storeTemp');
					e.write('execute store ' + rs + ' score ' + gen.asString + ' run ' + r);
					source = gen.asScore;
				}
			} else if (r.var.type == VariableTypes.score) {
				e.write(r.cmd());
				source = r.var.value;
			} else if (r.var.type == VariableTypes.integer) { // probably redundant
				source = Score.constant('#' + r.var.value);
			} else {
				e.error(opcode.range,"Score cannot be set to the source value");
				return;
			}
		} else if (value) {
			source = e.valueOf(value);
		} else {
			return;
		}
		
		let entry = e.valueOf(source.entry);
		let literal = source.objective == 'Consts';
		if (literal && op.noLiteral) {
			e.warn(opcode.range,"This operator may not accept constant score values");
			literal = false;
		}
		if (literal && op.literalCommand) {
			let n: number;
			if (e.hasConst(entry)) {
				n = e.consts[entry];
			} else {
				n = Number(entry.substring(1));
			}
			e.write('scoreboard players ' + op.literalCommand + ' ' + Score.toString(score,e) + ' ' + n);
		} else {
			if (source.objective == 'Consts') {
				e.ensureConst(entry);
			}
			e.write('scoreboard players operation ' + Score.toString(score,e) + ' ' + (op.operator || opcode.value) + ' ' + entry + ' ' + source.objective)
		}
		return {type: VariableTypes.score, value: score} */
	}
}

interface ResultSuccessHelper {
	rs: string
	toCommand: (e: Evaluator)=>{cmd: string, literal?: boolean, value?: Variable<any>}
}

export function parseResultSuccessValue(t: TokenIterator, allowLiteral: boolean): ResultSuccessHelper {
	let st: Statement = undefined;
	let value: Lazy<any> = undefined;
	let rs: string = 'result';
	if (t.suggestHere({value: 'result', snippet: 'result($0)'},{value: 'success', snippet: 'success($0)'})) {
		rs = t.next().value;
		t.expectValue('(');
		st = t.ctx.parser.parseStatement('function');
		if (st) {
			t.expectValue(')');
		} else {
			st = (e)=>{}
		}
	} else if (allowLiteral) {
		value = parseExpression(t);
	} else {
		return
	}
	return {rs, toCommand: (e)=>{
		if (st) {
			return {cmd: e.getCommandWithRun('store',st)};
		} else if (value) {
			let v = value(e);
			if (v.type == VariableTypes.score) {
				return {cmd: 'run scoreboard players get ' + Score.toString(v.value,e), value: v};
			}
			else if (v.type == VariableTypes.nbtAccess) {
				return {cmd: 'run data get ' + v.value.selector.type + ' ' + v.value.selector.value + ' ' + v.value.path, value: v}
			} else if (v.type == VariableTypes.integer) {
				return {cmd: '' + v.value, literal: true, value: v}
			} else {
				e.error(value.range,"This value cannot be used here");
			}
		}
		return {cmd: 'run say EMPTY STATEMENT!'};
	}}
}

export function parseEnumValue(t: TokenIterator, values: string[]): Lazy<string> {
	t.suggestHere(...values);
	if (t.isTypeNext(TokenType.identifier)) {
		let id = t.expectValue(...values);
		return Lazy.literal(id,VariableTypes.string);
	}
	let lazy = parseExpression(t,VariableTypes.string);
	return Lazy.map(lazy,(r,e)=>{
		if (values.indexOf(r) < 0) {
			e.error(lazy.range,"Expected one of: " + values.join(', '));
		}
		return r;
	});
}

export function parseIndexedIdentifier(t: TokenIterator, name: string, numeral: boolean, values: any, numberType: string): Lazy<any> {
	t.suggestHere(...Object.keys(values).map(k=>values[k]));
	let v = parseIdentifierOrVariable(t);
	return e=>{
		let val = e.valueOf(v.value);
		let index: string;
		for (let x of Object.keys(values)) {
			if (values[x] == val || x == val) {
				index = x;
			}
		}
		if (!index) {
			e.error(v.range,"Unknown " + name + ' value')
		}
		if (numeral) {
			if (numberType) {
				return {value: {num: Number(index),suffix: numberType},type: VariableTypes.specialNumber};
			}
			return {value: Number(index),type: VariableTypes.integer};
		}
		return {value: index, type: VariableTypes.string};
	}
}

export type ValueTypeObject = VariableType<any> | TokenParser | FunctionParser

interface SpecialValueTypeParser {
	parse(t: TokenIterator): any;
	label: string
}

class TokenParser implements SpecialValueTypeParser {
	constructor(private tt: TokenType, private values: string[]) {}
	label: string = TokenType[this.tt] + (this.values ? '(' + this.values.join(' | ') + ')' : '')

	parse(t: TokenIterator) {
		if (this.values) {
			t.suggestHere(...this.values);
		}
		if (!t.isTypeNext(this.tt)) return;
		let tok = t.expectType(this.tt);
		if (this.values && this.values.indexOf(tok.value) < 0) {
			t.error(tok.range,"Expected one of " + this.values.join(", "));
		}
		return tok.value;
	}

	withCustomLabel(label: string) {
		this.label = label;
		return this;
	}

}

class FunctionParser implements SpecialValueTypeParser {
	constructor(public label: string, private parser: (t: TokenIterator)=>any) {}

	parse(t: TokenIterator) {
		return this.parser(t);
	}
}

export namespace ValueTypeObject {
	export function token(type: TokenType, ...values: string[]): TokenParser {
		return new TokenParser(type,values);
	}

	export function custom(label: string, parser: (t: TokenIterator)=>any): FunctionParser {
		return new FunctionParser(label,parser);
	}

	export function listOf(item: ValueTypeObject) {
		return custom('list<' + getTypeAnnotation(item) + '>',t=>{
			return parseList(t,'[',']',()=>parseValueTypeObject(t,item));
		});
	}
}

export interface MethodParameter {
	key: string
	optional?: boolean
	type: ValueTypeObject
	desc?: string
}

interface MethodParseResult {
	data: any
	success: boolean
}

export function parseMethod(t: TokenIterator, params: MethodParameter[], signatureHelp: SignatureHelp): MethodParseResult {
	let result = {};
	for (let i = 0; i < params.length; i++) {
		let p = params[i];
		let range = t.startRange();
		let v = parseValueTypeObject(t,p.type,p.optional);
		t.endRange(range);
		t.ctx.editor.markActiveSignatureParam(signatureHelp,range,i);
		if (v === undefined) {
			t.error(range,"Expected " + getTypeAnnotation(p.type) + ' value');
			return {data: result, success: false}
		}
		result[p.key || i] = v;
		if (i < params.length - 1) {
			if (!params[i+1].optional) {
				if (!t.expectValue(',')) {
					return {data: result,success: false}
				}
			} else if (!t.skip(',')) {
				return {data: result, success: true}
			}
		}
		
	}
	if (params.length == 1) return {data: result[Object.keys(result)[0]], success: true};
	return {data: result, success: true};
}
export function parseValueTypeObject(tokens: TokenIterator, type: ValueTypeObject, optional?: boolean): any {
	if (VariableType.is(type)) {
		return parseExpression(tokens,<VariableType<any>>type,!optional);
	} else {
		return type.parse(tokens);
	}
}

export function getSignatureFromParam(p: MethodParameter): SignatureParameter {
	let typeStr = getTypeAnnotation(p.type);
	return {label: p.key, desc: p.desc, optional: p.optional, type: typeStr};
}



export function getTypeAnnotation(type: ValueTypeObject) {
	if (VariableType.is(type)) {
		return type.name;
	} else {
		return type.label;
	}
}


export function parseImportPath(t: TokenIterator, delim: TokenType | string): ImportPath {
	let nodes: PathNode[] = [];
	let all = false;
	let existsSoFar = true;
	let range = t.startRange();
	let extension: string = undefined;
	if (suggestNextPathNode(t,nodes)) {
		existsSoFar = false;
	}
	while (t.hasNext()) {
		if (t.isNext('*')) {
			all = true;
			break;
		} else {
			let range = t.startRange();
			let node = t.next();
			let value = node.value;
			if (node.type == TokenType.identifier && t.skip('.')) {
				extension = t.expectType(TokenType.identifier).value;
				value = node.value + '.' + extension;
			} else if (node.type == TokenType.string) {
				extension = node.value.substring(node.value.lastIndexOf('.') + 1);
			}
			t.endRange(range);
			nodes.push({value,range});
			if (extension || !t.skip('/')) {
				break
			}
			if (existsSoFar) {
				let res = suggestNextPathNode(t,nodes)
				if (res !== undefined) {
					if (res) {
						existsSoFar = false;
					}
					break;
				}
			}
		}
	}
	t.endRange(range);
	if (typeof delim == 'string' ? !t.isNext(delim) : !t.isTypeNext(delim)) {
		t.errorNext('Unexpected path node');
	}
	let fullPath = mapFullPath(t.ctx.dir,nodes);
	return {nodes, all, fullRange: range, extension, uri: URI.file(fullPath + (all ? '' : '.dps')).toString()}
}

function suggestNextPathNode(t: TokenIterator, nodes: PathNode[]): boolean {
	console.log('nodes',nodes);
	let fullPath = mapFullPath(t.ctx.dir,nodes);
	console.log("full imported path:",fullPath);
	if (!fs.existsSync(fullPath)) {
		return true;
	}
	if (fs.lstatSync(fullPath).isFile()) {
		return false;
	}
	let files = fs.readdirSync(fullPath);
	console.log('files',files);
	t.suggestHere(...files.filter(f=>{
		let full = paths.join(fullPath,f);
		if (fs.lstatSync(full).isDirectory()) {
			return true;
		}
		return paths.extname(full) == '.dps' && t.ctx.script.file !== full;
	}).map(f=>{
		let full = paths.join(fullPath,f);
		if (fs.lstatSync(full).isDirectory()) {
			return <FutureSuggestion>{value: f, type: CompletionItemKind.Folder}
		}
		return <FutureSuggestion>{value: paths.basename(f,'.dps'), type: CompletionItemKind.File, detail: 'DPScript'}
	}));
}


export function getSignatureParamLabel(param: SignatureParameter) {
	if (!param.label) return param.type;
	return param.label + (param.optional ? '?' : '') + (param.type ? ': ' + param.type : '');
}

export function toStringMemberSignature(m: BaseMemberEntry<any>) {
	let sig = m.params ? m.params.map(getSignatureFromParam) : [];
	return m.name + (m.type ? ': ' + getTypeAnnotation(m.type) : '(' + sig.map(p=>getSignatureParamLabel(p)).join(', ') + ')')
}

export type CommandGetter = (e: Evaluator)=>string

export interface BaseMemberEntry<R> {
	name: string
	desc: string
	snippet?: string
	params?: MethodParameter[]
	type?: ValueTypeObject
	noEqualSign?: boolean
	resolve: (params: any)=>R
}

export abstract class MemberGroup<M extends BaseMemberEntry<R>,R> {
	initialized: boolean = false

	members: M[]

	parse(t: TokenIterator, errorUnknown: boolean): {used: M, res: R, nameRange: Range} {
		if (!this.initialized) {
			this.members = this.init()
			this.initialized = true;
		}
		t.suggestHere(...getUniqueValues(this.members,m=>m.name).map(m=>({value: m.name,detail: this.getSignatureString(m) + this.getOverloadCount(m), desc: m.desc, snippet: m.snippet, type: m.params ? CompletionItemKind.Method : CompletionItemKind.Property})));
		let k = t.expectType(TokenType.identifier);
		let pos = t.pos;
		let members = this.members.filter(v=>v.name === k.value);
		let signatureHelp: SignatureHelp;
		if (members.length > 0) {
			signatureHelp = t.ctx.editor.createSignatureHelp(k.value,members.map(m=>({desc: m.desc,params: m.params ? m.params.map(getSignatureFromParam) : []})))
		} else {
			if (errorUnknown) {
				t.error(k.range,"Unknown member '" + k.value + "'");
			}
			return;
		}
		for (let i = 0; i < members.length; i++) {
			let m = members[i];
			let params: any;
			if (m.type) {
				if (m.noEqualSign || t.expectValue('=')) {
					params = parseValueTypeObject(t,m.type);
				} else {
					params = Lazy.literal('',VariableTypes.string);
				}
			} else {
				if (!t.skip('(')) {
					break;
				}
				let ps = m.params;
				if (ps) {
					let r = parseMethod(t,ps,signatureHelp)
					if (!r.success) {
						t.pos = pos;
						continue;
					} else {
						params = r.data;
					}
				}
				t.expectValue(')');
			}
			t.ctx.editor.setHover(k.range,{syntax: (m.type ? '(property)' : '(method)') + ' ' + this.getSignatureString(m), desc: m.desc});
			if (signatureHelp) {
				signatureHelp.activeSignature = i;
			}
			t.ctx.editor.setSignatureHelp(signatureHelp);
			return {used: m, res: m.resolve(params), nameRange: k.range};
		}
		t.error(k.range,"No overload of '" + k.value + "' found for these arguments")
		t.ctx.editor.setSignatureHelp(signatureHelp);
	}

	abstract init(): M[];

	getOverloadCount(member: M): string {
		let count = this.members.filter(m=>m.name == member.name).length;
		if (count > 1) {
			return ' (+' + (count - 1) + (count == 2 ? ' overload' : ' overloads') + ')'
		}
		return ''
	}

	getSignatureString(member: M): string {
		return toStringMemberSignature(member)
	}
}

export function ensureUnique<T>(t: TokenIterator, name: Token, list: T[], nameGetter: (obj: T) => string, objName: string) {
	for (let o of list) {
		if (nameGetter(o) == name.value) {
			t.error(name.range,"Duplicate " + objName + " '" + name.value + "'");
			return false;
		}
	}
	return true;
}

class LootSources extends MemberGroup<BaseMemberEntry<CommandGetter>,CommandGetter> {
	init(): BaseMemberEntry<CommandGetter>[] {
		return [
			{
				name: 'fish',
				params: [
					{
						key: 'table',
						type: ValueTypeObject.custom('LootTable',parseLootTableID)
					},
					{
						key: 'pos',
						type: VariableTypes.location
					},
					{
						key: 'tool',
						type: ValueTypeObject.custom("Item | 'mainhand' | 'offhand'",t=>{
							if (t.isNext('mainhand','offhand')) return t.next().value
							return parseItem(t,false);
						}),
						optional: true
					}
				],
				desc: 'Generates a loot from a loot table like generating loot for fishing, using a position of fishing and the tool used',
				resolve: (params)=>(e)=>{
					return 'fish ' + params.table + ' ' + e.stringify(params.pos) + (params.tool ? ' ' + e.stringify(params.tool) : '')
				}
			},
			{
				name: 'loot',
				params: [
					{
						key: 'table',
						type: ValueTypeObject.custom('LootTable',parseLootTableID)
					}
				],
				desc: 'Generates loot from a general loot table',
				resolve: lt=>e=>'loot ' + lt
			},
			{
				name: 'kill',
				params: [
					{
						key: 'entity',
						type: VariableTypes.selector
					}
				],
				desc: 'Generates the loot the specified entity would drop',
				resolve: sel=>e=>'kill ' + Selector.toString(sel,e)
			},
			{
				name: 'mine',
				params: [
					{
						key: 'pos',
						type: VariableTypes.location
					},
					{
						key: 'tool',
						type: ValueTypeObject.custom("Item | 'mainhand' | 'offhand'",t=>{
							if (t.isNext('mainhand','offhand')) return t.next().value
							return parseItem(t,false);
						}),
						optional: true
					}
				],
				desc: 'Generates the loot the block at the specified location would drop, using the specified tool',
				resolve: params=>e=>{
					return 'mine ' + e.stringify(params.pos) + (params.tool ? ' ' + e.stringify(params.tool) : '')
				}
			}
		]
	}

}

let lootSources: LootSources

export function parseLootTableID(t: TokenIterator) {
	return parseResourceLocation(t);
}

export function parseLootSource(t: TokenIterator) {
	if (!lootSources) {
		lootSources = new LootSources();
	}
	if (t.expectValue('loot')) {
		t.expectValue('.');
		let cmd = lootSources.parse(t,true);
		return cmd;
	}
}

interface Particle {
	params?: MethodParameter[]
	noSpeed?: boolean
	desc?: string
}

export interface ParticleInstance {
	type: Particle
	label: string
	labelRange: Range
}

const particles: {[id: string]: Particle} = {
	ambient_entity_effect: {
		desc: "When the 'count' is 0, the dx, dy and dz values act as RGB values (0 - 1.0), and 'speed' acts as a darkness multiplier."
	},
	angry_villager: {}
}

export function parseParticleType(t: TokenIterator): Lazy<ParticleInstance> {
	t.suggestHere(...Object.keys(particles));
	let typeId = parseIdentifierOrVariable(t);
	let params: TokenIterator;
	if (t.isNext('(')) {
		params = t.collectInsideBrackets('(',')',t.ctx.snapshot());
	}
	return e=>{
		let id = e.valueOf(typeId.value);
		let particle = particles[id];
		let label: string = id;
		if (particle === undefined) {
			e.error(typeId.range,"Unknown particle type '" + id + "'");
		} else if (particle.params) {
			if (params) {
				params.expectValue('(');
				let signature = t.ctx.editor.createSignatureHelp(id,[{desc: particle.desc,params: particle.params.map(getSignatureFromParam)}])
				let res = parseMethod(params,particle.params,signature);
				if (!res.success) {
					t.skip(')');
					return;
				}
				label += Object.keys(res.data).map(k=>e.stringify(res.data[k])).join(' ');
				params.expectValue(')');
				t.ctx.editor.setSignatureHelp(signature);
			} else {
				e.error(typeId.range,"This particle type requires parameters");
			}
		} else if (params) {
			e.error(params.fullRange,"This particle type does not take parameters");
		}
		return {type: VariableTypes.any, value: {label, type: particle, labelRange: typeId.range}}
	}
}

export function chainSpaced(e: Evaluator, ...values: any[]): string {
	return values.filter(v=>v !== undefined).map(v=>e.stringify(v)).join(' ')
}

export function getUniqueValues<T>(arr: T[], uniqueProp: (t: T)=>any) {
	let newArr: T[] = [];
	for (let o of arr) {
		if (newArr.find(t=>uniqueProp(t) == uniqueProp(o)) === undefined) {
			newArr.push(o);
		}
	}
	return newArr;
}

export interface InitializerOptions<M extends BaseMemberEntry<R>,R> {
	members: MemberGroup<M,R>
	uniqueFieldsOnly: boolean
}

export function parseInitializerBlock<M extends BaseMemberEntry<R>,R>(t: TokenIterator, options: InitializerOptions<M,R>, runner: (e: Evaluator,m: M,r: R)=>void): (e: Evaluator)=>void {
	let bracket = t.expectValue('{');
	if (t.skip('}')) {
		return e=>{}
	}
	t.nextLine(bracket !== '');
	let usedFields = new Map<M,R>();
	while (t.hasNext() && !t.isNext('}')) {
		let res = options.members.parse(t,true);
		if (res) {
			if (res.used.type && options.uniqueFieldsOnly && [...usedFields.keys()].find(f=>f.name == res.used.name)) {
				t.error(res.nameRange,"Field " + res.used.name + " is already set!");
			} else {
				usedFields.set(res.used,res.res);
			}
		}
		t.nextLine(true);
	}
	t.expectValue('}');
	return e=>{
		for (let f of usedFields.entries()) {
			runner(e,f[0],f[1]);
		}
	}
}
