
import { Selector, parseSelector, parseSelectorCommand } from './selector';
import { praseJson, JsonContext, JsonTextType } from './json_text';
import { Lazy, Statement, parseExpression, Evaluator, parseSingleValue, Condition, evalCond, getCondEval, toStringScoreComparison, parseCondition, parseConditionNode } from "./parser";
import { TokenIterator, TokenType, Tokens, Token } from "./tokenizer";
import { parseBossbarField } from './bossbar';
import { parseEffect, Effect, TieredEffect, parseTieredEffect, TieredEnchantment, parseEnchantment } from './entities';
import { parseNBT, toStringNBT, createNBTContext, nbtRegistries, parseFutureNBT, NBTAccess } from './nbt';

import * as blocks from './registries/blocks.json'
import { parseObjectInstanceAccess } from './oop';
import { Range } from 'vscode-languageserver';
import { SignatureParameter, PathNode, PathToken } from './compiler';

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

export interface VariableType<T> {
	name: string;
	isNative: boolean;
	usageParser?: (tokens: TokenIterator, value: Lazy<T>, name: string)=>Statement;
	literalParser?: (tokens: TokenIterator)=>T | undefined;
	expressionParser?: (tokens: TokenIterator, types?: {[id: string]: VariableType<any>})=>Lazy<T>;
	defaultValue: T;
	stringify: (v: T, e: Evaluator)=>string;
	tokens?: TokenType[];
	fromString?: (str: string)=>T;
	castFrom?: (type: VariableType<any>,value: any, e: Evaluator)=>any
	isClass?: boolean,
	[f: string]: any
}

export const VariableTypes = {
	any: <VariableType<any>>{
		name: "any",
		defaultValue: "any",
		isNative: false,
		stringify: (a,e)=>""
	},
	objective: <VariableType<string>>{
		name: "Objective",
		defaultValue: "",
		isNative: false
	},
	string: <VariableType<string>>{
		name: "string",
		defaultValue: "",
		stringify: (s)=>s,
		tokens: [TokenType.string],
		fromString: s=>s,
		isNative: true
	},
	score: <VariableType<Score>>{
		name: "Score",
		defaultValue: {entry: undefined, objective: "Consts"},
		isNative: true,
		expressionParser: (t,types)=>{
			if (t.isTypeNext(TokenType.identifier) && !t.isNext('self')) {
				let type = t.ctx.getVariableType(t.peek().value);
				console.log('var type: '+ (type ? type.name : 'unknown'));
				if (type == types.objective) {
					t.errorNext('Objectives cannot be used without a target entity. You might want to use a global score instead.')
				} else if (type == types.score) {
					return t.expectVariable(types.score);
				}
			}
			if (!t.isNext('@','self')) return;
			let selector = parseSelector(t);
			if (t.skip('.')) {
				t.suggestHere(...t.ctx.getAllVariables().filter(v=>v.type === types.objective).map(v=>v.name));
				let vname = t.expectType(TokenType.identifier);
				if (t.ctx.getVariableType(vname.value) !== VariableTypes.objective) {
					t.error(vname.range,"Unknown objective " + vname.value);
				}
				return Lazy.literal({entry: Selector.asLazyString(selector),objective: vname.value},types.score);
			}
		},
		castFrom: (type,value,e)=>{
			if (type == VariableTypes.integer) {
				console.log('converting int to score')
				return Score.constant('#' + value);
			}
		},
		stringify: (score,e)=>Score.toString(score,e)
	},
	integer: <VariableType<number>>{
		name: "int",
		defaultValue: 0,
		tokens: [TokenType.int],
		fromString: (str)=>Number(str),
		stringify: (n)=>n.toString(),
		isNative: true
	},
	double: <VariableType<number>>{
		name: "double",
		defaultValue: 0.0,
		tokens: [TokenType.double,TokenType.int],
		fromString: (str)=>Number(str),
		stringify: (n)=>n.toString(),
		isNative: true
	},
	boolean: <VariableType<boolean>>{
		name: "boolean",
		defaultValue: false,
		literalParser: (tokens)=>{
			if (tokens.isNext("true","false")) return Boolean(tokens.next().value);
		},
		fromString: (str)=>Boolean(str),
		stringify: (b)=>'' + b,
		isNative: true
	},
	json: <VariableType<any>>{
		name: "json",
		defaultValue: {},
		expressionParser: (t)=>praseJson(t,new JsonContext(JsonTextType.other)),
		stringify: (json)=>JSON.stringify(json),
		isNative: false
	},
	nbt: <VariableType<any>>{
		name: "nbt",
		defaultValue: {},
		expressionParser: (t)=>parseNBT(t),
		stringify: (nbt,e)=>toStringNBT(nbt,e),
		isNative: false
	},
	selector: <VariableType<Selector>>{
		name: "Selector",
		defaultValue: {target: "@e", params: [], type: ''},
		expressionParser: (t,types)=>{
			return Lazy.literal(parseSelector(t),types.selector);
		},
		usageParser: (t,sel)=>{
			let cmd = parseSelectorCommand(t,false);
			return (e)=>{
				let s = e.valueOf(sel);
				return cmd(s,e);
			}
		},
		stringify: (s,e)=>{
			return Selector.toString(s,e);
		},
		isNative: false
	},
	bossbar: <VariableType<string>>{
		name: "Bossbar",
		defaultValue: "unknown",
		usageParser: (t,v,name)=>parseBossbarField(t,name),
		isNative: false
	},
	tieredEffect: <VariableType<TieredEffect>>{
		name:"TieredEffect",
		defaultValue: {id:"unknown_effect"},
		expressionParser: parseTieredEffect,
		isNative: false
	},
	effect: <VariableType<Effect>>{
		name: "Effect",
		defaultValue: {id: {id: "unknown_effect"}},
		expressionParser: parseEffect,
		isNative: false
	},
	duration: <VariableType<number>>{
		name:"Duration",
		defaultValue: 0,
		expressionParser: (t)=>parseDuration(t),
		isNative: false
	},
	item: <VariableType<Item>>{
		name:"Item",
		defaultValue: {id: "air"},
		expressionParser: (t)=>parseItem(t,false),
		stringify: (i,e)=>(i.tagged ? '#' : '') + i.id + (i.nbt ? toStringNBT(i.nbt,e) : ''),
		isNative: false,
		taggable: <VariableType<Item>> {
			name: "TaggableItem",
			defaultValue: {id: "air"},
			expressionParser: (t)=>parseItem(t,true),
			isNative: false,
			stringify: (i,e)=>'stringify taggable item'
		}
	},
	block: <VariableType<Block>>{
		name: "Block",
		defaultValue: {id: "name_tag"},
		expressionParser: (t)=>parseBlock(t,true,false),
		stringify: (b,e)=>b.stringify(e),
		isNative: false
	},
	location: <VariableType<Location>>{
		name: "Location",
		defaultValue: {x: undefined, y: undefined, z: undefined,rotated: false},
		isNative: false,
		stringify: (loc,e)=>toStringPos(loc,e),
		literalParser: (t)=>parseLocation(t)
	},
	condition: <VariableType<Condition>>{
		name: "Condition",
		literalParser: parseConditionNode,
		defaultValue: {eval: e=>''},
		isNative: true,
		stringify: evalCond
	},
	specialNumber: <VariableType<SpecialNumber>>{
		defaultValue: {num: 0, suffix: ''},
		isNative: true,
		name: "number",
		stringify: (n)=>n.num + n.suffix
	},
	nbtAccess: <VariableType<NBTAccess>>{
		defaultValue: {path: '', selector: 'entity @s'},
		isNative: false,
		name: "NBTAccess",
		stringify: (a,e)=>''
	},
	enchantment: <VariableType<TieredEnchantment>>{
		defaultValue: {id: "protection"},
		isNative: false,
		name: "Enchantment",
		stringify: (te,e)=>te.id + ' ' + te.lvl,
		expressionParser: (t)=>parseEnchantment(t,true)
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
			isNative: false,
			defaultValue: undefined,
			isClass: true,
			usageParser: (t,v)=>{
				return parseObjectInstanceAccess(t,v);
			}
		}
	}

	export function nonNatives() {
		return all().filter(t=>!t.isNative);
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

	export function toString(score: Score, e: Evaluator): string {
		return !score ? "" : e.stringify(score.entry) + ' ' + score.objective;
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
		return (!range.from || range.from <= n) && (!range.to || range.to >= n); 
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
		if (Tokens.is(id)) {
			nbt = parseNBT(t,createNBTContext(nbtRegistries.items,id.value));
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
		// todo: validate #tags
		return {value: {id: realId,nbt: e.valueOf(nbt), tagged},type: VariableTypes.item}
	}
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
		let readNBT = false;
		if (t.isTypeNext(TokenType.line_end)) {
			readNBT = false;
		}
		t.pos = pos;
		if (readNBT) {
			if (id.literal) {
				let block = blocks.values[id.literal];
				nbt = parseNBT(t,createNBTContext(nbtRegistries.tileEntities,block ? block.tile_entity : undefined));
			} else {
				nbt = parseFutureNBT(t,Lazy.remap(id.value,(b,e)=>{
					let block = blocks.values[b];
					let te = block ? block.tile_entity : undefined;
					return {value: createNBTContext(nbtRegistries.tileEntities,te),type: undefined};
				}));
			}
		}
	}
	return e=>{
		let realId = e.valueOf(id.value);
		if (blocks.values[realId] === undefined) {
			e.error(id.range,"Unknown block ID " + realId);
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

export function parseList<T>(tokens: TokenIterator, open: string, close: string, valueParser: (index: number)=>T, itemCount?: NumberRange): T[] {
	let arr: T[] = [];
	if (!tokens.expectValue(open)) return [];
	let i = 0;
	let outOfRange: Range;
	while (tokens.hasNext() && !tokens.isNext(close)) {
		let inRange = Ranges.inRange(itemCount,i)
		if (!inRange) {
			if (!outOfRange) {
				outOfRange = tokens.startRange();
			}
		}
		let v = valueParser(i);
		
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

export interface Coordinate {
	relative: boolean
	value: Lazy<number>
}

export function parseLocation(tokens: TokenIterator): Location {
	let x: Coordinate, y: Coordinate, z: Coordinate;
	let first = true;
	if (!tokens.skip('[')) return;
	let rotated = tokens.skip('^');
	let definedProps: string[] = [];
	while (tokens.hasNext()) {
		if (rotated) {
			tokens.suggestHere(...['here','up','down','left','right','forward','backward'].filter(a=>definedProps.indexOf(a) < 0))
		} else {
			tokens.suggestHere(...['here','x','y','z','north','south','east','west','up','down'].filter(a=>definedProps.indexOf(a) < 0))
		}
		if (tokens.skip(']')) break;
		let token = tokens.next();
		let found = true;
		switch (token.value) {
			case 'here':
				if (!first) {
					tokens.warn(token.range,"'here' can only be used by itself in a location")
				}
				x = y = z = {relative: true, value: Lazy.literal(0,VariableTypes.double)}
				tokens.expectValue(']');
				return {rotated,x,y,z}
			case 'x': {
				x = parseLiteralCoordinate(x,token,tokens,rotated);
				break
			}
			case 'y': {
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
				tokens.error(token.range,'Unknown location property');
				found = false;
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
	if (!x) {
		x = {relative: true,value: Lazy.literal(0,VariableTypes.double)}
	}
	if (!y) {
		y = {relative: true,value: Lazy.literal(0,VariableTypes.double)}
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
	let res = [];
	for (let c of [pos.x,pos.y,pos.z]) {
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


export interface Operator {
	token: string;
	apply?: (l: any, r: any, e: Evaluator)=>any;
	valid: VariableType<any> | ((l: VariableType<any>, r: VariableType<any>)=>boolean);
	priority: number;
	unary?: (v: any,e: Evaluator)=>any;
	result: VariableType<any> | ((l: VariableType<any>, r: VariableType<any>)=>VariableType<any>);
	defaultResult?: VariableType<any>
}

export const operators: Operator[] = [
	{
		token: "+",
		apply: (l,r,e)=>{
			if (typeof l == 'number' && typeof r == 'number') {
				return l + r;
			}
			if (typeof r == 'string' || typeof l == 'string') {
				return l + r;
			}
			return operateScores(l,r,e,'+','add');
		},
		valid: (l,r)=>equalsOneOf([l,r],[VariableTypes.integer,VariableTypes.double,VariableTypes.string]) || equalsOneOf([l,r],[VariableTypes.integer,VariableTypes.score]),
		priority: 2,
		unary: (v)=>{
			if (typeof v == 'number') {
				return -v;
			}
			return v;
		},
		result: (l,r)=>equalsAll(VariableTypes.integer,l,r) ? VariableTypes.integer : equalsAny(VariableTypes.string,l,r) ? VariableTypes.string : equalsAny(VariableTypes.score,l,r) ? VariableTypes.score : VariableTypes.double,
		defaultResult: VariableTypes.string
	},
	{
		token: "-",
		apply: (l,r,e)=>{
			if (typeof l == 'number' && typeof r == 'number') {
				return l + r;
			}
			return operateScores(l,r,e,'-','remove');
		},
		valid: (l,r)=>equalsOneOf([l,r],[VariableTypes.double,VariableTypes.integer]) || equalsOneOf([l,r],[VariableTypes.integer,VariableTypes.score]),
		priority: 2,
		unary: (v,e)=>{
			if (typeof v == 'number') {
				return -v;
			}
			e.write('scoreboard players operation ' + Score.toString(v,e) + ' *= ' + Score.toString(e.createConst(-1),e));
			return v;
		},
		result: (l,r)=>l == VariableTypes.double || r == VariableTypes.double ? VariableTypes.double : VariableTypes.integer
	},
	{
		token: '*',
		apply: (l,r,e)=>{
			if (typeof l == 'number' && typeof r == 'number') {
				return l * r;
			}
			return operateScores(l,r,e,'*');
		},
		valid: (l,r)=>equalsOneOf([l,r],[VariableTypes.double,VariableTypes.integer]) || equalsOneOf([l,r],[VariableTypes.integer,VariableTypes.score]),
		priority: 1,
		result: (l,r)=>l == VariableTypes.double || r == VariableTypes.double ? VariableTypes.double : l == VariableTypes.score || r == VariableTypes.score ? VariableTypes.score : VariableTypes.integer
	},
	{
		token: '/',
		apply: (l,r,e)=>{
			if (typeof l == 'number' && typeof r == 'number') {
				return l / r;
			}
			return operateScores(l,r,e,'/');
		},
		valid: (l,r)=>equalsOneOf([l,r],[VariableTypes.double,VariableTypes.integer]) || equalsOneOf([l,r],[VariableTypes.integer,VariableTypes.score]),
		priority: 1,
		result: (l,r)=>l == VariableTypes.double || r == VariableTypes.double ? VariableTypes.double : l == VariableTypes.score || r == VariableTypes.score ? VariableTypes.score : VariableTypes.integer
	},
	{
		token: '%',
		apply: (l,r,e)=>{
			if (typeof l == 'number' && typeof r == 'number') {
				return l % r;
			}
			return operateScores(l,r,e,'%');
		},
		valid: (l,r)=>equalsOneOf([l,r],[VariableTypes.double,VariableTypes.integer]) || equalsOneOf([l,r],[VariableTypes.integer,VariableTypes.score]),
		priority: 1,
		result: (l,r)=>l == VariableTypes.double || r == VariableTypes.double ? VariableTypes.double : l == VariableTypes.score || r == VariableTypes.score ? VariableTypes.score : VariableTypes.integer
	},
	{
		token: "||",
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
		token: "&&",
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
		token: "!",
		valid: VariableTypes.condition,
		priority: 4,
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
		token: '<',
		valid: (l,r)=>equalsOneOf([l,r],[VariableTypes.integer,VariableTypes.score]),
		priority: 3,
		result: VariableTypes.condition,
		apply: (l,r,e)=>{
			return compareScores(l,r,e,'<');
		}
	},
	{
		token: '>',
		valid: (l,r)=>equalsOneOf([l,r],[VariableTypes.integer,VariableTypes.score]),
		priority: 3,
		result: VariableTypes.condition,
		apply: (l,r,e)=>{
			return compareScores(l,r,e,'>')
		}
	},
	{
		token: '<=',
		valid: (l,r)=>equalsOneOf([l,r],[VariableTypes.integer,VariableTypes.score]),
		priority: 3,
		result: VariableTypes.condition,
		apply: (l,r,e)=>{
			return compareScores(l,r,e,'<=')
		}
	},
	{
		token: '>=',
		valid: (l,r)=>equalsOneOf([l,r],[VariableTypes.integer,VariableTypes.score]),
		priority: 3,
		result: VariableTypes.condition,
		apply: (l,r,e)=>{
			return compareScores(l,r,e,'>=')
		}
	},
	{
		token: '==',
		valid: (l,r)=>equalsOneOf([l,r],[VariableTypes.integer,VariableTypes.score]),
		priority: 3,
		result: VariableTypes.condition,
		apply: (l,r,e)=>{
			return compareScores(l,r,e,'=')
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

function compareScores(left: Score | number, right: Score | number, e: Evaluator, op: string): Condition {
	return e=>'score ' + toStringScoreComparison(left,right,e,op);
}

export const dummyOperator: Operator = {
	token: "",
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
	let value: Lazy<Score>;
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
	}
	return (score,e)=>{
		let source: Score;
		if (st) {
			let r = e.getCommand('store',st,true);
			if (typeof r == 'string') {
				if (opcode.value == '=') {
					e.write('execute store result score ' + Score.toString(score,e) + ' run ' + r);
					return {value: score, type: VariableTypes.score};
				} else {
					let gen = e.generateTempScore('storeTemp');
					e.write('execute store result score ' + gen.asString + ' run ' + r);
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
		return {type: VariableTypes.score, value: score}
	}
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
	defaultValue?: any
}



export function parseMethod(t: TokenIterator, signature: SignatureParameter[], params: MethodParameter[], name?: string, desc?: string) {
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
export function parseValueTypeObject(tokens: TokenIterator, type: ValueTypeObject, values?: string[], optional?: boolean): Lazy<any> {
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
		return Lazy.literal(tokens.expectType(<TokenType>type).value,VariableTypes.string);
	}
}

export function getSignatureFromParams(params: MethodParameter[]): SignatureParameter[] {
	return params.map(p=>{
		let typeStr = 'unknown';
		if (VariableType.is(p.type)) {
			typeStr = p.type.name;
		} else if (p.values) {
			typeStr = p.values.map(v=>"'" + v + "'").join(' | ');
		} else if (typeof p.type == 'function') {
			if (p.type.name == 'anonymous' || p.type.name == '') {
				typeStr = p.key || 'unknown';
			} else {
				typeStr = p.key || p.type.name
			}
		} else {
			typeStr = TokenType[p.type];
		}
		return {label: p.key, desc: p.desc, optional: p.optional, type: typeStr};
	});
}


export function parsePathToken(t: TokenIterator, delim: TokenType | string): PathToken {
	let nodes: PathNode[] = [];
	let all = false;
	let range = t.startRange();
	let extension: string = undefined;
	while (t.hasNext()) {
		if (t.isNext('*')) {
			all = true;
			break;
		} else if (t.isTypeNext(TokenType.identifier,TokenType.string)) {
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
		} else {
			break;
		}
	}
	t.endRange(range);
	if (typeof delim == 'string' ? !t.isNext(delim) : !t.isTypeNext(delim)) {
		t.errorNext('Unexpected path node');
	}
	return {nodes, all, fullRange: range, extension}
}