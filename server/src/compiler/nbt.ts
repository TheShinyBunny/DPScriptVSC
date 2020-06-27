
import { VariableTypes, parseIdentifierOrVariable, parseItem, parseBlock, parseBlockState, parseList, escapeString, parseEnumValue, parseIndexedIdentifier, parseLocation, toStringPos, SpecialNumber, Variable, VariableType, MemberGroup, BaseMemberEntry, CommandGetter, ValueTypeObject } from './util';
import { TokenIterator, Tokens, Token, TokenType, Tokenizer } from './tokenizer';
import { DataStructureType, parseDataCompound, DataProperty, DataContext, findProp, setTagValue, getDataPropHover, getValueInPath } from './data_structs';
import { Lazy, Evaluator, parseExpression, parseSingleValue } from './parser';
import { CompletionItemKind, Color, TextEdit } from 'vscode-languageserver';
import { Selector, parseSelector } from './selector';

import * as globalMixins from './registries/global_mixins.json';
import { entityEffects, parseEnchantment } from './entities';
import * as blocks from './registries/blocks.json';
import { JsonContext, JsonTextType, praseJson, stringifyJson } from './json_text';
import { isArray } from 'util';
import { BasicRegistry, Registry } from './registries';

let globalMixinRegistry: {[name: string]: DataProperty[]} = {}

export function initNBTRegistries() {
	Object.keys(globalMixins.mixins).forEach(k=>globalMixinRegistry[k] = gatherTags('global_mixins',globalMixins,globalMixins.mixins[k],k,false,true));
}

export function resolveNBTRegistry(name: string, reg: NBTRegistryBuilder): NBTRegistry {
	let entries = {}
	for (let k of Object.keys(reg.values)) {
		let v = reg.values[k];
		if (!v.abstract) {
			entries[k] = gatherTags(name,reg,v,k,true,false);
		}
	}
	return new NBTRegistry(entries,reg.base,reg.strict,name);
}

export interface NBTRegistryEntry {
	tags?: DataProperty[]
	mixins?: string[]
	extends?: string
	abstract?: boolean
}

export class NBTRegistry extends BasicRegistry<NBTRegistryEntry> {
	
	constructor (items: {[id: string]: NBTRegistryEntry}, public base: DataProperty[], public strict: boolean, public name: string) {
		super(items)
	}

	createContext(entry?: string, write: boolean = true) {
		let ctx = new NBTContext(this.getTags(entry),this,entry,write);
		return ctx;
	}

	createPathContext(entry?: string) {
		return new NBTPathContext(this.getTags(entry)).strict(this.strict);
	}

	getTags(entry: string): DataProperty[] {
		if (!entry) return this.base || []
		let e = this.get(entry);
		return e ? e.tags : this.base || []
	}
}

export interface NBTRegistryBuilder {
	strict: boolean
	base: DataProperty[]
	values: {[id: string]: NBTRegistryEntry}
	mixins: {[id: string]: NBTRegistryEntry}
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

function gatherTags(regName: string, reg: NBTRegistryBuilder, entry: NBTRegistryEntry, key: string, includeBase: boolean, isMixin: boolean): DataProperty[] {
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
			if (m.startsWith('global.')) {
				let n = m.substr('global.'.length);
				let tags = globalMixinRegistry[n];
				if (tags) {
					props.push(...tags);
				} else {
					console.log("UNKNOWN GLOBAL MIXIN: " + n + " for " + regName + ':' + key);
				}
			} else if (mixin) {
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

export class NBTContext extends DataContext<DataProperty> {

	resolveEntryFrom?: string
	valueTypes?: string
	valueTypesCtx?: any
	futureEval?: Evaluator

	constructor(props: DataProperty[], public reg?: NBTRegistry, public entry?: string, public write?: boolean) {
		super();
		this.properties = props;
		this.strict = reg ? reg.strict : false;
	}

	parseUnknownProp(t: TokenIterator, key: string, data: any) {
		return this.valueTypes ? parseType(t,key,this.valueTypes,this.valueTypesCtx || {},this,data) : super.parseUnknownProp(t,key,data);
	}

	subContext(tags: DataProperty[], strict?: boolean) {
		let ctx = new NBTContext(tags);
		ctx.write = this.write;
		ctx.strict = strict === undefined ? this.strict : strict;
		return ctx;
	}
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
	if (isArray(value)) {
		let res = '[';
		let arrType: string;
		let inside = value.map(i=>{
			let v;
			let type: VariableType<any>;
			if (Lazy.is(i)) {
				let res = i(e);
				v = res.value;
				type = res.type;
			} else {
				v = i;
			}
			if (!arrType) {
				arrType = getArrType(v,type);
			}
			return toStringValue(v,e)
		}).join(',');
		if (arrType) {
			res += arrType + ';';
		}
		return res + inside + ']';
	}
	if (value.num !== undefined && value.suffix !== undefined) return value.num + value.suffix;
	if (typeof value == 'object') return toStringNBT(value,e);
	if (Lazy.is(value)) return toStringValue(e.valueOf(value),e)
	return value;
}

function getArrType(value: any, type?: VariableType<any>) {
	if (typeof value == 'number') {
		return type == VariableTypes.integer ? 'I' : undefined;
	}
	if (value.suffix && value.num !== undefined) {
		if (value.suffix == 'L') return 'L';
		if (value.suffix == 'b') return 'B';
	}
}

function parseNBTTag(t: TokenIterator, tag: DataProperty, nbt: any, ctx: NBTContext) {
	if (tag.writeonly && !ctx.write) {
		return;
	}
	if (tag.noValue !== undefined && t.isNext(',','}',']')) {
		setTag(tag,nbt,undefined);
		return
	}
	if ((tag.type == 'bool' || tag.type == 'inverted_bool') && !t.isNext(':')) {
		setTag(tag,nbt,tag.type == 'bool');
		return;
	}
	if (t.expectValue(':')) {
		let val = parseType(t,tag.key,tag.type,tag.typeContext || {},ctx,nbt);
		if (val) {
			setTag(tag,nbt,val);
		}
		if (ctx.resolveEntryFrom && ctx.resolveEntryFrom == tag.key && ctx.futureEval) {
			let en = nbt[ctx.resolveEntryFrom];
			let v = ctx.futureEval.valueOf(en);
			ctx.resolveEntryFrom = undefined;
			ctx.entry = v;
			ctx.properties = ctx.reg ? ctx.reg.get(v) ? ctx.reg.get(v).tags || ctx.reg.base : ctx.reg.base || [] : [];
		}
	}
}


function parseType(t: TokenIterator, key: string, type: string, typeCtx: any, ctx: NBTContext, dataSoFar: any): Lazy<any> {
	switch (type) {
		case 'int':
			return parseExpression(t,VariableTypes.integer);
		case 'double':
			return parseExpression(t,VariableTypes.double);
		case 'short':
			let range = t.startRange();
			let i = parseExpression(t,VariableTypes.integer);
			t.endRange(range);
			return e=>{
				let r = e.valueOf(i);
				if (r > 32767) {
					e.warn(range,"Value exceeds max short value");
				}
				return {value: {num: r, suffix: 's'}, type: VariableTypes.specialNumber};
			}
		case 'float':
			let f = parseExpression(t,VariableTypes.double);
			return e=>{
				let r = e.valueOf(f);
				return {value: {num: r, suffix: 'F'}, type: VariableTypes.specialNumber};
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
			let slot = undefined;
			if (typeCtx.slot) {
				t.expectValue('#');
				slot = parseSingleValue(t,VariableTypes.integer);
				t.expectValue(':');
			}
			let item = parseItem(t);
			let count = undefined;
			if (t.skip('*')) {
				count = parseSingleValue(t,VariableTypes.integer);
			}
			return Lazy.remap(item,(i,e)=>({value: {id: i.id, Count: e.valueOf(count,ctx.write ? 1 : undefined), tag: i.nbt || undefined, Slot: slot},type: VariableTypes.nbt}));
		case 'blockstate':
			return Lazy.literal(parseBlockState(t,ctx.entry),VariableTypes.nbt);
		case 'block':
			let block = parseBlock(t,false,false);
			return Lazy.remap(block,(b)=>{
				return {value: {Name: b.id, Properties: b.state}, type: VariableTypes.nbt};
			});
		case 'block_id':
			t.suggestHere(...Object.keys(blocks))
			let id = parseIdentifierOrVariable(t);
			return Lazy.map(id.value,(b,e)=>{
				if (blocks[b] === undefined) {
					e.error(id.range,"Unknown block ID " + b);
				}
				return 'minecraft:' + b;
			});
		case 'list':
			let list = parseList(t,'[',']',()=>{
				if (typeCtx.item) {
					return parseType(t,key + '[]',typeCtx.item,typeCtx.itemContext || {},ctx,{});
				}
				return parseExpression(t);
			},typeCtx.count);
			return Lazy.literal(list,VariableTypes.nbt);
		case 'indexed_identifier':
			if (!typeCtx.values) {
				console.log("no values for indexed identifier in " + ctx.entry);
				return undefined;
			}
			return parseIndexedIdentifier(t,key,typeCtx.numeralIndex,typeCtx.values,typeCtx.indexType);
		case 'nbt':
			let newCtx: NBTContext;
			if (typeCtx.valueTypes) {
				newCtx = ctx.subContext([],false);
				newCtx.valueTypes = typeCtx.valueTypes;
				newCtx.valueTypesCtx = typeCtx.valueTypesCtx;
			} else if (typeCtx.tags) {
				newCtx = ctx.subContext(typeCtx.tags,typeCtx.strict);
				if (typeCtx.registry) {
					newCtx.reg = Registry.getNBTRegistry(typeCtx.registry);
					newCtx.resolveEntryFrom = typeCtx.entry.from;
					return parseFutureNBT(t,e=>{
						newCtx.futureEval = e;
						return {value: newCtx,type: VariableTypes.any};
					})
				}
			} else if (typeCtx.registry) {
				let reg = Registry.getNBTRegistry(typeCtx.registry);
				if (!reg) {
					console.log("Unknown registry " + typeCtx.registry + " for tag " + key);
					newCtx = new NBTContext([]);
				} else {
					newCtx = reg.createContext(typeCtx.entry,ctx.write);
				}
			}
			return Lazy.literal(parseNBT(t,newCtx),VariableTypes.nbt);
		case 'json':
			let type = typeCtx.json_text;
			let jsonCtx: JsonContext = undefined;
			if (type) {
				jsonCtx = JsonContext.of(JsonTextType.get(type));
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
						e.file.editor.colors.push({range: color.range, color: Color.create(c.rgb[0],c.rgb[1],c.rgb[2],1)})
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
						e.file.editor.colors.push({range: l.range, color: Color.create(c.rgb[0],c.rgb[1],c.rgb[2],1)})
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
			let blockId: string;
			if (typeof typeCtx.entry == 'string') {
				if (typeCtx.entry == '$current_block_id') {
					blockId = ctx.entry;
				} else {
					blockId = typeCtx.entry;
				}
			} else {
				blockId = getValueInPath(dataSoFar,typeCtx.entry.from);
			}
			let blockType = blocks[blockId];
			return parseNBT(t,Registry.tile_entities.createContext(blockId ? blockType.tile_entity : undefined))
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
			let variant = parseNBT(t,ctx.subContext(HORSE_VARIANT_TAGS,true));
			return Lazy.remap(variant,(v,e)=>{
				let color = e.valueOf(v.color,0);
				let marking = e.valueOf(v.marking,0);
				return {value: color | (marking << 8), type: VariableTypes.integer};
			});
		case 'enum':
			let values = typeCtx.values || (typeCtx.builtin ? builtin_enums[typeCtx.builtin] : undefined);
			if (!values) {
				console.log("enum nbt type of " + key + " missing 'values' or 'builtin' context property");
				return;
			}
			return parseEnumValue(t,values);
		case 'direction':
			return parseIndexedIdentifier(t,'direction',true,{0:"down",1:"up",2:"north",3:"south",4:"west",5:"east"},'b');
		case 'xyz':
			if (typeCtx.prefix || typeCtx.suffix) {
				let pos = parseList(t,'[',']',()=>parseExpression(t,typeCtx.double ? VariableTypes.double : VariableTypes.integer),3);
				function apply(axis: string) {
					return (typeCtx.prefix || '') + axis + (typeCtx.suffix || '')
				}
				dataSoFar[apply('X')] = pos[0];
				dataSoFar[apply('Y')] = pos[1];
				dataSoFar[apply('Z')] = pos[2];
				return;
			}
			return parseNBT(t,ctx.subContext(XYZ_TAGS))
		case 'tropical_variant':
			if (t.isNext('{')) {
				let nbt = parseNBT(t,ctx.subContext(TROPICAL_FISH_VARIANT_TAGS,true));
				return Lazy.remap(nbt,(v,e)=>{
					let pattern = e.valueOf(v.pattern,0);
					let color = e.valueOf(v.BodyColor,0);
					let patternColor = e.valueOf(v.PatternColor,0);
					let size = pattern > 5 ? 1 : 0;
					if (size == 1) {
						pattern -= 6;
					}
					return {value: (size | (pattern << 8) | (color << 16) | (patternColor << 24)), type: VariableTypes.integer};
				});
			}
			return parseExpression(t,VariableTypes.integer);
		case 'global_pos':
			return parseNBT(t,ctx.subContext(GLOBAL_POS_TAGS,true));
		case 'rgb':
			if (typeCtx.fireworks) {
				t.suggestHere(...dyeColors.map(c=>c.id));
			}
			if (t.suggestHere({value: 'rgb',detail: 'rgb(r,g,b)',snippet: "rgb($1,$2,$3)$0"})) {
				let colorRange = t.startRange();
				t.skip();
				t.expectValue('(');
				let r = parseExpression(t,VariableTypes.integer);
				t.expectValue(',');
				let g = parseExpression(t,VariableTypes.integer);
				t.expectValue(',');
				let b = parseExpression(t,VariableTypes.integer);
				t.expectValue(')');
				t.endRange(colorRange);
				return e=>{
					let rv = e.valueOf(r);
					let gv = e.valueOf(g);
					let bv = e.valueOf(b);
					e.file.editor.colors.push({color: Color.create(rv / 255,gv / 255,bv / 255, 1),range: colorRange});
					e.file.editor.colorPresentations.push({range: colorRange, getter: (c)=>{
						let label = `rgb(${c.red * 255},${c.green * 255},${c.blue * 255})`;
						return {label, textEdit: TextEdit.replace(colorRange,label)};
					}});
					return {type: VariableTypes.integer, value: (rv << 16) + (gv << 8) + bv}
				}
			} else if (typeCtx.fireworks) {
				if (t.isNext(...dyeColors.map(c=>c.id))) {
					let id = t.next().value;
					let color = dyeColors.find(c=>c.id == id);
					t.ctx.script.editor.colors.push({color: Color.create(color.rgb[0],color.rgb[1],color.rgb[2],1),range: t.lastPos});
					return Lazy.literal(color.firework,VariableTypes.integer);
				}
			}
			return parseExpression(t,VariableTypes.integer);
		case 'flags':
			if (!typeCtx.flags) {
				console.log("no flags for 'flags' property!");
				return;
			}
			let flags = Object.keys(typeCtx.flags).map(k=>({key: Number(k), value: typeCtx.flags[k]}));
			let value: number;
			if (t.skip('all')) {
				value = flags.reduce((a,f)=>a + f.key,0);
			} else {
				let flagList = parseList<{key: number, value: string}>(t,'[',']',(i,f)=>{
					let v = t.expectType(TokenType.identifier,()=>flags.filter(a=>f.findIndex(id=>a.value == id.value) < 0));
					let flag: {key: number, value: string} = flags.find(fl=>fl.value == v.value);
					if (!flag) {
						t.error(v.range,"Unknown flag '" + v.value + "'");
						return {key: 0,value:""}
					}
					return flag;
				});
				value = flagList.reduce((a,c)=>a + c.key,0);
			}
			return Lazy.literal(value,VariableTypes.integer);
		default:
			console.log('Unknown NBT tag type: "' + type + '"');
	}
}



function setTag(tag: DataProperty, nbt: any, value: any) {
	if (value === undefined && tag.noValue) {
		value = tag.noValue;
	}
	if (value) {
		setTagValue(tag,nbt,value);
	}
}



export const dyeColors = [
	{id:"white",rgb:[0.9764706,1.0,0.99607843],firework:15790320},
	{id:"orange",rgb:[0.9764706,0.5019608,0.11372549],firework:15435844},
	{id:"magenta",rgb:[0.78039217,0.30588236,0.7411765],firework:12801229},
	{id:"light_blue",rgb:[0.22745098,0.7019608,0.85490197],firework:6719955},
	{id:"yellow",rgb:[0.99607843,0.84705883,0.23921569],firework:14602026},
	{id:"lime",rgb:[0.5019608,0.78039217,0.12156863],firework:4312372},
	{id:"pink",rgb:[0.9529412,0.54509807,0.6666667],firework:14188952},
	{id:"gray",rgb:[0.2784314,0.30980393,0.32156864],firework:4408131},
	{id:"light_gray",rgb:[0.6156863,0.6156863,0.5921569],firework:11250603},
	{id:"cyan",rgb:[0.08627451,0.6117647,0.6117647],firework:2651799},
	{id:"purple",rgb:[0.5372549,0.19607843,0.72156864],firework:8073150},
	{id:"blue",rgb:[0.23529412,0.26666668,0.6666667],firework:2437522},
	{id:"brown",rgb:[0.5137255,0.32941177,0.19607843],firework:5320730},
	{id:"green",rgb:[0.36862746,0.4862745,0.08627451],firework:3887386},
	{id:"red",rgb:[0.6901961,0.18039216,0.14901961],firework:11743532},
	{id:"black",rgb:[0.11372549,0.11372549,0.12941177],firework:1973019}
]

const builtin_enums = {
	potion_id: Registry.potions,
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
	],
	colors: dyeColors.map(c=>c.id)
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

const ITEMSTACK_TAGS = [
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
			registry: "items",
			strict: false
		}
	}
]

const ITEM_WITH_SLOT_TAGS = [
	...ITEMSTACK_TAGS,
	{
		key: "Slot",
		type: "byte",
		desc: "The slot ID the item is in"
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

export type NBTPath = PathNode[]

export enum PathNodeType {
	normal,
	predicate,
	array_index,
	entire_array,
	array_predicate,
	root,
	invalid
}

export interface PathNode {
	label: Lazy<any>
	type: PathNodeType
	ctx: NBTPathContext
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
		return new NBTPathContext(entry ? registry.getTags(entry) : registry.base).strict(registry.strict);
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
	let path: NBTPath = []
	if (t.isNext('{')) {
		let nbt = parseNBT(t,ctx.toObjectContext());
		path = [{label: nbt,type: PathNodeType.root, ctx}];
		if (!t.skip('/')) {
			return path;
		}
	}
	let nodes = parsePathNode(t,ctx);
	return chainPath([...path,...nodes],t,nodes[nodes.length-1].ctx);
}

export function parsePathNode(t: TokenIterator, ctx: NBTPathContext): PathNode[] {
	if (ctx) {
		t.suggestHere(...ctx.props.map(p=>({value: p.key,detail: p.type, desc: p.desc, kind: CompletionItemKind.Property})))
	}
	let n: Token;
	if (t.isTypeNext(TokenType.string,TokenType.identifier)) {
		n = t.next();
	} else {
		t.errorNext('Expected path node to be a string or an identifier!');
		return [{label: undefined, type: PathNodeType.invalid, ctx: new NBTPathContext([])}]
	}
	let prop = findProp(ctx.props,n.value);
	if (ctx.isStrict && !prop) {
		t.error(n.range,"Unknown NBT property");
		return [{label: undefined, type: PathNodeType.invalid,ctx: new NBTPathContext([])}];
	}
	if (prop) {
		t.ctx.editor.setHover(n.range,getDataPropHover(prop,NBT));
	}
	let newCtx = getNewContext(ctx,prop);
	if (prop && prop.path) {
		return prop.path.map(n=>createPathNode(n,newCtx));
	}
	return [{label: Lazy.literal(prop ? prop.key : n.value,VariableTypes.string),type: PathNodeType.normal, ctx: newCtx}]
}

function createPathNode(node: any, ctx: NBTPathContext): PathNode {
	if (isArray(node)) {
		if (typeof node[0] == 'number') {
			return {label: Lazy.literal(node[0],VariableTypes.integer), ctx, type: PathNodeType.array_index}
		} else {
			return {label: Lazy.literal(node[0],VariableTypes.nbt), ctx, type: PathNodeType.array_predicate}
		}
	} else if (typeof node == 'string') {
		return {label: Lazy.literal(node,VariableTypes.string), ctx, type: PathNodeType.normal}
	} else if (typeof node == 'object') {
		return {label: Lazy.literal(node,VariableTypes.nbt), ctx, type: PathNodeType.predicate}
	}
	return {label: Lazy.literal(node,VariableTypes.string), ctx, type: PathNodeType.invalid}
}


function getNewContext(ctx: NBTPathContext, prop: DataProperty): NBTPathContext {
	if (prop) {
		return getNBTCtxForType(prop.type,prop.typeContext || {},ctx);
	}
	if (!ctx.isStrict) {
		return new NBTPathContext([]);
	}
}

function getNewArrayContext(ctx: NBTPathContext) {
	if (ctx.typeContext && ctx.typeContext.item) {
		return getNBTCtxForType(ctx.typeContext.item,ctx.typeContext.itemContext || {},ctx);
	}
	return new NBTPathContext([]).native();
}

export function getNBTCtxForType(type: string, typeCtx: any, prev: NBTPathContext) {
	let ctx: NBTPathContext;
	switch (type) {
		case 'nbt':
			if (typeCtx) {
				if (typeCtx.tags) {
					if (typeCtx.registry) {
						ctx = Registry.getNBTRegistry(typeCtx.registry).createPathContext();
					} else {
						ctx = new NBTPathContext(typeCtx.tags).strict(false,prev);
					}
				} else if (typeCtx.registry) {
					ctx = Registry.getNBTRegistry(typeCtx.registry).createPathContext(typeCtx.entry);
				}
			}
			break;
		case 'item':
			ctx = new NBTPathContext(typeCtx.slot ? ITEM_WITH_SLOT_TAGS : ITEMSTACK_TAGS).strict();
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
			ctx = Registry.tile_entities.createPathContext()
			break;
		case 'xyz':
			if (typeCtx.prefix) {
				ctx = new NBTPathContext([]).native()
			}
			ctx = new NBTPathContext(XYZ_TAGS).strict()
			break;
		case 'global_pos':
			ctx = new NBTPathContext(GLOBAL_POS_TAGS).strict()
			break;
		case 'uuid':
			ctx = new NBTPathContext([]).list()
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
		let arrCtx = getNewArrayContext(ctx);
		if (t.skip(']')) {
			return chainPath([...prev,{label: Lazy.literal('[]',VariableTypes.string),ctx: arrCtx, type: PathNodeType.entire_array}],t,arrCtx);
		}
		if (t.isNext('{')) {
			let nbt = parseNBT(t,arrCtx.toObjectContext());
			t.expectValue(']');
			return chainPath([...prev,{label: nbt,type: PathNodeType.array_predicate, ctx: arrCtx}],t,getNewArrayContext(ctx))
		}
		let n = parseExpression(t,VariableTypes.integer);
		t.expectValue(']');
		return chainPath([...prev,{label: n,type: PathNodeType.array_index, ctx: arrCtx}],t,getNewArrayContext(ctx));
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
			return chainPath([...prev,{label: nbt, type: PathNodeType.predicate, ctx}],t,ctx);
		}
		if (t.skip('/')) {
			let path = parsePathNode(t,ctx);
			return chainPath([...prev,...path],t,path[path.length-1].ctx);
		}
		return prev;
	}
}

export function toStringNBTPath(path: NBTPath, e: Evaluator) {
	let str = '';
	let lastWasNormal = false;
	for (let n of path) {
		switch (n.type) {
			case PathNodeType.root:
				str += toStringNBT(e.valueOf(n.label),e);
				break;
			case PathNodeType.normal:
				if (lastWasNormal) {
					str += '.';
				}
				str += e.valueOf(n.label);
				lastWasNormal = true;
				continue;
			case PathNodeType.array_index:
				str += '[' + e.stringify(n.label) + ']';
				break;
			case PathNodeType.array_predicate:
				str += '[' + toStringNBT(e.valueOf(n.label),e) + ']';
				break;
			case PathNodeType.entire_array:
				str += '[]';
				break;
			case PathNodeType.predicate:
				str += toStringNBT(e.valueOf(n.label),e);
				break;
		}
		lastWasNormal = false;
	}
	return str;
}

export interface NBTAccess {
	path: NBTPath,
	selector: NBTSelector
}

export interface NBTSelector {
	type: string,
	value: string
}

type NBTSourceCommand = (access: NBTAccess, e: Evaluator)=>Variable<any> | void


let _nbtMethods: MemberGroup<BaseMemberEntry<CommandGetter>,CommandGetter>
function getNBTAccessMethods()  {
	if (_nbtMethods) return _nbtMethods;
	class NBTAccessMethods extends MemberGroup<BaseMemberEntry<CommandGetter>,CommandGetter> {
		init(): BaseMemberEntry<CommandGetter>[] {
			return [
				{
					name: 'append',
					params: [
						{
							key: 'source',
							type: ValueTypeObject.custom('NBTSource',parseNBTSource)
						}
					],
					desc: "Appends the specified NBT source to a list NBT value",
					resolve: (src: Lazy<string>)=>(e)=>{
						return 'append ' + e.valueOf(src);
					}
				},
				{
					name: 'prepend',
					params: [
						{
							key: 'source',
							type: ValueTypeObject.custom('NBTSource',parseNBTSource)
						}
					],
					desc: "Inserts the specified NBT source to the start of a list NBT value",
					resolve: (src: Lazy<string>)=>(e)=>{
						return 'prepend ' + e.valueOf(src);
					}
				},
				{
					name: 'insert',
					params: [
						{
							key: 'index',
							type: VariableTypes.integer
						},
						{
							key: 'source',
							type: ValueTypeObject.custom('NBTSource',parseNBTSource)
						}
					],
					desc: "Inserts a NBT value at the specified index in a NBT list",
					resolve: (params)=>(e)=>{
						return 'insert ' + e.valueOf(params.index) + ' ' + e.valueOf(params.source)
					}
				}
			]
		}
		getSignatureString(member: BaseMemberEntry<CommandGetter>): string {
			throw new Error('Method not implemented.');
		}
	
	}
	return _nbtMethods = new NBTAccessMethods()
}

export function parseNBTAccess(t: TokenIterator, allowModify: boolean): NBTSourceCommand {
	if (allowModify) {
		if (t.skip('=')) {
			let value = parseNBTSource(t);
			return (s,e)=>{
				e.write('data modify ' + toStringNBTAccess(s,e) + ' set ' + e.valueOf(value));
			}
		}
		if (t.skip('+=')) {
			let value = parseNBTSource(t);
			return (s,e)=>{
				e.write('data modify ' + toStringNBTAccess(s,e) + ' merge ' + e.valueOf(value));
			}
		}
		if (t.skip('.')) {
			let nbtMethods = getNBTAccessMethods()
			let cmd = nbtMethods.parse(t);
			return (access,e)=>{
				if (cmd) {
					e.write('data modify ' + toStringNBTAccess(access,e) + ' ' + cmd.res(e));
				}
			}
		}
	}
	let scale = Lazy.literal(1,VariableTypes.double);
	if (t.skip('*')) {
		scale = parseSingleValue(t,VariableTypes.double);
	}
	return (a,e)=>{
		e.write('data get ' + toStringNBTAccess(a,e) + ' ' + e.valueOf(scale));
		return {type: VariableTypes.nbtAccess, value: a}
	}
}

export function parseNBTSource(t: TokenIterator): Lazy<string> {
	let access = parseFullNBTAccess(t);
	if (access) {
		let scale = Lazy.literal(1,VariableTypes.double);
		if (t.skip('*')) {
			scale = parseSingleValue(t,VariableTypes.double);
		}
		return e=>{
			let av = e.valueOf(access);
			return {value: 'from ' + toStringNBTAccess(av,e) + ' ' + e.valueOf(scale), type: VariableTypes.string};
		}
	} else {
		let value = parseNBTValue(t);
		return e=>{
			return {value: "value " + toStringValue(e.valueOf(value),e),type: VariableTypes.string};
		}
	}
}

export function parseFullNBTAccess(t: TokenIterator): Lazy<NBTAccess> {
	t.suggestHere('storage','block','self','@');
	if (t.isTypeNext(TokenType.identifier) && !t.isNext('storage','self','block')) {
		let v = t.expectVariable(VariableTypes.selector);
		let path = parseNBTPath(t,true,Registry.entities.createPathContext());
		let scale = Lazy.literal(1,VariableTypes.double);
		if (t.skip('*')) {
			scale = parseSingleValue(t,VariableTypes.double);
		}
		return e=>{
			return {value: {path,selector: {type: 'entity',value: Selector.toString(v,e)}}, type: VariableTypes.nbtAccess};
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
		ctx = Registry.tile_entities.createPathContext();
		holderType = 'block';
	} else if (t.isNext('@','self')) {
		let sel = parseSelector(t);
		selector = Selector.asLazyString(sel);
		ctx = Registry.entities.createPathContext(sel.type);
		holderType = 'entity';
	} else {
		return;
	}
	let path = parseNBTPath(t,true,ctx);
	if (!path) return;
	return e=>{
		return {value: {path,selector: {type: holderType,value: e.valueOf(selector)}},type: VariableTypes.nbtAccess};
	}
}

export function toStringNBTAccess(access: NBTAccess, e: Evaluator) {
	return access.selector.type + ' ' + access.selector.value + ' ' + toStringNBTPath(access.path,e)
}

/**
 * Parses any NBT value. Could be a compound, a list or any other primitive expression
 */
export function parseNBTValue(t: TokenIterator) {
	if (t.isNext('{')) {
		return parseNBT(t,new NBTContext([],undefined,undefined,true));
	} else if (t.isNext('[')) {
		return parseList(t,'[',']',()=>parseNBTValue(t));
	}
	return parseExpression(t);
}

/**
 * Sets a value to an NBT json object using the given path
 */
export function setValueInNBTByPath(path: NBTPath, nbt: any, value: any, e: Evaluator) {
	let parent = undefined;
	let lastIndexer = undefined;
	let current = nbt;
	let lastType: PathNodeType = undefined;
	for (let n of path) {
		switch (n.type) {
			case PathNodeType.normal:
				let v = e.valueOf(n.label);
				if (current === undefined) {
					parent[lastIndexer] = current = {};
				}
				parent = current;
				lastIndexer = v;
				current = current[v];
				break;
			case PathNodeType.array_index:
				e.error(undefined,"Indexed array access is not allowed when setting an NBT predicate");
				break;
			case PathNodeType.array_predicate:
				if (current === undefined) {
					parent[lastIndexer] = current = [{}];
				}
				let pred = e.valueOf(n.label);
				Object.assign(current[0],pred);
				parent = current;
				lastIndexer = 0;
				current = current[0];
				break;
			case PathNodeType.entire_array:
				e.error(undefined,"Entire array path is not allowed when setting an NBT predicate");
				break;
			case PathNodeType.root:
				Object.assign(current,e.valueOf(n.label));
				break;
			case PathNodeType.predicate:
				if (current === undefined) {
					parent[lastIndexer] = current = {};
				}
				Object.assign(current,e.valueOf(n.label));
				break;
		}
		lastType = n.type;
	}
	if (lastType == PathNodeType.normal) {
		parent[lastIndexer] = value;
	} else if (lastType == PathNodeType.predicate) {
		if (current === undefined) {
			current = {};
		}
		let res = Lazy.is(value) ? value(e) : {value, type: VariableTypes.any}
		if (res.type == VariableTypes.nbt) {
			if (isArray(res.value)) {
				console.log("Arrays cannot be merged to NBT")
			} else {
				Object.assign(current,res.value);
			}
		} else {
			Object.assign(current,res.value);
		}
	} else {
		console.log("Values cannot be merged to this path");
	}
}