

import { praseJson, JsonContext, JsonTextType } from './json_text';
import { Lazy, Statement, parseExpression, Evaluator, parseSingleValue, Condition, evalCond, getCondEval, toStringScoreComparison, parseCondition, parseConditionNode } from "./parser";
import { TokenIterator, TokenType, Tokens, Token } from "./tokenizer";
import { parseBossbarField } from './bossbar';
import { parseEffect, Effect, TieredEffect, parseTieredEffect, TieredEnchantment, parseEnchantment } from './entities';
import { parseNBT, toStringNBT, createNBTContext, nbtRegistries, parseFutureNBT, NBTAccess, parseFullNBTAccess, NBTSelector, parseNBTPath, NBTPathContext, toStringNBTPath, NBTRegistry } from './nbt';
import { Selector, parseSelector, parseSelectorCommand, SelectorTarget } from './selector';

import * as blocks from './registries/blocks.json'
import { parseObjectInstanceAccess } from './oop';
import { Range, CompletionItemKind } from 'vscode-languageserver';
import { SignatureParameter, PathNode, ImportPath, mapFullPath, FutureSuggestion } from './compiler';

import * as fs from 'fs';
import * as paths from 'path';
import { URI } from 'vscode-uri';
import { TagTypes } from './tags';

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
	parser?: ValueParser
	stringify: (v: T, e: Evaluator)=>string;
	fromString?: (str: string)=>T;
	castFrom?: (type: VariableType<any>,value: any, e: Evaluator)=>any
	isClass?: boolean
}

export namespace VariableTypes {
	export const any: VariableType<any> = {
		name: "any",
		defaultValue: "any",
		isPrimitive: false,
		stringify: (a,e)=>"",
	}
	export const objective: VariableType<string> = {
		name: "Objective",
		defaultValue: "",
		isPrimitive: false,
		stringify: (obj,e)=>obj
	};
	export const string: VariableType<string> = {
		name: "string",
		defaultValue: "",
		stringify: (s)=>s,
		parser: tokenParser(TokenType.string,()=>VariableTypes.string),
		fromString: s=>s,
		isPrimitive: true
	}
	export const score: VariableType<Score> = {
		name: "Score",
		defaultValue: {entry: undefined, objective: "Consts"},
		isPrimitive: true,
		castFrom: (type,value,e)=>{
			if (type == VariableTypes.integer) {
				console.log('converting int to score')
				return Score.constant('#' + value);
			}
		},
		stringify: (score,e)=>Score.toString(score,e)
	}
	export const integer: VariableType<number> = {
		name: "int",
		defaultValue: 0,
		fromString: (str)=>Number(str),
		stringify: (n)=>n.toString(),
		parser: tokenParser(TokenType.int,()=>VariableTypes.integer),
		isPrimitive: true
	}
	export const double: VariableType<number> = {
		name: "double",
		defaultValue: 0.0,
		fromString: (str)=>Number(str),
		stringify: (n)=>n.toString(),
		parser: tokenParser(TokenType.double,()=>VariableTypes.double),
		isPrimitive: true
	}
	export const boolean: VariableType<boolean> = {
		name: "boolean",
		defaultValue: false,
		fromString: (str)=>Boolean(str),
		stringify: (b)=>'' + b,
		parser: (t)=>{
			if (t.isNext('true','false')) return Lazy.literal(Boolean(t.next().value),VariableTypes.boolean);
		},
		isPrimitive: true
	}
	export const json: VariableType<any> = {
		name: "json",
		defaultValue: {},
		stringify: (json)=>JSON.stringify(json),
		isPrimitive: false
	}
	export const nbt: VariableType<any> = {
		name: "nbt",
		defaultValue: {},
		stringify: (nbt,e)=>toStringNBT(nbt,e),
		isPrimitive: false
	}
	export const selector: VariableType<Selector> = {
		name: "Selector",
		defaultValue: {target: SelectorTarget.allEntities, params: [], type: ''},
		usageParser: (t,sel)=>{
			let cmd = parseSelectorCommand(t);
			return (e)=>{
				let s = e.valueOf(sel);
				return cmd(s,e);
			}
		},
		stringify: (s,e)=>{
			return Selector.toString(s,e);
		},
		parser: (t)=>Lazy.literal(parseSelector(t),VariableTypes.selector),
		isPrimitive: true
	}
	export const bossbar: VariableType<string> = {
		name: "Bossbar",
		defaultValue: "unknown",
		usageParser: (t,v,name)=>parseBossbarField(t,name),
		isPrimitive: false,
		stringify: (b,e)=>b
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
		stringify: (i,e)=>'stringify taggable item',
		parser: (t)=>parseItem(t,true)
	}
	export const block: VariableType<Block> = {
		name: "Block",
		defaultValue: new Block(false,'air'),
		stringify: (b,e)=>b.stringify(e),
		isPrimitive: false,
		parser: t=>parseBlock(t,true,false)
	}
	export const location: VariableType<Location> = {
		name: "Location",
		defaultValue: {x: undefined, y: undefined, z: undefined,rotated: false},
		isPrimitive: false,
		stringify: (loc,e)=>toStringPos(loc,e),
		parser: t=>Lazy.literal(parseLocation(t),VariableTypes.location)
	}
	export const condition: VariableType<Condition> = {
		name: "Condition",
		defaultValue: {eval: e=>''},
		isPrimitive: true,
		castFrom: (type,value,e)=>{
			if (type == VariableTypes.selector) {
				return <Condition>(e=>'entity ' + Selector.toString(value,e))
			} else if (type == VariableTypes.nbtAccess) {
				let sel: NBTSelector = value.selector;
				return <Condition>(e=>'data ' + sel.type + ' ' + sel.value + ' ' + (<NBTAccess>value).path)
			}
		},
		stringify: evalCond
	}
	export const specialNumber: VariableType<SpecialNumber> = {
		defaultValue: {num: 0, suffix: ''},
		isPrimitive: false,
		name: "number",
		stringify: (n)=>n.num + n.suffix
	}
	export const nbtAccess: VariableType<NBTAccess> = {
		defaultValue: {path: '', selector: {type: 'entity', value: '@s'}},
		isPrimitive: true,
		name: "NBTAccess",
		stringify: (a,e)=>'',
		parser: parseFullNBTAccess
	}
	export const enchantment: VariableType<TieredEnchantment> = {
		defaultValue: {id: "protection"},
		isPrimitive: false,
		name: "Enchantment",
		stringify: (te,e)=>te.id + ' ' + te.lvl,
		parser: parseEnchantment
	}
}

export namespace VariableType {
	export function canCast(target: VariableType<any>, to: VariableType<any> | undefined) {
		return !target || !to || target == to || equalsOneOf([target,to],[VariableTypes.integer,VariableTypes.double]);
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

type ValueParser = (t: TokenIterator)=>Lazy<any>

function tokenParser<T>(token: TokenType, type: ()=>VariableType<T>): ValueParser {
	return t=>{
		if (t.isTypeNext(token)) return Lazy.literal(type().fromString(t.next().value),type());
		return undefined;
	}
}

export const ValueParsers: ValueParser[] = [
	tokenParser(TokenType.int,()=>VariableTypes.integer),
	tokenParser(TokenType.string,()=>VariableTypes.string),
	tokenParser(TokenType.double,()=>VariableTypes.double),
	t=>{
		if (t.isNext('true','false')) return Lazy.literal(VariableTypes.boolean.fromString(t.next().value),VariableTypes.boolean);
	},
	selectorValueParser,

]

function selectorValueParser(t: TokenIterator): Lazy<any> {
	if (t.isNext('@','self')) {
		let sel = parseSelector(t);
		if (t.skip('.')) {
			t.suggestHere(...t.ctx.getAllVariables(VariableTypes.objective).map(v=>v.name));
			let vname = t.expectType(TokenType.identifier);
			if (t.ctx.getVariableType(vname.value) !== VariableTypes.objective) {
				t.error(vname.range,"Unknown objective " + vname.value);
			}
			return Lazy.literal({entry: Selector.asLazyString(sel),objective: vname.value},VariableTypes.score);
		} else if (t.isNext('/')) {
			let path = parseNBTPath(t,true,NBTPathContext.create(nbtRegistries.entities,sel.type));
			return e=>{
				return {value: <NBTAccess>{path: toStringNBTPath(path,e), selector: {type: 'entity',value: Selector.toString(sel,e)}},type: VariableTypes.nbtAccess}
			}
		} else {
			return Lazy.literal(sel,VariableTypes.selector)
		}
	}
}

export interface Variable<T> {
	value: T
	type: VariableType<T>
}

export interface Score {
	entry: Lazy<string>;
	objective: string;
}

export namespace Score {

	export function constant(entry: string): Score {
		if (Lazy) {
			return {entry: Lazy.literal(entry,VariableTypes.string), objective: "Consts"};
		}
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
	return equalsAny(requires,...values) && !equalsAll(optional,...values);
}

export function getEnumByValue(enumCls: any, value: any) {
	return Object.keys(enumCls).map(k=>enumCls[k]).find(v=>v.valueOf() == value);
}

export function escapeString(str: string, escapeRegex: RegExp = /[\\'"]/g) {
    return str.replace(escapeRegex, '\\$&').replace(/\u0000/g, '\\0');
}

export type NumberRange = number | {from: number, to: number};

export namespace Ranges {
	export function toString(range: NumberRange) {
		return typeof range == 'number' ? range.toString() : ((range.from ? range.from.toString() : '') + '..' + (range.to ? range.to.toString() : ''))
	}

	export function is(value :any): value is NumberRange {
		return typeof value == 'number' || 'from' in value || 'to' in value;
	}

	export function inRange(range: NumberRange, n: number) {
		if (typeof range == 'number') return range == n;
		return (range.from === undefined || range.from <= n) && (range.to === undefined || range.to >= n); 
	}
}


export function toLowerCaseUnderscored(str: string): string {
	let res = "";
	for (let i = 0; i < str.length; i++) {
		let c = str[i];
		if (i != 0 && c.match(/[A-Z]/g)) {
			if (i < str.length - 1) {
				return res + '_' + c.toLowerCase() + toLowerCaseUnderscored(str.substring(i+1));
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

export function parseIdentifierOrVariable(t: TokenIterator): {value: Lazy<string>, range: Range, literal?: string} {
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
	t.suggestHere(...Object.keys(nbtRegistries.items.entries));
	let tagged = false;
	if (taggable) {
		tagged = t.skip('#');
	}
	let id = parseIdentifierOrVariable(t);
	let nbt: Lazy<any> = undefined;
	if (t.isNext('{')) {
		if (id.literal) {
			nbt = parseNBT(t,createNBTContext(nbtRegistries.items,id.literal));
		} else {
			nbt = parseFutureNBT(t,Lazy.remap(id.value,(i,e)=>{
				return {value: createNBTContext(nbtRegistries.items,i),type: undefined};
			}))
		}
	}
	return e=>{
		let realId = e.valueOf(id.value);
		if (realId !== "" && !tagged && nbtRegistries.items.entries[realId] === undefined) {
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
	t.suggestHere(...Object.keys(blocks.values));
	let tagged = false;
	if (tag) {
		tagged = t.skip('#');
	}
	let id = parseIdentifierOrVariable(t);
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
			nbt = parseFutureNBT(t,Lazy.remap(id.value,(b,e)=>{
				let block = blocks.values[b];
				let te = block ? block.tile_entity : undefined;
				return {value: createNBTContext(nbtRegistries.tileEntities,te),type: undefined};
			}));
		}
	}
	return e=>{
		let realId = e.valueOf(id.value);
		if (blocks.values[realId] === undefined) {
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
	let props = blockId ? blocks.values[blockId].props : undefined;
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
				let n = parseSingleValue(tokens,VariableTypes.double) || 1;
				z = {relative: true, value: e=>({value: e.valueOf(n) * neg,type: VariableTypes.double})}
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
				let n = parseSingleValue(tokens,VariableTypes.double) || 1;
				x = {relative: true, value: e=>({value: e.valueOf(n) * neg,type: VariableTypes.double})}
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
				let n = parseSingleValue(tokens,VariableTypes.double) || 1;
				x = {relative: true, value: e=>({value: e.valueOf(n) * neg,type: VariableTypes.double})}
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
				let n = parseSingleValue(tokens,VariableTypes.double) || 1;
				y = {relative: true, value: e=>({value: e.valueOf(n) * neg,type: VariableTypes.double})}
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
				let n = parseSingleValue(tokens,VariableTypes.double) || 1;
				z = {relative: true, value: e=>({value: e.valueOf(n) * neg,type: VariableTypes.double})}
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
		return {relative: false,value: parseSingleValue(tokens,VariableTypes.double)}
	} else if (tokens.skip('+')) {
		return {relative: true, value: parseSingleValue(tokens,VariableTypes.double)}
	} else if (tokens.skip('-')) {
		return {relative: true, value: parseSingleValue(tokens,VariableTypes.double)}
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
	plus = '+',
	minus = '-',
	multi = '*',
	divide = '/',
	modulo = '%',
	and = '&&',
	or = '||',
	lt = '<',
	le = '<=',
	gt = '>',
	ge = '>=',
	equal = '==',
	ne = '!=',
	not = '!',
	dummy = ''
}

export interface Operator {
	token: Opcode;
	apply?: (l: any, r: any, e: Evaluator)=>any;
	valid: VariableType<any> | ((l: VariableType<any>, r: VariableType<any>)=>boolean);
	priority: number;
	unary?: (v: any,e: Evaluator)=>any;
	result: VariableType<any> | ((l: VariableType<any>, r: VariableType<any>)=>VariableType<any>);
	defaultResult?: VariableType<any>
}

export const operators: Operator[] = [
	{
		token: Opcode.plus,
		apply: (l,r,e)=>{
			return l + r;
		},
		valid: (l,r)=>equalsOneOf([l,r],[VariableTypes.integer,VariableTypes.double,VariableTypes.string]),
		priority: 2,
		unary: (v)=>{
			return v;
		},
		result: (l,r)=>equalsAll(VariableTypes.integer,l,r) ? VariableTypes.integer : equalsAny(VariableTypes.string,l,r) ? VariableTypes.string : VariableTypes.double,
		defaultResult: VariableTypes.string
	},
	{
		token: Opcode.plus,
		apply: (l,r,e)=>{
			return operateScores(l,r,e,'+','add');
		},
		valid: (l,r)=>equalsAnyOrOther([l,r],VariableTypes.score,VariableTypes.integer),
		priority: 2,
		result: VariableTypes.score
	},
	{
		token: Opcode.minus,
		apply: (l,r,e)=>{
			return l - r;
		},
		valid: (l,r)=>equalsOneOf([l,r],[VariableTypes.integer,VariableTypes.double]),
		priority: 2,
		unary: (v)=>{
			return -v;
		},
		result: (l,r)=>equalsAll(VariableTypes.integer,l,r) ? VariableTypes.integer : VariableTypes.double,
		defaultResult: VariableTypes.double
	},
	{
		token: Opcode.minus,
		apply: (l,r,e)=>{
			return operateScores(l,r,e,'-','remove');
		},
		valid: (l,r)=>equalsAnyOrOther([l,r],VariableTypes.score,VariableTypes.integer),
		priority: 2,
		result: VariableTypes.score
	},
	{
		token: Opcode.multi,
		apply: (l,r,e)=>{
			return l * r;
		},
		valid: (l,r)=>equalsOneOf([l,r],[VariableTypes.double,VariableTypes.integer]),
		priority: 1,
		result: (l,r)=>equalsAll(VariableTypes.integer,l,r) ? VariableTypes.integer : VariableTypes.double,
	},
	{
		token: Opcode.multi,
		apply: (l,r,e)=>{
			return operateScores(l,r,e,'*');
		},
		valid: (l,r)=>equalsAnyOrOther([l,r],VariableTypes.score,VariableTypes.integer),
		priority: 1,
		result: VariableTypes.score
	},
	{
		token: Opcode.divide,
		apply: (l,r,e)=>{
			return l / r;
		},
		valid: (l,r)=>equalsOneOf([l,r],[VariableTypes.double,VariableTypes.integer]),
		priority: 1,
		result: (l,r)=>equalsAll(VariableTypes.integer,l,r) ? VariableTypes.integer : VariableTypes.double,
	},
	{
		token: Opcode.divide,
		apply: (l,r,e)=>{
			return operateScores(l,r,e,'/');
		},
		valid: (l,r)=>equalsAnyOrOther([l,r],VariableTypes.score,VariableTypes.integer),
		priority: 1,
		result: VariableTypes.score
	},
	{
		token: Opcode.modulo,
		apply: (l,r)=>{
			return l % r;
		},
		valid: (l,r)=>equalsOneOf([l,r],[VariableTypes.double,VariableTypes.integer]),
		priority: 1,
		result: (l,r)=>equalsAll(VariableTypes.integer,l,r) ? VariableTypes.integer : VariableTypes.double
	},
	{
		token: Opcode.modulo,
		apply: (l,r,e)=>{
			return operateScores(l,r,e,'%');
		},
		valid: (l,r)=>equalsAnyOrOther([l,r],VariableTypes.score,VariableTypes.integer),
		priority: 1,
		result: VariableTypes.score
	},
	{
		token: Opcode.or,
		apply: (l,r)=>{
			return <Condition>{
				includesNegation: true,
				negate: false,
				eval: (e,neg)=>{
					let t = e.generateTempScore('orFlag');
					e.write(t.set(0))
					e.write('execute ' + evalCond(l,e) + ' run ' + t.set(1));
					e.write('execute ' + evalCond(r,e) + ' run ' + t.set(1));
					return negationStr(neg) + ' score ' + t.matches(1);
				}
			}
		},
		valid: VariableTypes.condition,
		priority: 4,
		result: VariableTypes.condition
	},
	{
		token: Opcode.and,
		apply: (l,r)=>{
			return <Condition>{
				eval: e=>evalCond(l,e) + ' ' + evalCond(r,e),
				includesNegation: true,
				negate: false
			}
		},
		valid: VariableTypes.condition,
		priority: 4,
		result: VariableTypes.condition
	},
	{
		token: Opcode.not,
		valid: VariableTypes.condition,
		priority: 0,
		result: VariableTypes.condition,
		unary: (v,e)=>{
			return <Condition>{
				eval: getCondEval(v), 
				negate: true,
				includesNegation: typeof v == 'function' ? false : v.includesNegation
			}
		}
	},
	{
		token: Opcode.lt,
		valid: (l,r)=>equalsAnyOrOther([l,r],VariableTypes.score,VariableTypes.integer),
		priority: 3,
		result: VariableTypes.condition,
		apply: (l,r,e)=>{
			return compareScores(l,r,'<');
		}
	},
	{
		token: Opcode.gt,
		valid: (l,r)=>equalsAnyOrOther([l,r],VariableTypes.score,VariableTypes.integer),
		priority: 3,
		result: VariableTypes.condition,
		apply: (l,r,e)=>{
			return compareScores(l,r,'>')
		}
	},
	{
		token: Opcode.le,
		valid: (l,r)=>equalsAnyOrOther([l,r],VariableTypes.score,VariableTypes.integer),
		priority: 3,
		result: VariableTypes.condition,
		apply: (l,r,e)=>{
			return compareScores(l,r,'<=')
		}
	},
	{
		token: Opcode.ge,
		valid: (l,r)=>equalsAnyOrOther([l,r],VariableTypes.score,VariableTypes.integer),
		priority: 3,
		result: VariableTypes.condition,
		apply: (l,r,e)=>{
			return compareScores(l,r,'>=')
		}
	},
	{
		token: Opcode.equal,
		valid: (l,r)=>equalsAnyOrOther([l,r],VariableTypes.score,VariableTypes.integer),
		priority: 3,
		result: VariableTypes.condition,
		apply: (l,r,e)=>{
			return compareScores(l,r,'=')
		}
	}
]

export function negationStr(neg: boolean) {
	return neg ? 'unless' : 'if'
}

function operateScores(l: Score | number, r: Score | number, e: Evaluator, operator: string, operationName?: string): Score {
	let temp = e.generateTempScore('exprTemp');
	let score: Score;
	let n: number;
	if (Score.is(l)) {
		score = l;
		if (Score.is(r)) {
			e.write('scoreboard players operation ' + temp.asString + ' = ' + Score.toString(l,e));
			e.write('scoreboard players operation ' + temp.asString + ' ' + operator + '= ' + Score.toString(r,e));
			return temp.asScore;
		} else {
			n = r;
		}
	} else if (Score.is(r)) {
		score = r;
		n = l;
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

export const dummyOperator: Operator = {
	token: Opcode.dummy,
	apply: (l,r)=>undefined,
	valid: (l,r)=>true,
	priority: 0,
	result: VariableTypes.integer
}

export function parseRangeComparison(t: TokenIterator, type: VariableType<number>): Lazy<string> {
	let op = t.expectValue(">","<",">=","<=","==","between");
	if (op == 'between') {
		t.expectValue('(');
		let min = parseSingleValue(t,type);
		t.skip(",");
		let max = parseSingleValue(t,type);
		t.expectValue(')');
		return e=>{
			return {value: e.valueOf(min) + ".." + e.valueOf(max),type: VariableTypes.string};
		}
	}
	let val = parseSingleValue(t,type);
	t.suggestHere('to');
	if (op == '==' && t.skip('to')) {
		let max = parseSingleValue(t,type);
		return e=>({value: e.valueOf(val) + ".." + e.valueOf(max),type: VariableTypes.string});
	}
	return e=>{
		let n = e.valueOf(val);
		return {value: formatRange(n,op),type: VariableTypes.string};
	}
}

export function formatRange(val: number, op: string): string {
	let str = "";
	switch(op) {
		case ">":
			str = (val + 1) + "..";
			break;
		case ">=":
			str = val + "..";
			break;
		case "<":
			str = ".." + (val - 1);
			break;
		case "<=":
			str = ".." + val;
			break;
		case '=':
		case '==':
			str = "" + val;
	}
	return str;
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
	if (t.isTypeNext(TokenType.line_end)) {
		return (s,e)=>{
			e.write('scoreboard players get ' + Score.toString(s,e));
			return {type: VariableTypes.score, value: s}
		}
	}
	let opcode = t.expectType(TokenType.operator);
	let op = scoreModifiers[opcode.value];
	if (op === undefined) {
		t.error(opcode.range,"Unknown score operator");
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
	let value = parseResultSuccessValue(t);
	return (score,e)=>{
		e.write('execute store ' + value.rs + ' score ' + Score.toString(score,e) + ' ' + value.toCommand(e));
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
	toCommand: (e: Evaluator)=>string
}

export function parseResultSuccessValue(t: TokenIterator): ResultSuccessHelper {
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
	} else {
		value = parseExpression(t);
	}
	return {rs, toCommand: (e)=>{
		if (st) {
			return e.getCommandWithRun('store',st);
		} else if (value) {
			let v = value(e);
			if (v.type == VariableTypes.score) {
				return 'run scoreboard players get ' + Score.toString(v.value,e);
			}
			else if (v.type == VariableTypes.nbtAccess) {
				return 'run data get ' + v.value.selector.type + ' ' + v.value.selector.value + ' ' + v.value.path
			} else {
				e.error(value.range,"This value cannot be used here");
			}
		}
		return 'run say EMPTY STATEMENT!';
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

export type ValueTypeObject = VariableType<any> | TokenType | ((t: TokenIterator)=>any)

export interface MethodParameter {
	key?: string
	optional?: boolean
	type: ValueTypeObject
	desc?: string
	values?: string[]
	defaultValue?: any,
	typeAnnotation?: string
}



export function parseMethod(t: TokenIterator, signature: SignatureParameter[], params: MethodParameter[], name: string, desc: string) {
	let result = {};
	let fillDefaults = false;
	for (let i = 0; i < params.length; i++) {
		let p = params[i];
		if (fillDefaults) {
			result[p.key || i] = p.defaultValue;
		} else {
			let range = t.startRange();
			let v = parseValueTypeObject(t,p.type,p.values,p.optional);
			t.endRange(range);
			t.ctx.editor.setSignatureHelp({pos: range, desc, method: name, params: signature, activeParam: i});
			if (v === undefined) return undefined;
			result[p.key || i] = v;
			if (i < params.length - 1) {
				if (!params[i+1].optional) {
					if (!t.expectValue(',')) {
						return undefined;
					}
				} else if (!t.skip(',')) {
					fillDefaults = true;
				}
			}
		}
		
	}
	if (Object.keys(result).length == 1 && params.length == 1) return result[Object.keys(result)[0]];
	return result;
}
export function parseValueTypeObject(tokens: TokenIterator, type: ValueTypeObject, values?: string[], optional?: boolean): any {
	if (typeof type == 'function') {
		return type(tokens);
	} else if (VariableType.is(type)) {
		return parseExpression(tokens,<VariableType<any>>type,!optional);
	} else {
		if (values) {
			tokens.suggestHere(...values);
		}
		if (!tokens.isTypeNext(<TokenType>type) && optional) {
			return undefined;
		}
		let v = tokens.expectType(type);
		if (values && values.indexOf(v.value) < 0) {
			tokens.error(v.range,"Expected one of " + values.join(", "));
		}
		return v.value;
	}
}

export function getSignatureFromParams(params: MethodParameter[]): SignatureParameter[] {
	return params.map(p=>{
		let typeStr = getTypeAnnotation(p.type,p.key,p.values,p.typeAnnotation);
		return {label: p.key, desc: p.desc, optional: p.optional, type: typeStr};
	});
}

export function getTypeAnnotation(type: ValueTypeObject, key: string, values: string[], customAnnotation?: string) {
	if (customAnnotation) {
		return customAnnotation;
	} else if (VariableType.is(type)) {
		return type.name;
	} else if (values) {
		return values.map(v=>"'" + v + "'").join(' | ');
	} else if (typeof type == 'function') {
		if (type.name == 'anonymous' || type.name == '') {
			return key || 'unknown';
		} else {
			return type.name || key;
		}
	} else {
		return TokenType[type];
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


export interface BaseMemberEntry<R> {
	name: string
	desc: string
	snippet?: string
	params?: MethodParameter[]
	type?: ValueTypeObject
	values?: string[]
	noEqualSign?: boolean
	resolve: (params: any)=>R
}

export abstract class MemberGroup<M extends BaseMemberEntry<R>,R> {
	initialized: boolean = false

	members: M[]

	parse(t: TokenIterator): R {
		if (!this.initialized) {
			this.members = this.init()
			this.initialized = true;
		}
		t.suggestHere(...this.members.map(m=>({value: m.name,desc: m.desc, snippet: m.snippet, type: m.params ? CompletionItemKind.Method : CompletionItemKind.Property})));
		let name = t.expectType(TokenType.identifier);
		let m = this.members.find(e=>e.name == name.value);
		if (!m) {
			t.error(name.range,"Unknown member '" + name.value + "'");
			return;
		}
		if (m.type) {
			if (!m.noEqualSign) {
				t.expectValue('=');
			}
			return m.resolve(parseValueTypeObject(t,m.type,m.values,false));
		}
		t.expectValue('(');
		let res = parseMethod(t,getSignatureFromParams(m.params),m.params,m.name,m.desc);
		t.expectValue(')');
		return m.resolve(res);
	}

	abstract init(): M[];
}

export function getRegistryEntries(type: string) {
	if (type == 'blocks') return Object.keys(blocks.values)
	return Object.keys((<NBTRegistry>nbtRegistries[type]).entries)
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