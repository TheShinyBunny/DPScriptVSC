import { DataStructureType, DataProperty, parseDataCompound } from './data_structs';
import { VariableTypes, simpleVariableParser } from './util';
import { parseExpression, Lazy, parseList } from './parser';
import { TokenIterator, TokenType } from './tokenizer';



export enum TextContext {
	chat,
	title,
	book,
	other
}

export const colors: {[id: string]: number[]} = {
	black: [0,0,0],
	dark_blue: [0,0,170],
	dark_green: [0,170,0],
	dark_aqua: [0,170,170],
	dark_red: [170,0,0],
	dark_purple: [170,0,170],
	gold: [255,170,0],
	gray: [170,170,170],
	dark_gray: [85,85,85],
	blue: [85,85,255],
	green: [85,255,85],
	aqua: [85,255,255],
	red: [255,85,85],
	light_purple: [255,85,255],
	yellow: [255,255,85],
	white: [255,255,255]
};


export const JsonProperties: DataProperty<TextContext>[] = [
	{
		key: "text",
		parser: simpleVariableParser(VariableTypes.string),
		desc: "Adds literal text component"
	},
	{
		key: "selector",
		parser: simpleVariableParser(VariableTypes.selector),
		desc: "Displays the targeted entities names. For example Creeper, Creeper, Skeleton and Spider"
	},
	{
		key: "color",
		parser: t=>{
			let range = {...t.nextPos};
			t.suggestHere(...Object.keys(colors))
			let val = parseExpression(t,VariableTypes.string);
			range.end = t.nextPos.end;
			if (!val) return undefined;
			return e=>{
				let v = val(e);
				if (!v) return undefined;
				if (v.value) {
					if (!colors[v.value]) {
						e.error(range,"Unknown color " + v.value);
					}
				}
				return v;
			}
		}
	},
	{
		key: "clickEvent",
		aliases: ["run"],
		desc: "Specify a command to run when clicking on this JSON segment",
		parser: t=>{
			let cmd = t.expectType(TokenType.string);
			return e=>({value: {action: "run_command", value: cmd},type: VariableTypes.json});
		}
	},
	{
		key: "clickEvent",
		aliases: ["trigger"],
		desc: "A trigger objective to activate when clicking on this JSON segment",
		parser: t=>{
			let v = t.expectVariable(VariableTypes.objective);
			return e=>{
				let value = e.valueOf(v);
				return {value: {action: "run_command", value: "trigger " + value},type: VariableTypes.json}
			}
		}
	}
]

export const JsonText: DataStructureType<TextContext> = {
	toString: (j,e)=>{
		let json = {};
		for (let k of Object.keys(j)) {
			json[k] = e.valueOf(j[k]);
		}
		return JSON.stringify(json);
	},
	properties: JsonProperties,
	varType: VariableTypes.json
}

export function praseJsonText(t: TokenIterator, ctx: TextContext): Lazy<any> {
	if (t.isTypeNext(TokenType.identifier)) {
		return t.expectVariable(VariableTypes.json);
	}
	if (t.isNext('{')) {
		return parseDataCompound(t,JsonText,ctx);
	}
	if (t.isNext('[')) {
		let arr = parseList(t,'[',']',()=>parseDataCompound(t,JsonText,ctx));
		return e=>{
			let val = arr.map(s=>e.valueOf(s));
			return {value: val, type: VariableTypes.json};
		}
	}
	let str = parseExpression(t,VariableTypes.string);
	if (str) {
		return e=>({value: '"' + e.valueOf(str) + '"', type: VariableTypes.json});
	}
}