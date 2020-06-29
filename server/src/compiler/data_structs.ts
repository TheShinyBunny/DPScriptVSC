import { TokenIterator, TokenType } from './tokenizer';
import { Lazy, parseExpression, Evaluator } from './parser';
import { CompletionItemKind } from 'vscode-languageserver';
import { VariableType, VariableTypes } from './util';
import { isArray } from 'util';
import { HoverInfo } from './compiler';

export abstract class DataContext<P extends DataProperty> {
	strict: boolean
	properties: P[]

	parseUnknownProp(t: TokenIterator, key: string, data: any): Lazy<any> {
		return parseExpression(t,[VariableTypes.string,VariableTypes.integer,VariableTypes.double,VariableTypes.boolean,this.varType()]);
	}

	abstract varType(): VariableType<any>;
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
	path?: any[],
	noValue?: any,
	writeonly?: boolean
}

export function parseDataCompound<P extends DataProperty>(t: TokenIterator, type: DataStructureType<P>, ctx?: DataContext<P>): Lazy<any> {
	if (!t.expectValue('{')) return undefined;
	let data: {[k: string]: Lazy<any>} = {};
	let range = t.startRange();
	while (t.hasNext()) {
		let props: P[];
		if (ctx) {
			props = ctx.properties;
			t.suggestHere(...props.map(i=>({value: i.dontUseKeyAsAlias ? i.aliases[0] : i.key, desc: i.desc, detail: type.propTypeDetail(i), type: CompletionItemKind.Field})));
		} else {
			props = []
		}
		if (t.isTypeNext(TokenType.line_end)) {
			t.nextLine(false)
			continue
		}
		if (t.isNext('}')) {
			break;
		}
		let tok = t.next();
		if (tok.type == TokenType.line_end) {
			t.error(tok.range,"Expected property");
			return e=>({value: {},type: type.varType()});
		}
		if (tok.type !== TokenType.identifier && tok.type !== TokenType.string) {
			t.error(tok.range,"Property must be an identifier or a string!");
			break;
		} else {
			let prop: P = findProp(props,tok.value);
			if (prop) {
				t.ctx.editor.setHover(tok.range,getDataPropHover(prop,type))
				type.parseProp(t,prop,data,ctx);
			} else if (!ctx) {
				t.expectValue(':');
				let v = parseExpression(t,[VariableTypes.string,VariableTypes.integer,VariableTypes.double,VariableTypes.boolean,type.varType()]);
				data[tok.value] = v;
			} else if (!ctx.strict) {
				t.expectValue(':');
				let v = ctx.parseUnknownProp(t,tok.value,data);
				data[tok.value] = v;
			} else {
				t.error(tok.range,"Unknown property '" + tok.value + "'");
			}
		}
		if (!t.skip(',')) {
			if (t.isNext('}')) break
		}
	}
	t.expectValue('}')
	t.endRange(range);
	return Lazy.ranged(e=>{
		let val = deepEvalCompound(data,e);
		return {value: val, type: type.varType()};
	},range);
}

function tryDeepEval(obj: any, e: Evaluator) {
	if (Lazy.is(obj)) {
		let r = obj(e);
		if (r.type == VariableTypes.json || r.type == VariableTypes.nbt) {
			return deepEvalCompound(r.value,e);
		} else {
			return tryDeepEval(r.value,e);
		}
	} else if (typeof obj == 'object') {
		if (isArray(obj)) {
			let newArr = [];
			for (let i of obj) {
				newArr.push(tryDeepEval(i,e));
			}
			return newArr;
		} else {
			return deepEvalCompound(obj,e);
		}
	}
	return obj;
}

function deepEvalCompound(data: any, e: Evaluator) {
	let val = {}
	for (let k of Object.keys(data)) {
		let v = data[k];
		val[k] = tryDeepEval(v,e);
	}
	return val;
}

export function findProp<P extends DataProperty>(props: P[], label: string) {
	for (let p of props) {
		if ((!p.dontUseKeyAsAlias && p.key === label) || (p.aliases && p.aliases.indexOf(label) > -1)) return p;
	}
}

export function getDataPropHover<P extends DataProperty>(prop: P, dataType: DataStructureType<P>): HoverInfo {
	return {syntax: (prop.dontUseKeyAsAlias ? prop.aliases[0] : prop.key) + ': ' + dataType.propTypeDetail(prop), desc: prop.desc}
}


export function setTagValue(tag: DataProperty,data: any,value: any) {
	if (tag.modifications) {
		additionalModifications(tag.modifications,data);
	}
	if (tag.path) {
		let node = findNode(data,tag.path);
		if (node.container === undefined) {
			if (node.array) {
				node.container = []
			} else {
				node.container = {}
			}
		}
		console.log('setting value in node',node,'=',value)
		node.container[node.index] = value
		console.log('data after set',data);
	} else {
		data[tag.key] = value;
	}
}

interface ResultNode {
	container: any
	index: any
	array: boolean
}

function findNode(current: any, path: any[]): ResultNode {
	if (path.length == 1) return {container: current, index: path[0], array: isArray(path[0])};
	let node = path[0];
	if (isArray(node)) {
		let index = node[0];
		if (!isArray(current)) {
			current = []
		}
		if (typeof index == 'number') {
			if (index < current.length) {
				return findNode(current[index],path.slice(1))
			}
		} else if (typeof index == 'object') {
			let obj = Object.assign({},index);
			current.push(obj);
			return findNode(obj,path.slice(1));
		}
	} else if (typeof node == 'string') {
		console.log('accessing node ' + node + ' in',current);
		let newNode = current[node]
		if (newNode === undefined) {
			newNode = current[node] = {};
		}
		return findNode(newNode,path.slice(1));
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

