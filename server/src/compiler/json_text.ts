import { VariableTypes, VariableType, parseList, ValueTypeObject, parseValueTypeObject, getTypeAnnotation } from './util';
import { parseExpression, Lazy, Evaluator } from './parser';
import { DataStructureType, DataProperty, parseDataCompound, DataContext, setTagValue } from './data_structs';
import { TokenIterator, TokenType } from './tokenizer';
import { Color, Range } from 'vscode-languageserver';
import { Selector } from './selector';


export enum JsonTextType {
	chat,
	title,
	book,
	sign,
	other
}

export namespace JsonTextType {
	export function get(name: string): JsonTextType {
		return JsonTextType[name];
	}
}

export const colors: {[id: string]: number[]} = {
	black: [0,0,0],
	dark_blue: [0,0,0.67],
	dark_green: [0,0.67,0],
	dark_aqua: [0,0.67,0.67],
	dark_red: [0.67,0,0],
	dark_purple: [0.67,0,0.67],
	gold: [1,0.67,0],
	gray: [0.67,0.67,0.67],
	dark_gray: [0.33,0.33,0.33],
	blue: [0.33,0.33,1],
	green: [0.33,1,0.33],
	aqua: [0.33,1,1],
	red: [1,0.33,0.33],
	light_purple: [1,0.33,1],
	yellow: [1,1,0.33],
	white: [1,1,1]
};

export interface JsonProperty extends DataProperty {
	resolve?: (v: any, range: Range, e: Evaluator, data: any)=>any
	onlyIn?: JsonTextType[]
	type: ValueTypeObject
	isContent?: boolean
}

let JsonProperties: JsonProperty[];

function initJsonProps() {
	if (JsonProperties) {
		return
	}
	JsonProperties = [
		{
			key: "text",
			type: VariableTypes.string,
			desc: "Adds literal text component",
			isContent: true
		},
		{
			key: "selector",
			type: VariableTypes.selector,
			desc: "Displays the targeted entities' names. For example 'Creeper, Creeper, Skeleton and Spider'",
			resolve: (s,range,e)=>{
				return Selector.toString(s,e);
			},
			isContent: true
		},
		{
			key: "color",
			type: ValueTypeObject.token(TokenType.identifier,...Object.keys(colors)),
			resolve: (c,range,e)=>{
				let rgb = colors[c];
				e.file.editor.colors.push({color: Color.create(rgb[0],rgb[1],rgb[2],1),range: range})
				return c;
			}
		},
		{
			key: "score",
			type: VariableTypes.score,
			resolve: (score,range,e)=>{
				return {name: e.valueOf(score.entry),objective: score.objective};
			}
		},
		{
			key: "run",
			desc: "Specify a command to run when clicking on this JSON segment",
			type: ValueTypeObject.token(TokenType.string),
			resolve: (cmd)=>{
				return {action: "run_command", value: cmd};
			},
			path: ["clickEvent"],
			onlyIn: [JsonTextType.chat,JsonTextType.book,JsonTextType.sign]
		},
		{
			key: "trigger",
			desc: "A trigger objective to activate when clicking on this JSON segment",
			type: VariableTypes.objective,
			resolve: (obj)=>{
				return {action: "run_command", value: "trigger " + obj};
			},
			path: ["clickEvent"],
			onlyIn: [JsonTextType.chat,JsonTextType.book,JsonTextType.sign]
		},
		{
			key: "nbt",
			type: VariableTypes.nbtAccess,
			resolve: (access,range,e,data)=>{
				data[access.selector.type] = access.selector.value;
				return access.path;
			},
			isContent: true
		},
		{
			key: "interpret",
			noValue: true,
			type: VariableTypes.boolean
		},
		{
			key: "bold",
			noValue: true,
			type: VariableTypes.boolean
		},
		{
			key: "italic",
			noValue: true,
			type: VariableTypes.boolean
		},
		{
			key: "underlined",
			noValue: true,
			type: VariableTypes.boolean
		},
		{
			key: "strikethrough",
			noValue: true,
			type: VariableTypes.boolean
		},
		{
			key: "obfuscated",
			noValue: true,
			type: VariableTypes.boolean
		},
		{
			key: "insertion",
			type: VariableTypes.string,
			onlyIn: [JsonTextType.chat]
		}
	]
}

export class JsonContext extends DataContext<JsonProperty> {
	strict = true

	constructor(props: JsonProperty[]) {
		super();
		this.properties = props;
	}

	static of(type: JsonTextType) {
		initJsonProps();
		return new JsonContext(JsonProperties.filter(p=>!p.onlyIn || p.onlyIn.indexOf(type) >= 0));
	}
}

export const JsonData: DataStructureType<JsonProperty> = {
	toString: stringifyJson,
	varType: ()=>VariableTypes.json,
	parseProp: parseJsonProp,
	propTypeDetail: (prop)=>getTypeAnnotation(prop.type)
}

export function stringifyJson(obj: any, e: Evaluator) {
	if (typeof obj == 'object') {
		obj = evalJson(obj,e);
	}
	return JSON.stringify(obj);
}

function evalJson(json: any, e: Evaluator) {
	let newJson = {}
	for (let k of Object.keys(json)) {
		let v = e.valueOf(json[k]);
		if (typeof v == 'object') {
			newJson[k] = evalJson(v,e);
		} else {
			newJson[k] = v;
		}
	}
	return newJson;
}

export function praseJson(t: TokenIterator, ctx: JsonContext): Lazy<any> {
	if (t.isTypeNext(TokenType.identifier)) {
		return t.expectVariable();
	}
	if (t.isNext('{')) {
		return parseDataCompound(t,JsonData,ctx);
	}
	if (t.isNext('[')) {
		let arr = parseList(t,'[',']',()=>parseDataCompound(t,JsonData,ctx));
		return e=>{
			let val = arr.map(s=>e.valueOf(s));
			return {value: val, type: VariableTypes.json};
		}
	}
	return parseExpression(t,VariableTypes.string);
}

function parseJsonProp(t: TokenIterator, prop: JsonProperty, json: any) {
	if (prop.noValue !== undefined) {
		if (!t.isNext(':')) {
			if (!t.isNext(',','}')) {
				t.errorNext('Expected property value or a property separator');
			}
			applyProp(prop,json,undefined,prop.noValue);
			return
		}
	}
	t.expectValue(':');
	let range: Range = {...t.nextPos}
	if (prop.typeContext && prop.typeContext.values) {
		t.suggestHere(...prop.typeContext.values)
	}
	let res = parseValueTypeObject(t,prop.type);
	t.endRange(range);
	if (!res) {
		return
	}
	if (prop.typeContext && prop.typeContext.values) {
		let oldRes = res;
		res = e=>{
			let r = oldRes(e);
			if (r.value !== undefined) {
				if (prop.typeContext.values.indexOf(r.value) < 0) {
					e.error(range,"Unknown " + prop.key + ": '" + r.value + "'")
				}
			}
			return r;
		}
	}
	applyProp(prop,json,range,res);
}

function applyProp(prop: JsonProperty, data: any, range: Range, value: any) {
	if (prop.resolve) {
		let old = value;
		if (Lazy.is(old)) {
			value = <Lazy<any>>(e=>{
				let r = old(e);
				if (r === undefined || r.value === undefined) return r;
				return {value: prop.resolve(r.value,range,e,data),type: r.type};
			})
		} else {
			value = prop.resolve(old,range,undefined,data);
		}
	}
	setTagValue(prop,data,value);
}