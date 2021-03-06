import { Expression, ValueExpression } from '../ast';
import { GenContext } from '../generate';
import { Parser } from '../parser';
import { Registry } from '../registry/registry';
import { Token, TokenType } from '../tokenizer';
import { ResourceLocation, toStringResourceLocation } from '../utils';
import { Value, ValueType, ValueTypes } from './types';


export type NBT = NBTEntry[]

export interface NBTEntry {
	key: Token
	value: Value<any> | Expression<any>
}

export interface NBTOptions {
	ctx?: NBTContext
	registry?: NBTRegistryType
	entry?: string | ResourceLocation
	valueType?: string
	tags?: NBTPropertyCompound
}

export class NBTType extends ValueType<NBT,NBTOptions> {
	getDetail(ctx: NBTOptions, key: string): string {
		return ctx.registry ? 'NBT<' + (ctx.entry ? toStringResourceLocation(ctx.entry) : ctx.registry) + '>' : ctx.valueType ? 'Map<string,' + ctx.valueType + '>' : key || 'NBT'
	}
	parse(p: Parser, ctx?: NBTOptions): NBT {
		// todo: implement ctx.valueType with a map of string to valueType entries
		return parseNBT(p,ctx ? ctx.registry ? new RegistryNBTContext(ctx.registry,ctx.entry) : ctx.ctx : undefined)
	}

	getNBTContext(ctx: NBTOptions,key?: string) {
		return ctx ? ctx.registry ? new RegistryNBTContext(ctx.registry,ctx.entry) : ctx.ctx : undefined
	}

	toString(value: NBT, ctx: NBTOptions, gen: GenContext): string {
		return '{' + value.map(e=>{
			return e.key.value + ': ' + gen.stringify(e.value)
		}).join(',') + '}'
	}
	
}

export class NBTValueType extends ValueType<Value<any> | Expression<any>> {
	getDetail(ctx: any, key: string): string {
		return 'NBTValue'
	}
	parse(p: Parser): Value<any> | Expression<any> {
		if (p.isNext('{')) {
			return <Value<any>>{type: ValueTypes.nbt, value: ValueTypes.nbt.parse(p)}
		} else if (p.isNext('[')) {
			let lt = ValueTypes.list.configured({item: ValueTypes.nbtValue});
			return lt.of(lt.parse(p,{}))
		}
		return p.parseExpression()
	}
	
}

export type NBTRegistryType = 'entity' | 'tile_entity' | 'item';

export abstract class NBTContext {

	abstract getProperties(): NBTPropertyCompound;

	abstract parseProperty(p: Parser, key: Token): Value<any> | Expression<any>;

	abstract getDefaultPropertyValue(key: Token): Value<any> | Expression<any>

	isStrict(): boolean {
		return false
	}

	isArray() {
		return false
	}

}

export class ListNBTContext extends NBTContext {

	constructor(public itemType: ValueType<any>) {
		super()
	}

	getProperties(): NBTPropertyCompound {
		return {}
	}
	parseProperty(p: Parser, key: Token): Value<any> | Expression<any> {
		return undefined
	}
	getDefaultPropertyValue(key: Token): Value<any> | Expression<any> {
		return undefined
	}
	isArray() {
		return true
	}
}

export class SimpleNBTContext extends NBTContext {
	
	constructor(public props: NBTPropertyCompound, public strict: boolean = false) {
		super()
	}

	getProperties(): NBTPropertyCompound {
		return this.props
	}
	parseProperty(p: Parser, key: Token): Value<any> | Expression<any> {
		let prop = this.getProperties()[key.value]
		if (prop) {
			let t = ValueType.get(prop.type);
			if (!t) return
			if (prop.config) {
				t = t.configured(prop.config || {})
			}
			let v = t.parse(p,{})
			if (v === undefined) {
				p.error(p.token.range,"Expected value of type " + t.getDetail({},key.value))
				return
			}
			return t.of(v)
		} else {
			if (this.strict) {
				p.error(key.range,"Unknown property " + key.value)
			}
			return ValueTypes.nbtValue.parse(p)
		}
	}
	getDefaultPropertyValue(key: Token): Value<any> | Expression<any> {
		let prop = this.getProperties()[key.value]
		if (prop && prop.default !== undefined) {
			return {type: ValueType.get(prop.type),value: prop.default}
		}
	}

	isStrict() {
		return this.strict
	}
}

export class RegistryNBTContext extends SimpleNBTContext {

	constructor(public registry: NBTRegistryType, public entry: string | ResourceLocation, public strict: boolean = false) {
		super(getNBTProps(registry,entry),strict)
	}
}

function getNBTProps(registry: NBTRegistryType, entry?: string | ResourceLocation): NBTPropertyCompound {
	let reg = Registry.getNBTRegistry(registry)
	if (!reg) return {}
	if (entry) {
		let id: string
		if (entry instanceof ResourceLocation) {
			id = entry.path
		} else {
			id = entry
		}
		if (reg.has(id)) {
			return reg.entries[id]
		}
	}
	return reg.all
}

export interface NBTProperty {
	desc?: string
	type: string
	config?: any
	path?: string[]
	default?: any
}

export type NBTPropertyCompound = {[key: string]: NBTProperty}

export function parseNBT(p: Parser, ctx?: NBTContext): NBT {
	if (p.isNext('{')) {
		p.nextToken();
		let entries: NBT = []
		while (p.hasNext()) {
			if (ctx) {
				let props = ctx.getProperties()
				p.suggestHere(...Object.keys(props).map(k=>({value: k, detail: ValueType.getDetailOf(props[k].type,props[k].config || {},k),desc: props[k].desc})))
			}
			let k = p.expectType(TokenType.identifier);
			if (k.isValid()) {
				let prop = ctx.getProperties()[k.value]
				if (prop) {
					p.setHover(k.range,[{language: 'dpscript',value: '(property) ' + k.value + ': ' + ValueType.getDetailOf(prop.type,prop.config || {},k.value)},prop.desc])
				}
			}

			let value: Value<any> | Expression<any>
			if (p.isNext(':')) {
				p.nextToken()
				value = ctx ? ctx.parseProperty(p,k) : ValueTypes.nbtValue.parse(p)
				if (!value) {
					p.skipUntil(',','}')
				}
			} else {
				let def = ctx.getDefaultPropertyValue(k);
				if (def) value = def
				else {
					p.error(p.token.range,"Expected :")
				}
			}
			if (value) {
				entries.push({key: k, value})
			}
			if (!p.isNext(',')) {
				break
			}
			p.nextToken()
		}
		p.expectValue('}')
		return entries
	}
}