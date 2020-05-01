import { VariableTypes } from './util';
import { TokenIterator, TokenType } from './tokenizer';
import { Evaluator, parseExpression, Statement } from './parser';
import { praseJson, JsonContext, JsonTextType } from './json_text';
import { CompletionItemKind } from 'vscode-languageserver';


export interface BossbarField {
	desc: string
	gettable?: boolean
	noEqualSign?: boolean
	parser?: (t: TokenIterator)=>(e: Evaluator)=>string
}

export const bossbarFields: {[id: string]: BossbarField} = {
	color: {
		desc: "The text color of the title (if no color was specified in the title text), and the bar color",
		parser: t=>{
			let color = t.expectValue('blue','green','pink','purple','red','white','yellow');
			return e=>'color ' + color;
		}
	},
	max: {
		desc: "Specifies the maximum value of this bossbar (defaults to 100)",
		gettable: true,
		parser: t=>{
			let value = parseExpression(t,VariableTypes.integer);
			if (!value) return undefined;
			return e=>'max ' + e.valueOf(value,0)
		}
	},
	name: {
		desc: "The display name of this bossbar. Shown above the progress bar at the top of the screen.",
		parser: t=>{
			let text = praseJson(t,new JsonContext(JsonTextType.title));
			return e=>'name ' + JSON.stringify(e.valueOf(text))
		}
	},
	players: {
		desc: "The player/s who can see this bossbar",
		gettable: true,
		parser: t=>{
			let selector = parseExpression(t,VariableTypes.selector);
			if (!selector) return undefined;
			return e=>'players ' + e.stringify(selector);
		}
	},
	style: {
		desc: "Specifies the style of the progress bar. Possible values are: progress, notched_6, notched_10, notched_12 and notched_20",
		parser: t=>{
			let style = t.expectValue('progress','notched_6','notched_10','notched_12','notched_20');
			return e=>'style ' + style;
		}
	},
	value: {
		desc: "Specifies the current value of the bossbar. This controls how much of the progress is filled up out of the max value.",
		gettable: true,
		parser: t=>{
			let v = parseExpression(t,VariableTypes.integer);
			return e=>'value ' + e.valueOf(v,0).toString();
		}
	},
	show: {
		desc: "Displays the bossbar to the target players",
		noEqualSign: true,
		parser: t=>{
			t.expectValue('(');
			t.expectValue(')');
			return e=>'visible true'
		}
	},
	hide: {
		desc: "Hides the bossbar",
		noEqualSign: true,
		parser: t=>{
			t.expectValue('(');
			t.expectValue(')');
			return e=>'visible false'
		}
	}
}


export function parseBossbarField(tokens: TokenIterator, name: string): Statement {
	console.log('parsing bossbar field');
	if (!tokens.expectValue('.')) return undefined;
	tokens.suggestHere(...Object.keys(bossbarFields).map(k=>({value: k, type: CompletionItemKind.Property, desc: bossbarFields[k].desc})));
	let fname = tokens.expectType(TokenType.identifier);
	let field = bossbarFields[fname.value];
	if (!field) {
		tokens.error(fname.range,"Unknown bossbar field");
		return e=>{};
	}
	if (!field.noEqualSign) {
		if (!tokens.expectValue('=')) {
			if (field.gettable) {
				return e=>{
					let cmd = "bossbar get " + name + " " + fname.value;
					return {value: cmd, type: VariableTypes.string};
				}
			} else {
				tokens.error(fname.range,"This field is write-only")
			}
		}
	}
	let res = field.parser(tokens);
	return e=>{
		let str = res(e);
		e.write("bossbar set " + name + " " + str);
	}
}