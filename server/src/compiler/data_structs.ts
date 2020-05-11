import { TokenIterator, TokenType } from './tokenizer';
import { Lazy, parseExpression, Evaluator } from './parser';
import { CompletionItemKind } from 'vscode-languageserver';
import { VariableType } from './util';
import { isArray } from 'util';
import { HoverInfo } from './compiler';

export interface DataContext<P extends DataProperty> {
	strict: boolean
	properties: P[]
}

export interface DataStructureType<P extends DataProperty> {
	toString: (d: any, e: Evaluator)=>string
	varType: ()=>VariableType<any>
	parseProp: (t: TokenIterator, prop: P, data: any, ctx: DataContext<P>)=>void
	propTypeDetail: (prop: P)=>string
}

export interface DataProperty {
	key: string
	aliases?: string[]
	desc?: string
	dontUseKeyAsAlias?: boolean
	type: any
	typeContext?: any
	modifications?: any
	path?: string[],
	noValue?: any,
	writeonly?: boolean
}

export function parseDataCompound<P extends DataProperty>(t: TokenIterator, type: DataStructureType<P>, ctx: DataContext<P>): Lazy<any> {
	if (!t.expectValue('{')) return undefined;
	let data: {[k: string]: Lazy<any>} = {};
	let range = t.startRange();
	while (t.hasNext()) {
		let props = ctx.properties;
		t.suggestHere(...props.map(i=>({value: i.dontUseKeyAsAlias ? i.aliases[0] : i.key, desc: i.desc, detail: type.propTypeDetail(i), type: CompletionItemKind.Field})));
		if (t.isNext('}')) {
			break;
		}
		let tok = t.expectType(TokenType.identifier);
		if (tok.value === '') {
			t.error(tok.range,"Expected property");
			break;
		} else {
			let prop: P = findProp(props,tok.value);
			if (prop) {
				t.ctx.editor.setHover(tok.range,getDataPropHover(prop,type))
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
		}
		if (!t.skip(',')) {
			if (t.isNext('}')) break
		}
	}
	t.expectValue('}')
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

export function getDataPropHover<P extends DataProperty>(prop: P, dataType: DataStructureType<P>): HoverInfo {
	return {syntax: (prop.dontUseKeyAsAlias ? prop.aliases[0] : prop.key) + ': ' + dataType.propTypeDetail(prop), desc: prop.desc}
}


export function setValueInPath(tag: DataProperty,data: any,value: any) {
	if (tag.modifications) {
		additionalModifications(tag.modifications,data);
	}
	if (tag.path) {
		let c = data;
		for (let i = 0; i < tag.path.length - 1; i++) {
			let n = tag.path[i];
			if (n.startsWith('[')) {
				let num = Number(n.substring(1,n.length-1));
				if (!isArray(c)) {
					c = [];
				}
				c = c[num];
			} else {
				if (c[n] === undefined) {
					c[n] = {};
				}
				c = c[n];
			}
		}
		let lastNode = tag.path[tag.path.length-1];
		if (lastNode.startsWith('[')) {
			c[Number(lastNode.substring(1,lastNode.length-1))] = value;
		} else {
			c[tag.path[tag.path.length-1]] = value;
		}
	} else {
		data[tag.key] = value;
	}
}

export function getValueInPath(data: any, path: string[]) {
	let c = data;
	for (let i = 0; i < path.length; i++) {
		let n = path[i];
		if (c === undefined) return;
		if (n.startsWith('[')) {
			let num = Number(n.substring(1,n.length-1));
			c = c[num];
		} else {
			c = c[n];
		}
	}
	return c;
}

function additionalModifications(mod: any, data: any) {
	for (let k of Object.keys(mod)) {
		let v = mod[k];
		modify(k,v,data);
	}
}

function modify(k: any, value: any, data: any) {
	if (isArray(value)) {
		if (data[k] === undefined) {
			data[k] = new Array(value.length);
		}
		for (let i = 0; i < value.length; i++) {
			if (data[k][i] === undefined) {
				modify(i,value[i],data[k]);
			}
		}
	} else if (typeof value == 'object') {
		if (data[k] === undefined) {
			data[k] = {}
		}
		additionalModifications(value,data[k]);
	} else {
		data[k] = value;
	}
}

