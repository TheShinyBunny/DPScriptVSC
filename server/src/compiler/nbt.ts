
import { VariableTypes, parseIdentifierOrVariable, parseItem, parseBlock, parseBlockState, parseList, escapeString } from './util';
import { TokenIterator, Tokens, Token, TokenType } from './tokenizer';
import { DataStructureType, parseDataCompound, DataProperty, DataContext, findProp, setValueInPath } from './data_structs';
import { Lazy, Evaluator, parseExpression, parseSingleValue } from './parser';
import { CompletionItemKind } from 'vscode-languageserver';

import * as entities from './registries/entities.json';
import * as items from './registries/items.json';
import * as tileEntities from './registries/tile_entities.json';
import { entityEffects } from './entities';
import * as blocks from './registries/blocks.json';
import { JsonContext, JsonTextType, praseJson, stringifyJson, colors } from './json_text';
import { isArray } from 'util';

export const nbtRegistries = {
	entities: <NBTRegistry>{},
	items: <NBTRegistry>{},
	tileEntities: <NBTRegistry>{}
}

export function initRegistries() {
	nbtRegistries.entities = resolveRegistry('entity',entities);
	nbtRegistries.items = resolveRegistry('item',items);
	nbtRegistries.tileEntities = resolveRegistry('tile_entity',tileEntities);
}

function resolveRegistry(name: string, reg: NBTRegistryBuilder): NBTRegistry {
	let entries = {}
	for (let v of Object.keys(reg.values)) {
		entries[v] = gatherTags(name,reg,reg.values[v],v,true);
	}
	return {entries: entries, base: reg.base, strict: reg.strict, name}
}

export interface RegistryEntry {
	tags?: DataProperty[]
	mixins?: string[]
	extends?: string
	abstract?: boolean
	props?: {[id: string]: string[]}
}

export interface NBTRegistry {
	base: DataProperty[]
	entries: {[id: string]: DataProperty[]}
	strict: boolean
	name: string
}

export interface NBTRegistryBuilder {
	strict: boolean
	base: DataProperty[]
	values: {[id: string]: RegistryEntry}
	mixins: {[id: string]: RegistryEntry}
}

export const NBT: DataStructureType<DataProperty> = {
	varType: ()=>VariableTypes.nbt,
	toString: toStringNBT,
	parseProp: parseNBTTag
}

function gatherTags(regName: string, reg: NBTRegistryBuilder, entry: RegistryEntry, key: string, includeBase: boolean): DataProperty[] {
	let props: DataProperty[] = []
	if (entry.extends) {
		let ext = reg.values[entry.extends];
		if (ext) {
			props.push(...gatherTags(regName,reg,reg.values[entry.extends],entry.extends,includeBase));
		} else {
			console.log("UNKNOWN EXTENDS: " + entry.extends + " for " + regName + ':' + key);
		}
	} else if (includeBase) {
		props.push(...reg.base)
	}
	if (entry.mixins) {
		for (let m of entry.mixins) {
			let mixin = reg.mixins[m];
			if (mixin) {
				props.push(...gatherTags(regName,reg,mixin,m,false));
			} else {
				console.log("UNKNOWN MIXIN: " + m + " for " + regName + ':' + key)
			}
		}
	}
	if (entry.tags) {
		props.push(...entry.tags);
	}
	return props;
}

export class NBTContext implements DataContext<DataProperty> {
	constructor(private props: DataProperty[], public reg?: NBTRegistry, public entry?: string) {
	}
	strict = this.reg ? this.reg.strict : true
	properties = this.props
	typeContext: any = {}
	write?: boolean
}

export function createNBTContext(reg: NBTRegistry, entry?: string, write?: boolean) {
	let e = entry ? reg.entries[entry] : undefined;
	let ctx = new NBTContext(e || reg.base,reg,entry);
	ctx.write = write;
	return ctx;
}

export function parseNBT(t: TokenIterator, ctx?: NBTContext) {
	console.log("parsing NBT with context: " + JSON.stringify(ctx.properties))
	return parseDataCompound(t,NBT,ctx);
}

export function parseFutureNBT(t: TokenIterator, futureCtx: Lazy<NBTContext>): Lazy<any> {
	let start = t.expectValue('{');
	if (!start) return;
	let tokens: Token[] = [t.lastToken];
	let stack = 1;
	while (t.hasNext() && stack > 0) {
		if (t.isNext('{')) {
			stack++;
		} else if (t.isNext('}')) {
			stack--;
		}
		tokens.push(t.next());
	}
	let ctx = t.ctx.snapshot();
	return e=>{
		let ti = new TokenIterator(tokens,ctx);
		let nbt = parseNBT(ti,e.valueOf(futureCtx));
		return {value: e.valueOf(nbt), type: VariableTypes.nbt};
	}
}

export function toStringNBT(obj: any,ev: Evaluator) {
	let entries = Object.keys(obj).map(k=>({key: k, value: obj[k]}));
	return '{' + entries.map(e=>{
		return e.key + ':' + toStringValue(e.value,ev)
	}) + '}';
}

function toStringValue(value: any, e: Evaluator) {
	if (typeof value == 'number') return value.toString();
	if (typeof value == 'string') return '"' + escapeString(value,/[\\"]/g) + '"';
	if (typeof value == 'bigint') return value + 'L';
	if (typeof value == 'boolean') return value + '';
	if (isArray(value)) return '[' + value.map(i=>toStringValue(i,e)).join(',') + ']'
	if (typeof value == 'object') return toStringNBT(value,e);
	if (typeof value == 'undefined') return 'null';
	if (Lazy.is(value)) return toStringValue(e.valueOf(value),e)
	return value;
}

function parseNBTTag(t: TokenIterator, tag: DataProperty, nbt: any, ctx: NBTContext) {
	if (tag.noValue && t.isNext(',','}',']')) {
		setTag(tag,nbt,undefined);
		return
	}
	t.expectValue(':');
	let val = parseType(t,tag.key,tag.type,tag.typeContext,ctx);
	if (val) {
		setTag(tag,nbt,val);
	}
}


function parseType(t: TokenIterator, key: string, type: string, typeCtx: any, ctx: NBTContext): Lazy<any> {
	//let types = ["int","double","short","bool","string","effect","enchantment","item","blockstate","block_id","list","indexed_identifier","nbt","json","color_id","effect_id","tile_entity","byte"]
	switch (type) {
		case 'int':
			return parseExpression(t,VariableTypes.integer);
		case 'double':
			return parseExpression(t,VariableTypes.double);
		case 'short':
			let range = {...t.nextPos};
			let i = parseExpression(t,VariableTypes.integer);
			t.endRange(range);
			return e=>{
				let r = e.valueOf(i);
				if (r > 32767) {
					e.warn(range,"Value exceeds max short value");
				}
				return {value: r, type: VariableTypes.integer};
			}
			
		case 'bool':
			if (t.isNext(':')) {
				return parseExpression(t,VariableTypes.boolean);
			}
			return Lazy.literal(true,VariableTypes.boolean);
		case 'inverted_bool':
			if (t.isNext(':')) {
				let l = parseExpression(t,VariableTypes.boolean);
				return Lazy.map(l,b=>!b);
			}
			return Lazy.literal(false,VariableTypes.boolean);
		case 'string':
			return parseExpression(t,VariableTypes.string);
		case 'effect':
			return Lazy.remap(parseExpression(t,VariableTypes.effect),v=>({value: {Id: entityEffects.indexOf(v.id.id),Amplifier: v.id.tier,Duration: v.duration || 600,ShowParticles: !v.hide},type: VariableTypes.nbt}));
		case 'enchantment':
			return; // todo: implement
		case 'item':
			return Lazy.remap(parseItem(t),i=>({value: {id: i.id, Count: i.count, tag: i.nbt},type: VariableTypes.nbt}));
		case 'blockstate':
			return Lazy.literal(parseBlockState(t,ctx.entry),VariableTypes.nbt);
		case 'block_id':
			t.suggestHere(...Object.keys(blocks.values))
			let id = parseIdentifierOrVariable(t,VariableTypes.string);
			let idRange = t.lastPos;
			let lazyId = Tokens.lazify(id);
			return Lazy.map(lazyId,(b,e)=>{
				if (blocks.values[b] === undefined) {
					e.error(idRange,"Unknown block ID " + b);
				}
				return b;
			})
		case 'list':
			let list = parseList(t,'[',']',()=>{
				if (typeCtx.item) {
					return parseType(t,key + '[]',typeCtx.item,typeCtx.itemContext,ctx);
				}
				console.log("NO LIST CONTEXT, parsing any expression");
				return parseExpression(t);
			});
			return e=>{
				let l = list.map(v=>e.valueOf(v));
				return {value: l,type: VariableTypes.nbt};
			}
		case 'indexed_identifier':
			if (!typeCtx.values) {
				console.log("no values for indexed identifier in " + ctx.entry);
				return undefined;
			} else {
				t.suggestHere(...Object.keys(typeCtx.values).map(k=>typeCtx.values[k]));
			}
			let v = parseIdentifierOrVariable(t,VariableTypes.string);
			let lazyV = Tokens.lazify(v);
			let r = t.lastPos;
			return e=>{
				let val = e.valueOf(lazyV);
				let index;
				for (let x of Object.keys(typeCtx.values)) {
					if (typeCtx.values[x] == val || x == val) {
						index = x;
					}
				}
				if (!index) {
					e.error(r,"Unknown " + key + ' value')
				}
				if (typeCtx.numeralIndex) {
					return {value: Number(index),type: VariableTypes.integer};
				}
				return {value: index, type: VariableTypes.string};
			}
		case 'nbt':
			let newCtx: NBTContext;
			if (typeCtx.tags) {
				newCtx = new NBTContext(typeCtx.tags);
			} else if (typeCtx.registry) {
				let reg = nbtRegistries[typeCtx.registry];
				if (!reg) {
					console.log("Unknown registry " + typeCtx.registry + " for tag " + key);
				}
				newCtx = createNBTContext(reg,typeCtx.entry);
			}
			return Lazy.literal(parseNBT(t,newCtx),VariableTypes.nbt);
		case 'json':
			let type = typeCtx.json_text;
			let jsonCtx: JsonContext = undefined;
			if (type) {
				jsonCtx = new JsonContext(JsonTextType.get(type));
			}
			let json = praseJson(t,jsonCtx);
			return e=>{
				return {value: stringifyJson(e.valueOf(json),e),type: VariableTypes.string}
			}
		case 'color_id':
			let colorId: Lazy<number>;
			if (t.isNext('$') || t.isTypeNext(TokenType.identifier)) {
				let color = parseIdentifierOrVariable(t,VariableTypes.string);
				let lazyColor = Tokens.lazify(color);
				colorId = e=>{
					let v = e.valueOf(lazyColor);
					let id = getIdOfColor(v);
					return {value: id,type: VariableTypes.integer};
				}
			} else {
				colorId = parseSingleValue(t,VariableTypes.integer);
			}
			return colorId;
		case 'effect_id':
			t.suggestHere(...entityEffects)
			if (t.isNext('(') || t.isTypeNext(TokenType.int)) {
				return parseSingleValue(t,VariableTypes.integer);
			}
			let effectId = parseIdentifierOrVariable(t,VariableTypes.string);
			let er = t.lastPos;
			if (!effectId) return
			return Lazy.remap(Tokens.lazify(effectId),(id,e)=>{
				if (entityEffects.indexOf(id) < 0) {
					e.error(er,"Unknown effect ID")
				}
				return {value: entityEffects.indexOf(id)+1,type: VariableTypes.integer};
			});
		case 'tile_entity':
			let block = blocks.values[ctx.entry];
			return parseNBT(t,createNBTContext(nbtRegistries.tileEntities,block ? block.tile_entity : undefined))
		case 'byte':
			let brange = {...t.nextPos};
			let b = parseExpression(t,VariableTypes.integer);
			t.endRange(range);
			return e=>{
				let r = e.valueOf(b);
				if (r > 32767) {
					e.warn(brange,"Value exceeds max byte value");
				}
				return {value: r, type: VariableTypes.integer};
			}
		case 'uuid':
			// todo: implement
		default:
			console.log('Unknown NBT tag type: "' + type + '"');
	}
}

function setTag(tag: DataProperty, nbt: any, value: any) {
	if (!value && tag.noValue) {
		value = tag.noValue;
	}
	if (value) {
		setValueInPath(tag,nbt,value);
	}
}

export function parseNBTPath(t: TokenIterator, startWithDot: boolean, ctx?: NBTContext): Lazy<string> {
	if (startWithDot && !t.skip('.')) {
		return undefined;
	}
	if (t.isNext('{')) {
		let nbt = parseNBT(t,ctx);
		let node: Lazy<string> = e=>({value: e.stringify(nbt),type: VariableTypes.string});
		if (t.skip('.')) {
			return combinePaths(node,parsePathNode(t,ctx));
		}
		return node;
	} else {
		return parsePathNode(t,ctx);
	}
}

export const dyeColors = [
	{"id":"white","rgb":[0.9764706,1.0,0.99607843]},
	{"id":"orange","rgb":[0.9764706,0.5019608,0.11372549]},
	{"id":"magenta","rgb":[0.78039217,0.30588236,0.7411765]},
	{"id":"light_blue","rgb":[0.22745098,0.7019608,0.85490197]},
	{"id":"yellow","rgb":[0.99607843,0.84705883,0.23921569]},
	{"id":"lime","rgb":[0.5019608,0.78039217,0.12156863]},
	{"id":"pink","rgb":[0.9529412,0.54509807,0.6666667]},
	{"id":"gray","rgb":[0.2784314,0.30980393,0.32156864]},
	{"id":"light_gray","rgb":[0.6156863,0.6156863,0.5921569]},
	{"id":"cyan","rgb":[0.08627451,0.6117647,0.6117647]},
	{"id":"purple","rgb":[0.5372549,0.19607843,0.72156864]},
	{"id":"blue","rgb":[0.23529412,0.26666668,0.6666667]},
	{"id":"brown","rgb":[0.5137255,0.32941177,0.19607843]},
	{"id":"green","rgb":[0.36862746,0.4862745,0.08627451]},
	{"id":"red","rgb":[0.6901961,0.18039216,0.14901961]},
	{"id":"black","rgb":[0.11372549,0.11372549,0.12941177]}
]

export function getColorById(id: number) {
	return dyeColors[id];
}

export function getIdOfColor(colorId: string) {
	return dyeColors.findIndex(c=>c.id == colorId);
}

export function parsePathNode(t: TokenIterator, ctx?: NBTContext) {
	if (ctx) {
		t.suggestHere(...ctx.properties.map(p=>({value: p.key,detail: p.type, desc: p.desc, kind: CompletionItemKind.Property})))
	}
	let range = {...t.nextPos};
	let n = parseIdentifierOrVariable(t,VariableTypes.string);
	t.endRange(range);
	let literal = undefined;
	let node: Lazy<string>;
	if (Tokens.is(n)) {
		literal = n.value;
		node = e=>({value: (<Token>(n)).value,type: VariableTypes.string});
	} else {
		node = n;
	}
	if (ctx && ctx.strict) {
		let old = node;
		node = e=>{
			let v = e.valueOf(old);
			if (!findProp(ctx.properties,v)) {
				e.error(range,"Unknown NBT property");
			}
			return {value: v, type: VariableTypes.string}
		}
	}
	let newCtx = ctx && literal ? getNewContext(ctx,literal) : undefined;
	return chainPath(node,t,newCtx);
}

function getNewContext(ctx: NBTContext, path: string): NBTContext {
	let tag = findProp(ctx.properties,path);
	if (tag) {
		if (tag.type == 'nbt') {
			if (tag.typeContext.tags) {
				return new NBTContext(tag.typeContext.tags,tag.typeContext.strict || ctx.strict);
			}
		} else {
			return new NBTContext([],tag.typeContext.strict || ctx.strict,tag.typeContext);
		}
	}
}

function getNewArrayContext(ctx: NBTContext) {
	if (ctx.typeContext && ctx.typeContext.item == 'nbt') {
		if (ctx.typeContext.itemContext.tags) {
			return new NBTContext(ctx.typeContext.itemContext.tags,ctx.typeContext.itemContext.strict || ctx.strict);
		}
	}
}

function chainPath(prev: Lazy<string>, t: TokenIterator, ctx?: NBTContext): Lazy<string> {
	if (ctx.typeContext.item) {
		t.suggestHere('[');
	}
	if (t.skip('[')) {
		if (t.skip(']')) {
			return chainPath(e=>{
				return {value: e.valueOf(prev) + '[]',type: VariableTypes.string}
			},t,getNewArrayContext(ctx));
		}
		if (t.isNext('{')) {
			let nbt = parseNBT(t,getNewArrayContext(ctx));
			t.expectValue(']');
			return e=>{
				return {value: e.valueOf(prev) + '[' + e.stringify(nbt) + ']',type: VariableTypes.string};
			}
		}
		let n = parseExpression(t,VariableTypes.integer);
		t.expectValue(']');
		return chainPath(e=>{
			return {value: e.valueOf(prev) + '[' + e.valueOf(n) + ']',type: VariableTypes.string}
		},t,getNewArrayContext(ctx));
	} else {
		if (ctx.typeContext.item) {
			t.errorNext('This node can only be accessed as an array')
		}
		if (t.isNext('{')) {
			let nbt = parseNBT(t,ctx);
			return e=>{
				return {value: e.valueOf(prev) + e.stringify(nbt),type: VariableTypes.string}
			}
		}
		if (t.skip('.')) {
			return combinePaths(prev,parsePathNode(t,ctx));
		}
		return prev;
	}
}

function combinePaths(path1: Lazy<string>,path2: Lazy<string>): Lazy<string> {
	return e=>{
		return {value: e.valueOf(path1) + '.' + e.valueOf(path2),type: VariableTypes.string}
	}
}