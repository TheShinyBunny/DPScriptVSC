import { TokenIterator, TokenType } from './tokenizer';
import { Lazy, parseExpression, Evaluator } from './parser';
import { CompletionItemKind, Range } from 'vscode-languageserver';
import { VariableType, VariableTypes } from './util';
import { isArray } from 'util';

export interface DataContext<P extends DataProperty> {
	strict: boolean
	properties: P[]
}

export interface DataStructureType<P extends DataProperty> {
	toString: (d: any, e: Evaluator)=>string
	varType: ()=>VariableType<any>
	parseProp: (t: TokenIterator, prop: P, data: any, ctx: DataContext<P>)=>void
}

export interface DataProperty {
	key: string
	aliases?: string[]
	desc?: string
	dontUseKeyAsAlias?: boolean
	type: any
	typeContext?: any
	modifications?: any
	fake?: boolean
	path?: string[],
	noValue?: any
}

export function parseDataCompound<P extends DataProperty>(t: TokenIterator, type: DataStructureType<P>, ctx: DataContext<P>): Lazy<any> {
	if (!t.expectValue('{')) return undefined;
	let data: {[k: string]: Lazy<any>} = {};
	let range = t.startRange();
	let props = ctx.properties;
	while (t.hasNext()) {
		t.suggestHere(...props.map(i=>({value: i.key, desc: i.desc, type: CompletionItemKind.Field})));
		if (t.skip('}')) {
			break;
		}
		let tok = t.expectType(TokenType.identifier);
		let prop = findProp(props,tok.value);
		if (prop) {
			type.parseProp(t,prop,data,ctx);
		} else if (!ctx.strict) {
			t.expectValue(':');
			let v = parseExpression(t);
			data[tok.value] = v;
		} else if (tok.value !== '}' && tok.type !== TokenType.line_end) {
			t.error(tok.range,"Unknown property '" + tok.value + "'");
		} else {
			t.error(tok.range,"Expected property");
			return e=>({value: {},type: type.varType()});
		}
		if (!t.skip(',')) {
			t.expectValue('}');
			break
		}
	}
	t.endRange(range);
	return Lazy.ranged(e=>{
		let val = {};
		for (let k of Object.keys(data)) {
			let v = data[k];
			val[k] = e.valueOf(v);
		}
		return {value: val, type: type.varType()};
	},range);
}

export function findProp<P extends DataProperty>(props: P[], label: string) {
	for (let p of props) {
		if ((!p.dontUseKeyAsAlias && p.key === label) || (p.aliases && p.aliases.indexOf(label) > -1)) return p;
	}
}


export function setValueInPath(tag: DataProperty,data: any,value: any) {
	if (tag.modifications) {
		additionalModifications(tag.modifications,data);
	}
	if (tag.path) {
		console.log(data);
		console.log('setting in path ' + JSON.stringify(tag.path))
		let c = data;
		for (let i = 0; i < tag.path.length - 1; i++) {
			let n = tag.path[i];
			if (n.startsWith('[')) {
				let num = Number(n.substring(1,n.length-1));
				if (!isArray(c)) {
					c = [];
				}
				while (c.length < num) {
					c.push({});
				}
				c = c[num];
			} else {
				console.log('accessing prop ' + n);
				console.log(c);
				if (c[n] === undefined) {
					console.log('creating it first');
					c[n] = {};
				}
				c = c[n];
			}
		}
		console.log('setting final value');
		c[tag.path[tag.path.length-1]] = value;
	} else {
		data[tag.key] = value;
	}
}

function additionalModifications(mod: any, data: any) {
	for (let k of Object.keys(mod)) {
		let v = mod[k];
		if (typeof v == 'object') {
			if (!data[k]) {
				data[k] = {}
			}
			additionalModifications(v,data[k]);
		} else {
			data[k] = v;
		}
	}
}