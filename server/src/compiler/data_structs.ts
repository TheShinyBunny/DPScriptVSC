import { TokenIterator, TokenType } from './tokenizer';
import { Lazy, parseExpression, Evaluator } from './parser';
import { CompletionItemKind } from 'vscode-languageserver';
import { NBT_LIKE_VARS, VariableType, VariableTypes } from './util';
import { isArray } from 'util';
import { HoverInfo } from './compiler';
import { SemanticType, SemanticModifier } from '../server';
import { Parsers, ValueParser, ValueParserUtil } from './parsers/parsers';
import { postProcess } from './parsers/post_processors';
import { Registry } from './registries';
import { parseNBTValue } from './nbt';

export abstract class DataContext<P extends DataProperty> {
	strict: boolean
	resolvePath: string

	parseUnknownProp(t: TokenIterator, key: string, data: any) {
		return parseNBTValue(t);
	}

	abstract getProperty(key: string): P;

	abstract getKnownProperties(): CompoundItem<P>;

	abstract varType(): VariableType<any>;
}

export class KeyValueContext extends DataContext<DataProperty> {

	compound: CompoundItem<DataProperty>
	
	constructor(keyRegistry: string, private valueProp: DataProperty) {
		super();
		this.compound = {};
		if (keyRegistry) {
			let keys = Registry.getKeys(keyRegistry) || [];
			for (let k of keys) {
				this.compound[k] = this.valueProp;
			}
		}
	}

	getProperty(key: string): DataProperty {
		return this.valueProp;
	}
	getKnownProperties(): CompoundItem<DataProperty> {
		return this.compound;
	}
	varType(): VariableType<any> {
		return VariableTypes.nbt;
	}
	
}

export interface DataProperty {
	desc?: string
	type: string
	context?: any
	modifications?: any
	path?: any[]
	noValue?: any
	writeonly?: boolean
	post_processor?: string | {id: string}
	deprecated?: boolean | {since?: string, reason: string}
	only_when?: string[]
}

function buildPropType(type: string, ctx: any) {
	let p: ValueParser<any> = Parsers[type];
	if (p) {
		return p.getLabel(ctx);
	}
	return "unknown";
}

export function validateDataProperty(p: DataProperty, key: string, containerName: string) {
	let errors: string[] = []
	ValueParserUtil.validateParser(p.type,p.context,(msg)=>{
		errors.push(msg);
		return false;
	});
	let errors2: string[] = []
	ValueParserUtil.validatePostProcessor(p.post_processor,(msg)=>{
		errors2.push(msg);
		return false;
	})
	if (errors.length > 0 || errors2.length > 0) {
		console.log(`(!) Invalid data property ${containerName}/${key}:`);
		if (errors.length > 0) {
			console.log("\tIn parser type:")
			errors.forEach(e=>console.log('\t\t' + e))
		}
		if (errors2.length > 0) {
			console.log("\tIn post processor:")
			errors2.forEach(e=>console.log('\t\t' + e))
		}
	}
	
}

export interface CompoundItem<P extends DataProperty> {
	[key: string]: P
}


export abstract class BaseCompoundRegistry<T,P extends DataProperty> extends Registry<T> {
	validate() {
		console.log('===== Validating registry: ' + this.name + ' =====')
		let comps = this.getCompounds();
		for (let ck of Object.keys(comps)) {
			let c = comps[ck];
			for (let k of Object.keys(c)) {
				validateDataProperty(c[k],k,this.name + ':' + ck)
			}
		}
	}

	abstract getCompounds(): {[k: string]: CompoundItem<P>}
}


export type LazyCompoundEntry<T> = (e: Evaluator, compound: any)=>T


export function parseDataCompound<P extends DataProperty>(t: TokenIterator, ctx: DataContext<P>): Lazy<any> {
	if (!t.skip('{')) {
		return;
	}
	t.ctx.editor.addSemantic(t.lastPos,SemanticType.number);
	let data: {[k: string]: any} = {};
	let futureData: ((e: Evaluator, comp: any)=>void)[] = []
	let range = t.startRange();
	while (t.hasNext()) {
		t.suggestHere(...Object.keys(ctx.getKnownProperties()).map(k=>{
			let p = ctx.getProperty(k);
			return {value : k, desc: p.desc, detail: buildPropType(p.type,p.context || {}), type: CompletionItemKind.Field}
		}));
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
			return e=>({value: {},type: ctx.varType()});
		}
		if (tok.type !== TokenType.identifier && tok.type !== TokenType.string) {
			t.error(tok.range,"Property must be an identifier or a string!");
			break;
		} else {
			let prop = ctx.getProperty(tok.value);
			if (prop) {
				t.ctx.editor.addSemantic(tok.range,SemanticType.property,prop.writeonly ? SemanticModifier.static : undefined);
				t.ctx.editor.setHover(tok.range,getDataPropHover(tok.value,prop))
				let v = parseProperty(t,tok.value,prop,ctx);
				if (v) {
					futureData.push(v);
				}
			} else if (!ctx.strict) {
				t.ctx.editor.addSemantic(tok.range,SemanticType.property);
				if (t.expectValue(':')) {
					let v = ctx.parseUnknownProp(t,tok.value,data);
					if (v === undefined) break
					data[tok.value] = v;
				} else {
					break
				}
			} else {
				t.error(tok.range,"Unknown property '" + tok.value + "'");
			}
			
		}
		if (!t.skip(',')) {
			if (t.isNext('}')) break
		}
	}
	t.expectValue('}');
	t.ctx.editor.addSemantic(t.lastPos,SemanticType.number);
	t.endRange(range);
	return e=>{
		for (let d of futureData) {
			d(e,data);
		}
		return {value: deepEvalCompound(data,e), type: ctx.varType()}
	};
}

function tryDeepEval(obj: any, e: Evaluator) {
	if (Lazy.is(obj)) {
		console.log('obj is ',obj)
		let r = obj(e);
		if (r === undefined) return;
		if (r.type == VariableTypes.json || r.type == VariableTypes.nbt) {
			return deepEvalCompound(r.value,e);
		} else {
			return tryDeepEval(r.value === undefined ? r : r.value,e);
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
	if (isArray(data)) return tryDeepEval(data,e);
	let val = {}
	console.log('evaluating compound of',data)
	for (let k of Object.keys(data)) {
		let v = data[k];
		val[k] = tryDeepEval(v,e);
	}
	return val;
}


export function getDataPropHover<P extends DataProperty>(key: string, prop: P): HoverInfo {
	return {syntax: key + ': ' + buildPropType(prop.type,prop.context || {}), desc: prop.desc}
}


export function parseProperty<P extends DataProperty>(t: TokenIterator, key: string, prop: P, ctx: DataContext<P>): (e: Evaluator, compound: any)=>void {
	let type = prop.type;
	if (type == 'bool') {
		if (!t.isNext(':')) {
			return (e,c)=>{
				setValueInCompound(true,key,prop,c,e);
			}
		}
	}
	if (!t.expectValue(':')) return e=>{}
	let parser: ValueParser<any> = Parsers[type];
	if (parser) {
		let res = parser.parse(t,prop.context || {},key);
		let v: LazyCompoundEntry<any>
		if (typeof res != 'function') {
			v = e=>{
				return res;
			}
		} else {
			v = res;
		}
		return (e,c)=>{
			setTagValue(key,prop,c,v,parser,e,ctx);
		}
	}
	console.log('UNKNOWN TYPE PARSER ' + type)
}


export function setTagValue(key: string, tag: DataProperty,data: any, value: LazyCompoundEntry<any>, parser: ValueParser<any>, e: Evaluator, ctx: DataContext<any>) {
	let newValue = value(e,data);
	if (newValue === undefined) {
		console.log('undefined returned from',parser.id,'of tag',key)
		return;
	}
	if (newValue.type && newValue.value) {
		newValue = newValue.value;
	}
	console.log('val pre tocompound',newValue)
	let v = parser.toCompoundData(newValue,tag.context || {},e);
	console.log('val post tocompound',v)
	if (tag.modifications) {
		additionalModifications(tag.modifications,data);
	}
	setValueInCompound(v,key,tag,data,e,parser);
}

export function setValueInCompound(value: any, key: string, tag: DataProperty, data: any, e: Evaluator, parser?: ValueParser<any>) {
	let finalContainer = data;
	if (tag.path) {
		let node = findNode(data,tag.path);
		key = node.index;
		finalContainer = node.container;
	}
	if (tag.post_processor) {
		let r = postProcess(value,finalContainer,key,e,tag.post_processor);
		if (r === undefined) return
		value = r;
	}
	if (parser && parser.customValueSetter) {
		let r = parser.customValueSetter(value,finalContainer,tag.context || {});
		if (r) return
	}
	console.log('setting ' + key + ' to',value);
	finalContainer[key] = value;
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

