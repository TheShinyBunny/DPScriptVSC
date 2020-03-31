import { Selector, SelectorTarget, parseSelector } from './selector';
import { Lazy, Statement, parseExpression } from "./parser";
import { TokenIterator, TokenType } from "./tokenizer";
import { parseBossbarField } from './bossbar';



export interface Score {
	entry: Lazy<String>;
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


export interface VariableType<T> {
	name: string;
	usageParser?: (tokens: TokenIterator, value: any, name: string)=>Statement;
	literalParser?: (tokens: TokenIterator)=>any;
	expressionParser?: (tokens: TokenIterator)=>Lazy<T>;
	defaultValue: T;
	tokens?: TokenType[];
	nativeType?: {new(value: any):any};
}

export const VariableTypes = {
	score: <VariableType<Score>>{
		name: "score",
		defaultValue: Score.constant("")
	},
	string: <VariableType<string>>{
		name: "string",
		defaultValue: "",
		tokens: [TokenType.string],
		nativeType: String
	},
	integer: <VariableType<number>>{
		name: "int",
		defaultValue: 0,
		tokens: [TokenType.int],
		nativeType: Number
	},
	double: <VariableType<number>>{
		name: "double",
		defaultValue: 0.0,
		tokens: [TokenType.double,TokenType.int],
		nativeType: Number
	},
	boolean: <VariableType<boolean>>{
		name: "boolean",
		defaultValue: false,
		literalParser: (tokens)=>{
			if (tokens.isNext("true","false")) return Boolean(tokens.next().value);
		},
		nativeType: Boolean
	},
	objective: <VariableType<string>>{
		name: "objective",
		defaultValue: ""
	},
	json: <VariableType<any>>{
		name: "json",
		defaultValue: {}
	},
	selector: <VariableType<Selector>>{
		name: "selector",
		defaultValue: {target: "@e", params: []},
		literalParser: (t)=>parseSelector(t)
	},
	bossbar: <VariableType<string>>{
		name: "bossbar",
		defaultValue: "unknown",
		usageParser: (t,v,name)=>parseBossbarField(t,name)
	}
}

export namespace VariableType {
	export function canCast(target: VariableType<any>, to: VariableType<any> | undefined) {
		return !target || !to || target == to;
	}
	export function all(): VariableType<any>[] {
		return Object.keys(VariableTypes).map(k=>VariableTypes[k]);
	}
	export function castValue<T>(value: any, type: VariableType<T>): T {
		if (type.nativeType) {
			return new type.nativeType(value);
		}
		return value;
	}
	export function is(obj: any): obj is VariableType<any> {
		return 'name' in obj;
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

export function parseDuration(t: TokenIterator, ticks: boolean = false): Lazy<number> {
	let nodes: {n: Lazy<number>, factor: number}[] = [];
	let num = parseExpression(t,VariableTypes.integer);
	while (t.hasNext()) {
		t.suggestHere('s','t','ms','m','h','d');
		if (t.isTypeNext(TokenType.identifier)) {
			let unit = t.next();
			switch(unit.value) {
				case 's':
				case 'secs':
				case 'seconds':
					nodes.push({n: num, factor: 1})
					break;
				case 't':
				case 'ticks':
					nodes.push({n: num, factor: 0.05})
					break;
				case 'ms':
				case 'millis':
				case 'milliseconds':
					nodes.push({n: num, factor: 0.001})
					break;
				case 'm':
				case 'mins':
				case 'minutes':
					nodes.push({n: num, factor: 60});
					break;
				case 'h':
				case 'hours':
					nodes.push({n: num, factor: 3600});
					break;
				case 'd':
				case 'days':
					nodes.push({n: num, factor: 86400});
					break;
				default:
					t.error(unit.range,'Invalid duration unit');
			}
			t.skip(',','and');
			num = parseExpression(t,VariableTypes.integer);
			if (!num) {
				break;
			}
		} else {
			break;
		}
	}
	return e=>{
		let result = 0;
		for (let n of nodes){
			let a = e.valueOf(n.n);
			result += a * n.factor;
		}
		if (ticks) {
			result /= 20;
		}
		result = Math.round(result);
		return {value: result, type: VariableTypes.integer};
	}
}

