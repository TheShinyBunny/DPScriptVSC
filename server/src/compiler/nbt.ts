
import { VariableTypes, parseIdentifierOrVariable, escapeString, parseLocation, toStringPos, Variable, VariableType, MemberGroup, BaseMemberEntry, CommandGetter, ValueTypeObject } from './util';
import { TokenIterator, Tokens, Token, TokenType, Tokenizer } from './tokenizer';
import { DataStructureType, parseDataCompound, DataProperty, DataContext, setTagValue, getDataPropHover, getValueInPath, CompoundItem, LazyCompoundEntry, validateDataProperty, BaseCompoundRegistry } from './data_structs';
import { Lazy, Evaluator, parseExpression, parseSingleValue } from './parser';
import { CompletionItemKind, Color, TextEdit } from 'vscode-languageserver';
import { Selector, parseSelector } from './selector';

import * as globalMixins from './registries/global_mixins.json';
import { isArray } from 'util';
import { Registry } from './registries';
import { SemanticType, SemanticModifier } from '../server';
import { Parsers, ValueParser } from './parsers/parsers';

let globalMixinRegistry: {[name: string]: NBTEntry} = {}

export function initNBTRegistries() {
	Object.keys(globalMixins.mixins).forEach(k=>resolveEntry(k,globalMixins.mixins[k],'global_mixins',globalMixins,{},globalMixinRegistry,true));
}

export function resolveNBTRegistry(name: string, reg: NBTRegistryBuilder): NBTRegistry {
	let entries: {[k: string]: NBTEntry} = {}
	let mixins: {[k: string]: NBTEntry} = {}
	for (let e of Object.keys(reg.values)) {
		resolveEntry(e,reg.values[e],name,reg,entries,mixins);
	}
	return new NBTRegistry(entries,entries.base,reg.strict,name);
}

function resolveEntry(key: string, entry: NBTRegistryEntry, regName: string, reg: NBTRegistryBuilder, entriesSoFar: {[id: string]: NBTEntry}, mixinsSoFar: {[id: string]: NBTEntry}, isMixin?: boolean): NBTEntry {
	let tag = new NBTEntry(key,entry.tags || {});
	tag.mixin = isMixin;
	if (entry.extends) {
		let ext = isMixin ? mixinsSoFar[entry.extends] : entriesSoFar[entry.extends];
		if (!ext) {
			if (isMixin && reg.mixins[entry.extends]) {
				ext = resolveEntry(entry.extends,reg.mixins[entry.extends],regName,reg,entriesSoFar,mixinsSoFar,true);
			} else if (reg.values[entry.extends]) {
				ext = resolveEntry(entry.extends,reg.values[entry.extends],regName,reg,entriesSoFar,mixinsSoFar,false);
			} else {
				console.log("UNKNOWN EXTENDS: " + entry.extends + " for " + regName + ':' + key);
			}
		}
		if (ext) {
			tag.extends.push(ext);
		}
	} else if (!isMixin && key !== 'base') {
		let base = entriesSoFar.base
		if (!base) {
			base = new NBTEntry(regName,reg.base);
			entriesSoFar.base = base;
		}
		tag.extends.push(base);
	}
	if (entry.mixins) {
		for (let m of entry.mixins) {
			
			if (m.startsWith('global.')) {
				let n = m.substr('global.'.length);
				let tags = globalMixinRegistry[n];
				if (tags) {
					tag.extends.push(tags)
				} else {
					console.log("UNKNOWN GLOBAL MIXIN: " + n + " for " + regName + ':' + key);
				}
			} else {
				let mix = mixinsSoFar[m];
				if (!mix) {
					if (reg.mixins[m]) {
						mix = resolveEntry(m,reg.mixins[m],regName,reg,entriesSoFar,mixinsSoFar,true);
					} else {
						console.log("UNKNOWN MIXIN: " + m + " for " + regName + ':' + key)
					}
				}
				tag.extends.push(mix);
			}
		}
	}
	if (isMixin) {
		mixinsSoFar[key] = tag;
	} else {
		entriesSoFar[key] = tag;
	}
	return tag;
}

export interface NBTRegistryEntry {
	tags?: CompoundItem<DataProperty>
	mixins?: string[]
	extends?: string
	abstract?: boolean
}

export class NBTEntry {
	extends: NBTEntry[] = []
	abstract: boolean
	mixin: boolean

	constructor(public key: string, public tags: CompoundItem<DataProperty>) {
		
	}

	get(key: string): DataProperty {
		let p = this.tags[key];
		if (p) return p;
		for (let e of this.extends) {
			p = e.get(key);
			if (p) return p;
		}
	}

	allProperties(): CompoundItem<DataProperty> {
		return {...(this.tags || {}), ...this.extends.reduce((a,c)=>({...a,...c.allProperties()}),{})}
	}
}

export class NBTRegistry extends BaseCompoundRegistry<NBTEntry,DataProperty> {
	
	
	constructor (items: {[id: string]: NBTEntry}, public base: NBTEntry, public strict: boolean, public name: string) {
		super(name,items)
	}

	createContext(entry?: string, write: boolean = true) {
		return new NBTContext(this,this.get(entry),write);
	}

	createPathContext(entry?: string) {
		return new NBTPathContext(this.getTags(entry).allProperties()).strict(this.strict);
	}

	getTags(entry: string): NBTEntry {
		if (!entry) return this.base;
		let e = this.get(entry);
		return e || this.base;
	}
	
	getCompounds(): { [k: string]: CompoundItem<DataProperty>} {
		let c: {[k: string]: CompoundItem<DataProperty>} = {};
		for (let e of this.entries()) {
			c[e.key] = e.value.tags;
		}
		return c;
	}
}

export interface NBTRegistryBuilder {
	strict: boolean
	base: CompoundItem<DataProperty>
	values: {[id: string]: NBTRegistryEntry}
	mixins: {[id: string]: NBTRegistryEntry}
}

export const NBT: DataStructureType<DataProperty> = {
	varType: ()=>VariableTypes.nbt,
	toString: toStringNBT,
	propTypeDetail: (k,prop)=>{
		return buildPropType(prop.type,prop.context || {},k);
	}
}

function buildPropType(type: string, ctx: any, name?: string) {
	let p: ValueParser<any> = Parsers[type];
	if (p) {
		return p.getLabel(ctx);
	}
	// let res: string = type;
	// if (res == 'list') {
	// 	res += '<' + buildPropType(ctx.item,ctx.context || {}) + '>';
	// } else if (res == 'nbt') {
	// 	let reg = false;
	// 	if (ctx.registry) {
	// 		res = ctx.registry;
	// 		reg = true;
	// 	}
	// 	if (ctx.tags) {
	// 		let s = '{' + Object.keys(ctx.tags).map(t=>{
	// 			return t + ': ' + buildPropType(ctx.tags[t].type,ctx.tags[t].context || {},t);
	// 		}).join(', ') + '}';
	// 		if (reg) {
	// 			res += s;
	// 		} else {
	// 			res = s;
	// 		}
	// 	}
	// } else if (res == 'indexed_identifier') {
	// 	res = name || 'id';
	// } else if (res == 'compound') {
	// 	res = ctx.json_type ? 'json' : 'compound';
	// }
	// return res;
}

export class NBTContext extends DataContext<DataProperty> {
	
	props: CompoundItem<DataProperty> = {}

	constructor(public reg?: NBTRegistry, public entry?: NBTEntry, public write?: boolean) {
		super();
		this.strict = reg ? reg.strict : false;
	}

	withCustomProps(props: CompoundItem<DataProperty>) {
		this.props = props;
		return this;
	}

	getProperty(key: string): DataProperty {
		if (this.entry) {
			let p = this.entry.get(key);
			if (p) return p
		}
		if (this.props) {
			return this.props[key];
		}
	}
	getKnownProperties(): CompoundItem<DataProperty> {
		let res = {}
		if (this.entry) {
			res = {...res,...this.entry.allProperties()};
		}
		return {...res,...this.props};
	}

	varType() {
		return VariableTypes.nbt;
	}
}
export function parseNBT(t: TokenIterator, ctx?: NBTContext) {
	return parseDataCompound(t,NBT,ctx);
}

export function parseFutureNBT(t: TokenIterator, futureCtx: LazyCompoundEntry<NBTContext>): LazyCompoundEntry<any> {
	let ti = t.collectInsideBrackets('{','}',t.ctx.snapshot());
	return (e,comp)=>{
		let nbt = parseNBT(ti,futureCtx(e,comp));
		ti.reset();
		return e.valueOf(nbt);
	}
}

export function toStringNBT(obj: any,ev: Evaluator): string {
	if (isArray(obj)) return toStringValue(obj,ev);
	let entries = Object.keys(obj).map(k=>({key: k, value: obj[k]}));
	return '{' + entries.filter(e=>e.value !== undefined).map(e=>{
		return e.key + ':' + toStringValue(e.value,ev)
	}) + '}';
}

export function toStringValue(value: any, e: Evaluator) {
	if (value === undefined) return '';
	if (typeof value == 'number') return value.toString();
	if (typeof value == 'string') return '"' + escapeString(value,/[\\"]/g) + '"';
	if (typeof value == 'boolean') return value + '';
	if (isArray(value)) {
		let res = '[';
		let arrType: string;
		let inside = value.map(i=>{
			let v = i;
			let type: VariableType<any>;
			if (Lazy.is(i)) {
				let res = i(e);
				v = res.value;
				type = res.type;
			}
			if (!arrType && v !== undefined) {
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
	if (typeof value == 'function') return toStringValue(e.valueOf(value),e)
	if (typeof value == 'object') return toStringNBT(value,e);
	return value;
}

function getArrType(value: any, type?: VariableType<any>) {
	if (Number.isInteger(value)) return 'I';
	if (typeof value == 'number') {
		return type == VariableTypes.int ? 'I' : undefined;
	}
	if (value.suffix && value.num !== undefined) {
		if (value.suffix == 'L') return 'L';
		if (value.suffix == 'b') return 'B';
	}
}

/*
function parseNBTTag(t: TokenIterator, key: string, tag: DataProperty, nbt: any, ctx: NBTContext) {
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
		let val = parseType(t,key,tag.type,tag.context || {},ctx,nbt);
		if (val) {
			setTag(tag,nbt,val);
		}
		if (ctx.resolveEntryFrom && ctx.resolveEntryFrom == key && ctx.futureEval) {
			let en = nbt[ctx.resolveEntryFrom];
			let v = ctx.futureEval.valueOf(en);
			ctx.resolveEntryFrom = undefined;
			ctx.entry = v;
			ctx.properties = ctx.reg ? ctx.reg.getTags(v) : {}
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
			return parseNBT(t,newCtx);
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
				if (r > 127 || r < -128) {
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
			if (typeof values == 'function') {
				values = values()
			}
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
	if (value !== undefined) {
		setTagValue(tag,nbt,value);
	}
}


*/

const EFFECT_TAGS: CompoundItem<DataProperty> = {
	Id:{
		desc: "The effect's ID",
		type: "int"
	},
	Duration: {
		desc: "The effect's duration in ticks",
		type: "int"
	},
	Amplifier: {
		desc: "The effect's tier. 0 is tier I, 1 is tier II, etc.",
		type: "int"
	},
	ShowParticles: {
		desc: "True if particles are visible for this effect",
		type: "bool"
	}
}

const HORSE_VARIANT_TAGS: CompoundItem<DataProperty> = {
	color: {
		desc: "The horse base color",
		type: "indexed_identifier",
		context: {
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
	marking: {
		desc: "The horse variant decoration",
		type: "indexed_identifier",
		context: {
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
}

const XYZ_TAGS: CompoundItem<DataProperty> = {
	X: {
		type: "int"
	},
	Y: {
		type: "int"
	},
	Z: {
		type: "int"
	}
}

const TROPICAL_FISH_VARIANT_TAGS: CompoundItem<DataProperty> = {
	pattern: {
		desc: "The tropical fish pattern type",
		type: "indexed_identifier",
		context: {
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
	BodyColor: {
		type: "color_id",
		desc: "The color of the tropical fish body"
	},
	PatternColor: {
		type: "color_id",
		desc: "The color of the tropical fish pattern"
	}
}

const GLOBAL_POS_TAGS: CompoundItem<DataProperty> = {
	pos: {
		type: "list",
		context: {
			item: "int"
		},
		desc: "The XYZ values of the position, stored as 3 integers"
	},
	dimension: {
		type: "enum",
		context: {
			values: [
				"overworld",
				"the_nether",
				"the_end"
			]
		},
		desc: "The dimension this position is in"
	}
}

const ITEMSTACK_TAGS: CompoundItem<DataProperty> = {
	id: {
		type: "string",
		desc: "The item's ID"
	},
	Count: {
		type: "int",
		desc: "The amount of this item in the item stack"
	},
	tag: {
		type: "nbt",
		desc: "NBT Tag of the item. Contains some tags for specific use and can save custom NBT.",
		context: {
			registry: "items",
			strict: false
		}
	}
}

const ITEM_WITH_SLOT_TAGS: CompoundItem<DataProperty> = {
	...ITEMSTACK_TAGS,
	Slot: {
		type: "byte",
		desc: "The slot ID the item is in"
	}
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
	isStrict: boolean = false;
	listItem: NBTPathContext
	isEnd: boolean = false;
	propMapper: (k: string)=>string
	
	constructor(public props: CompoundItem<DataProperty>) {
		
	}

	static create(registry: NBTRegistry, entry?: string) {
		return new NBTPathContext(entry ? registry.getTags(entry).allProperties() : registry.base.allProperties()).strict(registry.strict);
	}
	
	strict(s: boolean = true) {
		this.isStrict = s;
		return this;
	}

	list(item: NBTPathContext) {
		this.listItem = item;
		return this;
	}

	end() {
		this.isEnd = true;
		return this;
	}

	toObjectContext() {
		let c = new NBTContext().withCustomProps(this.props);
		c.strict = this.isStrict;
		return c;
	}

	mapProps(mapper: (k: string)=>string) {
		this.propMapper = mapper;
		return this;
	}

	matches(other?: NBTPathContext) {
		if (!other) return true;
		if (!this.isStrict && !other.isStrict) return true;
		return !this.listItem == !other.listItem && this.isEnd == other.isEnd
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
		t.suggestHere(...Object.keys(ctx.props).map(p=>({value: p,detail: ctx.props[p].type, desc: ctx.props[p].desc, kind: CompletionItemKind.Property})))
	}
	let n: Token;
	if (t.isTypeNext(TokenType.string,TokenType.identifier)) {
		n = t.next();
	} else {
		t.errorNext('Expected path node to be a string or an identifier!');
		return [{label: undefined, type: PathNodeType.invalid, ctx: new NBTPathContext({})}]
	}
	t.ctx.editor.addSemantic(n.range,SemanticType.enumMember,SemanticModifier.readonly)
	let prop = ctx.props[n.value];
	if (ctx.isStrict && !prop) {
		t.error(n.range,"Unknown NBT property");
		return [{label: undefined, type: PathNodeType.invalid,ctx: new NBTPathContext({})}];
	}
	if (prop) {
		t.ctx.editor.setHover(n.range,getDataPropHover(n.value,prop,NBT));
	}
	let newCtx = getNewContext(ctx,prop);
	if (prop && prop.path) {
		return prop.path.map(n=>createPathNode(n,newCtx));
	}
	return [{label: Lazy.literal(n.value,VariableTypes.string),type: PathNodeType.normal, ctx: newCtx}]
}

function createPathNode(node: any, ctx: NBTPathContext): PathNode {
	if (isArray(node)) {
		if (typeof node[0] == 'number') {
			return {label: Lazy.literal(node[0],VariableTypes.int), ctx, type: PathNodeType.array_index}
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
		return getNBTCtxForType(prop.type,prop.context || {});
	}
	if (!ctx.isStrict) {
		return new NBTPathContext({});
	}
	return new NBTPathContext({}).end();
}

export function getNBTCtxForType(type: string, typeCtx: any): NBTPathContext {
	let p: ValueParser<any> = Parsers[type];
	if (p) {
		let ctx = p.createPathContext(typeCtx);
		if (!ctx) {
			console.log('parser ' + p.id + ' returned an undefined context');
			return new NBTPathContext({}).end()
		}
		return ctx;
	}
	return new NBTPathContext({}).end()
	/* switch (type) {
		case 'nbt':
			if (typeCtx) {
				if (typeCtx.tags) {
					if (typeCtx.registry) {
						return Registry.getNBTRegistry(typeCtx.registry).createPathContext();
					} else {
						return new NBTPathContext(typeCtx.tags).strict(typeCtx.strict);
					}
				} else if (typeCtx.registry) {
					return Registry.getNBTRegistry(typeCtx.registry).createPathContext(typeCtx.entry);
				}
			}
			break;
		case 'item':
			return new NBTPathContext(typeCtx.slot ? ITEM_WITH_SLOT_TAGS : ITEMSTACK_TAGS).strict();
		case 'list':
			return new NBTPathContext({}).list(getNBTCtxForType(typeCtx.item,typeCtx.context));
		case 'effect':
			return new NBTPathContext(EFFECT_TAGS).strict();
		case 'blockstate':
			return new NBTPathContext({});
		case 'block':
			return new NBTPathContext({
				Name: {
					desc: "The block ID",
					type: "string"
				},
				Properties: {
					desc: "Key-value pairs of the block state",
					type: "blockstate"
				}
			}).strict()
		case 'xyz':
			return new NBTPathContext(XYZ_TAGS).strict()
		case 'global_pos':
			return new NBTPathContext(GLOBAL_POS_TAGS).strict()
		case 'uuid':
			return new NBTPathContext({}).list(new NBTPathContext({}).end());
		default:
			return new NBTPathContext({}).end()
	} */
}



function chainPath(prev: NBTPath, t: TokenIterator, ctx: NBTPathContext): NBTPath {
	if (t.skip('[')) {
		if (!ctx.listItem && ctx.isStrict) {
			t.error(t.lastPos,"This node is not an array!");
		}
		let arrCtx = ctx.listItem || new NBTPathContext({}).end()
		if (t.skip(']')) {
			return chainPath([...prev,{label: Lazy.literal('[]',VariableTypes.string),ctx: arrCtx, type: PathNodeType.entire_array}],t,arrCtx);
		}
		if (t.isNext('{')) {
			let nbt = parseNBT(t,arrCtx.toObjectContext());
			t.expectValue(']');
			return chainPath([...prev,{label: nbt,type: PathNodeType.array_predicate, ctx: arrCtx}],t,arrCtx)
		}
		let n = parseExpression(t,VariableTypes.int);
		t.expectValue(']');
		return chainPath([...prev,{label: n,type: PathNodeType.array_index, ctx: arrCtx}],t,arrCtx);
	} else {
		if (t.isNext('{','/')) {
			if (ctx.listItem) {
				t.errorNext('This node can only be accessed as an array');
			} else if (ctx.isEnd) {
				t.errorNext('This path does not lead to an array or object, thus cannot be accessed.');
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
	let nextMapper: (k: string)=>string
	for (let n of path) {
		switch (n.type) {
			case PathNodeType.root:
				str += toStringNBT(e.valueOf(n.label),e);
				break;
			case PathNodeType.normal:
				if (lastWasNormal) {
					if (nextMapper) {
						let v = e.valueOf(n.label);
						str += nextMapper(v);
						continue
					}
					str += '.';
				}
				let s = e.valueOf(n.label);
				if (n.ctx.propMapper) {
					nextMapper = n.ctx.propMapper;
				} else {
					str += s;
				}
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
							type: VariableTypes.int
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

export function parseNBTAccess(t: TokenIterator, allowModify: boolean, ctx: NBTPathContext): NBTSourceCommand {
	if (allowModify) {
		if (t.skip('=')) {
			let value = parseNBTSource(t,ctx);
			return (s,e)=>{
				e.write('data modify ' + toStringNBTAccess(s,e) + ' set ' + e.valueOf(value));
			}
		}
		if (t.skip('+=')) {
			if (ctx.isEnd || ctx.listItem) {
				t.error(t.lastPos,"Only NBT objects can be merged");
			}
			let value = parseNBTSource(t);
			return (s,e)=>{
				e.write('data modify ' + toStringNBTAccess(s,e) + ' merge ' + e.valueOf(value));
			}
		}
		if (t.skip('.')) {
			let nbtMethods = getNBTAccessMethods()
			let cmd = nbtMethods.parse(t,true);
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

export function parseNBTSource(t: TokenIterator,ctx?: NBTPathContext): Lazy<string> {
	let access = parseFullNBTAccess(t,ctx);
	if (access) {
		return e=>{
			let av = e.valueOf(access);
			return {value: 'from ' + toStringNBTAccess(av,e), type: VariableTypes.string};
		}
	} else {
		let range = t.startRange();
		let value = parseNBTValue(t);
		t.endRange(range);
		return e=>{
			let r = Lazy.is(value) ? value(e) : value;
			if ((isArray(r) && !ctx.listItem) || (r.type == VariableTypes.nbt && ctx.isEnd) || (r.type != VariableTypes.nbt && !ctx.isEnd)) {
				e.error(range,"Incompatible NBT values");
			}
			return {value: "value " + toStringValue(e.valueOf(value),e),type: VariableTypes.string};
		}
	}
}

export function parseFullNBTAccess(t: TokenIterator, resultCtx?: NBTPathContext): Lazy<NBTAccess> {
	t.suggestHere('storage','block','self','@');
	if (t.isTypeNext(TokenType.identifier) && !t.isNext('storage','self','block','true','false','this')) {
		let v = t.expectVariable(VariableTypes.selector);
		let path = parseNBTPath(t,true,Registry.entities.createPathContext());
		if (!path) return
		let scale = Lazy.literal(1,VariableTypes.double);
		if (t.skip('*')) {
			scale = parseSingleValue(t,VariableTypes.double);
		}
		if (!path[path.length-1].ctx.matches(resultCtx)) {
			t.error(t.lastPos,"Incompatible NBT values");
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
		ctx = new NBTPathContext({});
		holderType = 'storage';
	} else if (t.skip('block')) {
		let loc = parseLocation(t);
		selector = e=>({value: toStringPos(loc,e),type: VariableTypes.string});
		ctx = Registry.tile_entities.createPathContext().strict(false);
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
	if (!path[path.length-1].ctx.matches(resultCtx)) {
		t.error(t.lastPos,"Incompatible NBT values");
	}
	return e=>{
		return {value: {path,selector: {type: holderType,value: e.valueOf(selector)}},type: VariableTypes.nbtAccess};
	}
}

export function toStringNBTAccess(access: NBTAccess, e: Evaluator) {
	let path = toStringNBTPath(access.path,e);
	return access.selector.type + ' ' + access.selector.value + ' ' + path;
}

/**
 * Parses any NBT value. Could be a compound, a list or any other primitive expression
 */
export function parseNBTValue(t: TokenIterator) {
	if (t.isNext('{')) {
		return parseNBT(t,new NBTContext(undefined,undefined,true));
	} else if (t.isNext('[')) {
		return Parsers.list.parse(t,{item: Parsers.nbt_value});
	}
	return parseExpression(t,[VariableTypes.int,VariableTypes.double,VariableTypes.string,VariableTypes.boolean]);
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