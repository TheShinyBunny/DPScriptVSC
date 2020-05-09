
import { VariableTypes, parseIdentifierOrVariable, parseItem, parseBlock, parseBlockState, parseList, escapeString, parseEnumValue, parseIndexedIdentifier, parseLocation, toStringPos, SpecialNumber, Variable } from './util';
import { TokenIterator, Tokens, Token, TokenType } from './tokenizer';
import { DataStructureType, parseDataCompound, DataProperty, DataContext, findProp, setValueInPath, getDataPropHover } from './data_structs';
import { Lazy, Evaluator, parseExpression, parseSingleValue } from './parser';
import { CompletionItemKind, Color } from 'vscode-languageserver';
import { Selector, parseSelector } from './selector';

import * as entities from './registries/entities.json';
import * as items from './registries/items.json';
import * as tileEntities from './registries/tile_entities.json';
import { entityEffects, parseEnchantment } from './entities';
import * as blocks from './registries/blocks.json';
import { JsonContext, JsonTextType, praseJson, stringifyJson } from './json_text';
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
	for (let k of Object.keys(reg.values)) {
		let v = reg.values[k];
		if (!v.abstract) {
			entries[k] = gatherTags(name,reg,v,k,true,false);
		}
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
	parseProp: parseNBTTag,
	propTypeDetail: (prop)=>{
		return buildPropType(prop.type,prop.typeContext,prop.dontUseKeyAsAlias ? prop.aliases[0] : prop.key);
	}
}

function buildPropType(type: string, ctx: any, name?: string) {
	let res: string = type;
	if (res == 'list') {
		res += '<' + buildPropType(ctx.item,ctx.itemContext) + '>';
	} else if (res == 'nbt') {
		let reg = false;
		if (ctx.registry) {
			res = ctx.registry;
			reg = true;
		}
		if (ctx.tags) {
			let s = '{' + ctx.tags.map(t=>{
				let n = t.dontUseKeyAsAlias ? t.aliases[0] : t.key;
				return n + ': ' + buildPropType(t.type,t.typeContext,n);
			}).join(', ') + '}';
			if (reg) {
				res += s;
			} else {
				res = s;
			}
		}
	} else if (res == 'indexed_identifier') {
		res = name || 'id';
	} else if (res == 'inverted_bool') {
		res = 'bool';
	}
	return res;
}

function gatherTags(regName: string, reg: NBTRegistryBuilder, entry: RegistryEntry, key: string, includeBase: boolean, isMixin: boolean): DataProperty[] {
	let props: DataProperty[] = []
	if (entry.extends) {
		let vals = isMixin ? reg.mixins : reg.values;
		let ext = vals[entry.extends];
		if (ext) {
			props.push(...gatherTags(regName,reg,vals[entry.extends],entry.extends,includeBase,isMixin));
			includeBase = false;
		} else {
			console.log("UNKNOWN EXTENDS: " + entry.extends + " for " + regName + ':' + key);
			includeBase = true;
		}
	}
	if (includeBase && !isMixin) {
		props.push(...reg.base)
	}
	if (entry.mixins) {
		for (let m of entry.mixins) {
			let mixin = reg.mixins[m];
			if (mixin) {
				props.push(...gatherTags(regName,reg,mixin,m,false,true));
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

	strict = this.entry ? this.reg.strict : false
	resolveEntryFrom?: string;
	futureEval?: Evaluator;
	properties: DataProperty[] = []

	constructor(props: DataProperty[], public reg?: NBTRegistry, public entry?: string, public write?: boolean) {
		this.properties = props;
	}

	asTypeContext() {
		return {
			registry: this.reg ? this.reg.name : undefined,
			entry: this.entry,
			strict: this.strict
		}
	}

	setWriting(write: boolean) {
		this.write = write;
		return this;
	}
}


export function createNBTContext(reg: NBTRegistry, entry?: string, write?: boolean) {
	let e = entry ? reg.entries[entry] : undefined;
	let ctx = new NBTContext(e ? e : reg ? reg.base : [],reg,entry,write);
	return ctx;
}

export function parseNBT(t: TokenIterator, ctx?: NBTContext) {
	return parseDataCompound(t,NBT,ctx);
}

export function parseFutureNBT(t: TokenIterator, futureCtx: Lazy<NBTContext>): Lazy<any> {
	let ti = t.collectInsideBrackets('{','}',t.ctx.snapshot());
	return e=>{
		let nbt = parseNBT(ti,e.valueOf(futureCtx));
		return {value: e.valueOf(nbt), type: VariableTypes.nbt};
	}
}

export function toStringNBT(obj: any,ev: Evaluator): string {
	let entries = Object.keys(obj).map(k=>({key: k, value: obj[k]}));
	return '{' + entries.filter(e=>e.value !== undefined).map(e=>{
		return e.key + ':' + toStringValue(e.value,ev)
	}) + '}';
}

function toStringValue(value: any, e: Evaluator) {
	if (value === undefined) return '';
	if (typeof value == 'number') return value.toString();
	if (typeof value == 'string') return '"' + escapeString(value,/[\\"]/g) + '"';
	if (typeof value == 'bigint') return value + 'L';
	if (typeof value == 'boolean') return value + '';
	if (isArray(value)) return '[' + value.map(i=>toStringValue(i,e)).join(',') + ']';
	if (value.num !== undefined && value.suffix !== undefined) return value.num + value.suffix;
	if (typeof value == 'object') return toStringNBT(value,e);
	if (Lazy.is(value)) return toStringValue(e.valueOf(value),e)
	return value;
}

function parseNBTTag(t: TokenIterator, tag: DataProperty, nbt: any, ctx: NBTContext) {
	if (tag.noValue !== undefined && t.isNext(',','}',']')) {
		setTag(tag,nbt,undefined);
		return
	}
	if ((tag.type == 'bool' || tag.type == 'inverted_bool') && !t.isNext(':')) {
		setTag(tag,nbt,tag.type == 'bool');
		return;
	}
	t.expectValue(':');
	let val = parseType(t,tag.key,tag.type,tag.typeContext,ctx);
	if (val) {
		setTag(tag,nbt,val);
	}
	if (ctx.resolveEntryFrom && ctx.resolveEntryFrom == tag.key && ctx.futureEval) {
		console.log("resolving entry",ctx.resolveEntryFrom,nbt);
		let en = nbt[ctx.resolveEntryFrom];
		let v = ctx.futureEval.valueOf(en);
		console.log(v);
		ctx.resolveEntryFrom = undefined;
		ctx.entry = v;
		ctx.properties = ctx.reg.entries[v] || ctx.reg.base;
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
				return {value: r, type: VariableTypes.specialNumber};
			}
			
		case 'bool':
			return parseExpression(t,VariableTypes.boolean);
		case 'inverted_bool':
			let l = parseExpression(t,VariableTypes.boolean);
			return Lazy.map(l,b=>!b);
		case 'string':
			return parseExpression(t,VariableTypes.string);
		case 'effect':
			return Lazy.remap(parseExpression(t,VariableTypes.effect),v=>({value: {Id: entityEffects.indexOf(v.id.id)+1,Amplifier: v.id.tier,Duration: v.duration || 600,ShowParticles: !v.hide},type: VariableTypes.nbt}));
		case 'enchantment':
			return parseEnchantment(t);
		case 'item':
			let item = parseItem(t);
			let count = undefined;
			if (t.skip('*')) {
				count = parseSingleValue(t,VariableTypes.integer);
			}
			return Lazy.remap(item,(i,e)=>({value: {id: i.id, Count: e.valueOf(count,ctx.write ? 1 : undefined), tag: i.nbt || undefined},type: VariableTypes.nbt}));
		case 'blockstate':
			return Lazy.literal(parseBlockState(t,ctx.entry),VariableTypes.nbt);
		case 'block':
			let block = parseBlock(t,false,false);
			return Lazy.remap(block,(b)=>{
				return {value: {Name: b.id, Properties: b.state}, type: VariableTypes.nbt};
			});
		case 'block_id':
			t.suggestHere(...Object.keys(blocks.values))
			let id = parseIdentifierOrVariable(t);
			return Lazy.map(id.value,(b,e)=>{
				if (blocks.values[b] === undefined) {
					e.error(id.range,"Unknown block ID " + b);
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
			}
			return parseIndexedIdentifier(t,key,typeCtx.numeralIndex,typeCtx.values);
		case 'nbt':
			let newCtx: NBTContext;
			if (typeCtx.tags) {
				newCtx = new NBTContext(typeCtx.tags).setWriting(ctx.write);
				if (typeCtx.registry) {
					newCtx.reg = nbtRegistries[typeCtx.registry];
					newCtx.resolveEntryFrom = typeCtx.entry.from;
					return parseFutureNBT(t,e=>{
						newCtx.futureEval = e;
						return {value: newCtx,type: undefined};
					})
				}
			} else if (typeCtx.registry) {
				let reg = nbtRegistries[typeCtx.registry];
				if (!reg) {
					console.log("Unknown registry " + typeCtx.registry + " for tag " + key);
				}
				newCtx = createNBTContext(reg,typeCtx.entry,ctx.write);
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
			t.suggestHere(...dyeColors.map(d=>({value: d.id, kind: CompletionItemKind.Color})))
			if (t.isNext('$') || t.isTypeNext(TokenType.identifier)) {
				let color = parseIdentifierOrVariable(t);
				return e=>{
					let v = e.valueOf(color.value);
					let c = getDyeColorByName(v);
					if (!c) {
						e.error(color.range,'Invalid color ID: ' + v)
					} else {
						e.currentFile.editor.colors.push({range: color.range, color: Color.create(c.rgb[0],c.rgb[1],c.rgb[2],1)})
					}
					return {value: {num: c ? c.index : 0, suffix: 'b'},type: VariableTypes.specialNumber};
				}
			} else {
				let l = parseSingleValue(t,VariableTypes.integer);
				return Lazy.remap(l,(i,e)=>{
					if (i < 0 || i >= dyeColors.length) {
						e.error(l.range,'Invalid color ID: ' + i)
					} else {
						let c = dyeColors[i];
						e.currentFile.editor.colors.push({range: l.range, color: Color.create(c.rgb[0],c.rgb[1],c.rgb[2],1)})
					}
					return {value: {num: i, suffix: 'b'}, type: VariableTypes.specialNumber};
				});
			}
		case 'effect_id':
			t.suggestHere(...entityEffects)
			if (t.isNext('(') || t.isTypeNext(TokenType.int)) {
				return parseSingleValue(t,VariableTypes.integer);
			}
			let effectId = parseIdentifierOrVariable(t);
			if (!effectId) return;
			return Lazy.remap(effectId.value,(id,e)=>{
				if (entityEffects.indexOf(id) < 0) {
					e.error(effectId.range,"Unknown effect ID")
				}
				return {value: {num: entityEffects.indexOf(id)+1, suffix: 'b'},type: VariableTypes.specialNumber};
			});
		case 'tile_entity':
			let blockId = blocks.values[ctx.entry];
			return parseNBT(t,createNBTContext(nbtRegistries.tileEntities,blockId ? blockId.tile_entity : undefined))
		case 'byte':
			let brange = {...t.nextPos};
			let b = parseExpression(t,VariableTypes.integer);
			t.endRange(brange);
			return e=>{
				let r = e.valueOf(b);
				if (r > 32767) {
					e.warn(brange,"Value exceeds max byte value");
				}
				return {value: {num: r, suffix: 'b'}, type: VariableTypes.specialNumber};
			}
		case 'uuid':
			// todo: implement
			break;
		case 'long':
			let lrange = {...t.nextPos};
			let long = parseExpression(t,VariableTypes.integer);
			t.endRange(lrange);
			return Lazy.remap(long,(n=>({value: {num: n, suffix: 'L'},type: VariableTypes.specialNumber})));
		case 'horse_variant':
			let variant = parseNBT(t,new NBTContext(HORSE_VARIANT_TAGS).setWriting(ctx.write));
			return Lazy.remap(variant,(v,e)=>{
				let color = e.valueOf(v.color,0);
				let marking = e.valueOf(v.marking,0);
				return {value: color | marking << 8, type: VariableTypes.integer};
			});
		case 'enum':
			let values = typeCtx.values || (typeCtx.builtin ? builtin_enums[typeCtx.builtin] : undefined);
			if (!values) {
				console.log("enum nbt type of " + key + " missing 'values' or 'builtin' context property");
				return;
			}
			return parseEnumValue(t,values);
		case 'direction':
			return Lazy.remap(parseIndexedIdentifier(t,'direction',true,{0:"down",1:"up",2:"north",3:"south",4:"west",5:"east"}),(v=>{
				return {value: {num: Number(v), suffix: 'b'}, type: VariableTypes.specialNumber};
			}));
		case 'xyz':
			return parseNBT(t,new NBTContext(XYZ_TAGS).setWriting(ctx.write))
		case 'tropical_variant':
			if (t.isNext('{')) {
				let nbt = parseNBT(t,new NBTContext(TROPICAL_FISH_VARIANT_TAGS));
				return Lazy.remap(nbt,(v,e)=>{
					let pattern = e.valueOf(v.pattern,0);
					let color = e.valueOf(v.BodyColor,0);
					let patternColor = e.valueOf(v.PatternColor,0);
					let size = pattern > 5 ? 1 : 0;
					if (size == 1) {
						pattern -= 6;
					}
					return {value: (size | pattern << 8 | color << 16 | patternColor << 24), type: VariableTypes.integer};
				});
			}
			return parseExpression(t,VariableTypes.integer);
		case 'global_pos':
			return parseNBT(t,new NBTContext(GLOBAL_POS_TAGS).setWriting(ctx.write))
		default:
			console.log('Unknown NBT tag type: "' + type + '"');
	}
}



function setTag(tag: DataProperty, nbt: any, value: any) {
	if (value === undefined && tag.noValue) {
		value = tag.noValue;
	}
	if (value) {
		setValueInPath(tag,nbt,value);
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

const builtin_enums = {
	potion_id: [
		"empty",
		"water",
		"mundane",
		"thick",
		"awkward",
		"night_vision",
		"long_night_vision",
		"invisibility",
		"long_invisibility",
		"leaping",
		"strong_leaping",
		"long_leaping",
		"fire_resistance",
		"long_fire_resistance",
		"swiftness",
		"strong_swiftness",
		"long_swiftness",
		"slowness",
		"strong_slowness",
		"long_slowness",
		"water_breathing",
		"long_water_breathing",
		"healing",
		"strong_healing",
		"harming",
		"strong_harming",
		"poison",
		"strong_poison",
		"long_poison",
		"regeneration",
		"strong_regeneration",
		"long_regeneration",
		"strength",
		"strong_strength",
		"long_strength",
		"weakness",
		"long_weakness",
		"luck",
		"turtle_master",
		"strong_turtle_master",
		"long_turtle_master",
		"slow_falling",
		"long_slow_falling"
	],
	villager_professions: [
		"armorer",
		"butcher",
		"cartographer",
		"cleric",
		"farmer",
		"fisherman",
		"fletcher",
		"leatherworker",
		"librarian",
		"nitwit",
		"none",
		"mason",
		"shepherd",
		"toolsmith",
		"weaponsmith"
	],
	panda_genes: [
		"normal",
		"aggressive",
		"lazy",
		"worried",
		"playful",
		"weak",
		"brown"
	]
}

const EFFECT_TAGS: DataProperty[] = [
	{
		key: "Id",
		desc: "The effect's ID",
		type: "int"
	},
	{
		key: "Duration",
		desc: "The effect's duration in ticks",
		type: "int"
	},
	{
		key: "Amplifier",
		desc: "The effect's tier. 0 is tier I, 1 is tier II, etc.",
		type: "int"
	},
	{
		key: "ShowParticles",
		desc: "True if particles are visible for this effect",
		type: "bool"
	}
]

const HORSE_VARIANT_TAGS: DataProperty[] = [
	{
		key: "color",
		desc: "The horse base color",
		type: "indexed_identifier",
		typeContext: {
			numeralIndex: true,
			values: {
				0: "white",
				1: "creamy",
				2: "chestnut",
				3: "brown",
				4: "black",
				5: "gray",
				6: "dark_brown"
			}
		}
	},
	{
		key: "marking",
		desc: "The horse variant decoration",
		type: "indexed_identifier",
		typeContext: {
			numeralIndex: true,
			values: {
				0: "none",
				1: "white",
				2: "white_field",
				3: "white_dots",
				4: "black_dots"
			}
		}
	}
]

const XYZ_TAGS: DataProperty[] = [
	{
		key: "X",
		type: "int"
	},
	{
		key: "Y",
		type: "int"
	},
	{
		key: "Z",
		type: "int"
	}
]

const TROPICAL_FISH_VARIANT_TAGS = [
	{
		key: "pattern",
		desc: "The tropical fish pattern type",
		type: "indexed_identifier",
		typeContext: {
			numeralIndex: true,
			values: {
				0: "kob",
				1: "sunstreak",
				2: "snooper",
				3: "dasher",
				4: "brinely",
				5: "spotty",
				6: "flopper",
				7: "stripey",
				8: "glitter",
				9: "blockfish",
				10: "betty",
				11: "clayfish"
			}
		}
	},
	{
		key: "BodyColor",
		type: "color_id",
		desc: "The color of the tropical fish body"
	},
	{
		key: "PatternColor",
		type: "color_id",
		desc: "The color of the tropical fish pattern"
	}
]

const GLOBAL_POS_TAGS = [
	{
		key: "pos",
		type: "list",
		typeContext: {
			item: "int"
		},
		desc: "The XYZ values of the position, stored as 3 integers"
	},
	{
		key: "dimension",
		type: "enum",
		typeContext: {
			values: [
				"overworld",
				"the_nether",
				"the_end"
			]
		},
		desc: "The dimension this position is in"
	}
]

export function getColorById(id: number) {
	return dyeColors[id];
}

export function getDyeColorByName(colorId: string) {
	let i = dyeColors.findIndex(c=>c.id == colorId);
	if (i < 0) return undefined;
	return {index: i, ...dyeColors[i]};
}

export interface NBTPath {
	path: Lazy<string>,
	end: {
		type: string,
		ctx: any
	}
}

export class NBTPathContext {
	isNative: boolean = false;
	isStrict: boolean = false;
	isList: boolean = false;
	type: string = "nbt"
	typeContext: any = {}
	constructor(public props: DataProperty[]) {

	}

	static create(registry: NBTRegistry, entry?: string) {
		return new NBTPathContext(entry ? registry.entries[entry] : registry.base).strict(registry.strict);
	}

	native() {
		this.isNative = true;
		return this;
	}

	strict(def: boolean = true, from?: NBTPathContext) {
		if (from) {
			if (from.isStrict) {
				this.isStrict = false;
			} else {
				this.isStrict = def;
			}
		} else {
			this.isStrict = def;
		}
		return this;
	}

	list() {
		this.isList = true;
		return this;
	}

	withType(type: string, ctx: any) {
		this.type = type || "";
		this.typeContext = ctx || {};
		return this;
	}

	toObjectContext() {
		let c = new NBTContext(this.props);
		c.strict = this.isStrict;
		return c;
	}
}


export function parseNBTPath(t: TokenIterator, startWithSlash: boolean, ctx: NBTPathContext): NBTPath {
	if (startWithSlash && !t.skip('/')) {
		return undefined;
	}
	if (t.isNext('{')) {
		let nbt = parseNBT(t,ctx.toObjectContext());
		let path: NBTPath = {path: Lazy.remap(nbt,(n,e)=>({value: toStringNBT(n,e), type: VariableTypes.string})),end: {type: ctx.type, ctx: ctx.typeContext}};
		if (t.skip('.')) {
			let node = parsePathNode(t,ctx);
			return combinePaths(path,true,Lazy.literal(node.node,VariableTypes.string),{type: node.ctx.type, ctx: node.ctx.typeContext});
		}
		return path;
	} else {
		let node = parsePathNode(t,ctx);
		return chainPath({path: Lazy.literal(node.node,VariableTypes.string), end: {type: node.ctx.type, ctx: node.ctx.typeContext}},t,node.ctx);
	}
}

export function parsePathNode(t: TokenIterator, ctx: NBTPathContext): {node: string, ctx: NBTPathContext} {
	if (ctx) {
		t.suggestHere(...ctx.props.map(p=>({value: p.key,detail: p.type, desc: p.desc, kind: CompletionItemKind.Property})))
	}
	let n: Token;
	if (t.isTypeNext(TokenType.string,TokenType.identifier)) {
		n = t.next();
	} else {
		t.errorNext('Expected path node to be a string or an identifier!');
		return {node: "",ctx: new NBTPathContext([])}
	}
	let prop = findProp(ctx.props,n.value);
	if (ctx.isStrict && !prop) {
		t.error(n.range,"Unknown NBT property");
		return {node: "",ctx: new NBTPathContext([])};
	}
	if (prop) {
		t.ctx.editor.setHover(n.range,getDataPropHover(prop,NBT));
	}
	let node = prop ? (prop.path ? joinPropPath(prop.path) : prop.key) : n.value;
	let newCtx = getNewContext(ctx,n.value);
	return {node, ctx: newCtx};
}

function joinPropPath(path: string[]) {
	let str = "";
	let first = true;
	for (let n of path) {
		if (n.startsWith('[')) {
			str += n;
		} else if (first) {
			str += n;
		} else {
			str += '.' + n;
		}
		first = false;
	}
	return str;
}

function getNewContext(ctx: NBTPathContext, path: string): NBTPathContext {
	let tag = findProp(ctx.props,path);
	if (tag) {
		return getNBTCtxForType(tag.type,tag.typeContext,ctx);
	}
	if (!ctx.isStrict) {
		return new NBTPathContext([]);
	}
}

function getNewArrayContext(ctx: NBTPathContext) {
	if (ctx.typeContext && ctx.typeContext.item) {
		return getNBTCtxForType(ctx.typeContext.item,ctx.typeContext.itemContext,ctx);
	}
	return new NBTPathContext([]);
}

export function getNBTCtxForType(type: string, typeCtx: any, prev: NBTPathContext) {
	let ctx: NBTPathContext;
	switch (type) {
		case 'nbt':
			if (typeCtx) {
				if (typeCtx.tags) {
					if (typeCtx.registry) {
						ctx = NBTPathContext.create(nbtRegistries[typeCtx.registry]);
					} else {
						ctx = new NBTPathContext(typeCtx.tags).strict(false,prev);
					}
				} else if (typeCtx.registry) {
					ctx = NBTPathContext.create(nbtRegistries[typeCtx.registry],typeCtx.entry);
				}
			}
			break;
		case 'item':
			ctx = new NBTPathContext([
				{
					key: "id",
					type: "string",
					desc: "The item's ID"
				},
				{
					key: "Count",
					type: "int",
					desc: "The amount of this item in the item stack"
				},
				{
					key: "tag",
					type: "nbt",
					desc: "NBT Tag of the item. Contains some tags for specific use and can save custom NBT.",
					typeContext: {
						registry: "item",
						strict: false
					}
				}
			]).strict();
			break;
		case 'list':
			ctx = new NBTPathContext([]).list();
			break;
		case 'effect':
			ctx = new NBTPathContext(EFFECT_TAGS).strict();
			break;
		case 'blockstate':
			ctx = new NBTPathContext([]);
			break;
		case 'block':
			ctx = new NBTPathContext([
				{
					key: "Name",
					desc: "The block ID",
					type: "string"
				},
				{
					key: "Properties",
					desc: "Key-value pairs of the block state",
					type: "nbt",
					typeContext: {
						strict: false
					}
				}
			]).strict()
			break;
		case 'tile_entity':
			ctx = NBTPathContext.create(nbtRegistries.tileEntities);
			break;
		case 'xyz':
			ctx = new NBTPathContext(XYZ_TAGS).strict()
			break;
		case 'global_pos':
			ctx = new NBTPathContext(GLOBAL_POS_TAGS).strict()
			break;
		default:
			ctx = new NBTPathContext([]).native();
			break;
	}
	return ctx.withType(type,typeCtx);
}



function chainPath(prev: NBTPath, t: TokenIterator, ctx: NBTPathContext): NBTPath {
	if (ctx.typeContext.item) {
		t.suggestHere('[');
	}
	if (t.skip('[')) {
		if (ctx.isNative) {
			t.error(t.lastPos,'This path points to a native value, thus cannot be accessed.');
		}
		if (ctx && ctx.isList === false) {
			t.error(t.lastPos,"This node is not an array!");
		}
		if (t.skip(']')) {
			return chainPath(combinePaths(prev,false,Lazy.literal('[]',VariableTypes.string),{type: "list",ctx: ctx.typeContext.itemContext}),t,getNewArrayContext(ctx));
		}
		if (t.isNext('{')) {
			let nbt = parseNBT(t,getNewArrayContext(ctx).toObjectContext());
			t.expectValue(']');
			return chainPath(combinePaths(prev,false,Lazy.remap(nbt,(n,e)=>({value: '[' + toStringNBT(n,e) + ']',type: VariableTypes.string})),{type: "list",ctx: ctx.typeContext.itemContext}),t,getNewArrayContext(ctx))
		}
		let n = parseExpression(t,VariableTypes.integer);
		t.expectValue(']');
		return chainPath(combinePaths(prev,false,Lazy.remap(n,(i)=>({value: '[' + i + ']',type: VariableTypes.string})),{type: "list",ctx: ctx.typeContext.itemContext}),t,getNewArrayContext(ctx));
	} else {
		if (t.isNext('{','/')) {
			if (ctx.isList) {
				t.errorNext('This node can only be accessed as an array');
			} else if (ctx.isNative) {
				t.errorNext('This path points to a native value, thus cannot be accessed.');
			}
		}
		if (t.isNext('{')) {
			let nbt = parseNBT(t,ctx.toObjectContext());
			return chainPath(combinePaths(prev,false,Lazy.remap(nbt,(n,e)=>({value: toStringNBT(n,e), type: VariableTypes.string})),{type: "nbt",ctx: ctx.typeContext}),t,ctx);
		}
		if (t.skip('/')) {
			let path = parsePathNode(t,ctx);
			return chainPath(combinePaths(prev,true,Lazy.literal(path.node,VariableTypes.string),{type: path.ctx.type, ctx: path.ctx.typeContext}),t,path.ctx);
		}
		return prev;
	}
}

export interface NBTAccess {
	path: string,
	selector: string
}

function combinePaths(prev: NBTPath,addDot: boolean,lastNode: Lazy<string>,end?: {type: string, ctx: any}): NBTPath {
	return {path: e=>({value: e.valueOf(prev.path,"") + (addDot ? '.' : '') + e.valueOf(lastNode),type: VariableTypes.string}), end};
}

export function parseNBTAccess(t: TokenIterator, path: NBTPath): (selector: string, e: Evaluator)=>Variable<any> | void {
	if (t.skip('=')) {
		let value = parseNBTSource(t);
		return (s,e)=>{
			e.write('data modify ' + s + ' ' + e.valueOf(path.path) + ' set ' + e.valueOf(value));
		}
	}
	let scale = Lazy.literal(1,VariableTypes.double);
	if (t.skip('*')) {
		scale = parseSingleValue(t,VariableTypes.double);
	}
	return (sel,e)=>{
		let p = e.valueOf(path.path);
		e.write('data get ' + sel + ' ' + p + ' ' + e.valueOf(scale));
		return {type: VariableTypes.nbtAccess, value: {path: p, selector: sel}}
	}
}

export function parseNBTSource(t: TokenIterator): Lazy<string> {
	if (t.isTypeNext(TokenType.identifier) && !t.isNext('storage','self','block')) {
		let vname = t.peek().value;
		let type = t.ctx.getVariableType(vname);
		if (type == VariableTypes.selector) {
			t.skip();
			let path = parseNBTPath(t,true,NBTPathContext.create(nbtRegistries.entities));
			let scale = Lazy.literal(1,VariableTypes.double);
			if (t.skip('*')) {
				scale = parseSingleValue(t,VariableTypes.double);
			}
			return e=>{
				return {value: 'from entity ' + Selector.toString(e.getVariable(vname).value,e) + ' ' + e.valueOf(path.path) + ' ' + e.valueOf(scale), type: VariableTypes.string};
			}
		}
	}
	let holderType: string;
	let selector: Lazy<string>;
	let ctx: NBTPathContext;
	if (t.skip('storage')) {
		t.expectValue(':');
		let id = t.expectType(TokenType.identifier);
		selector = Lazy.literal(id.value,VariableTypes.string);
		ctx = new NBTPathContext([]);
		holderType = 'storage';
	} else if (t.skip('block')) {
		let loc = parseLocation(t);
		selector = e=>({value: toStringPos(loc,e),type: VariableTypes.string});
		ctx = NBTPathContext.create(nbtRegistries.tileEntities);
		holderType = 'block';
	} else if (t.isNext('@','self')) {
		let sel = parseSelector(t);
		selector = Selector.asLazyString(sel);
		ctx = NBTPathContext.create(nbtRegistries.entities,sel.type);
		holderType = 'entity';
	} else {
		let value = parseNBTValue(t);
		return e=>{
			return {value: "value " + toStringValue(e.valueOf(value),e),type: VariableTypes.string};
		}
	}
	let path = parseNBTPath(t,true,ctx);
	let scale = Lazy.literal(1,VariableTypes.double);
	if (t.skip('*')) {
		scale = parseSingleValue(t,VariableTypes.double);
	}
	return e=>{
		return {value: 'from ' + holderType + ' ' + e.valueOf(selector) + ' ' + e.valueOf(path.path) + ' ' + e.valueOf(scale), type: VariableTypes.string};
	}
}

export function parseNBTValue(t: TokenIterator) {
	if (t.isNext('{')) {
		return parseNBT(t,new NBTContext([],undefined,undefined,true));
	} else if (t.isNext('[')) {
		return parseList(t,'[',']',()=>parseNBTValue(t));
	}
	return parseExpression(t);
}