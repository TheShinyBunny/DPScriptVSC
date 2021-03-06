import { Expression } from '../ast';
import { GenContext } from '../generate';
import { Parser } from '../parser';
import { ProcessContext } from '../process';
import { Registry } from '../registry/registry';
import { TokenType } from '../tokenizer';
import { ResourceLocation } from '../utils';
import { NBT } from './nbt';
import { ValueType, ValueTypes } from './types';

export interface Item {
	tag?: boolean
	id: ResourceLocation
	nbt?: NBT
}

export interface ItemOptions {
	tag: boolean
}

export class ItemType extends ValueType<Item,ItemOptions> {
	getDetail(ctx: ItemOptions, key: string): string {
		return 'Item'
	}
	parse(p: Parser, ctx: ItemOptions): Item {
		let tag = false
		let id: ResourceLocation
		if (ctx.tag && p.isNext('#')) {
			p.nextToken()
			tag = true
			p.suggestHere(...Registry.itemTags.keys().map(k=>({value: k})))
		} else {
			p.suggestHere(...Registry.items.keys().map(k=>({value: k})))
		}
		
		if (!p.isTypeNext(TokenType.identifier)) return
		id = p.parseResourceLocation(Registry.items.keys())
		let nbt = ValueTypes.nbt.parse(p,{registry: 'item',entry: tag ? undefined : id});
		if (ctx.tag && tag) {
			if (!Registry.itemTags.has(id.path) && !Registry.items.has(id.toString())) {
				p.error(id.range,"Unknown item tag")
			}
		} else {
			if (!Registry.items.has(id.path) && !Registry.items.has(id.toString())) {
				p.error(id.range,"Unknown item")
			}
		}
		return {tag,id,nbt}
	}

	toString(value: Item, ctx: ItemOptions, gen: GenContext) {
		let str = ''
		if (value.tag) {
			str += '#'
		}
		str += value.id.toString()
		if (value.nbt) {
			str += ValueTypes.nbt.toString(value.nbt,{registry: 'item',entry: value.tag ? undefined : value.id},gen)
		}
		return str;
	}
	
	process(proc: ProcessContext, value: Item,ctx: ItemOptions) {
		/* if (ctx.tag && value.tag) {
			if (!Registry.itemTags.has(value.id.toString())) {
				proc.error(value.id.range,"Unknown item tag")
			}
		} else {
			if (!Registry.items.has(value.id.toString())) {
				proc.error(value.id.range,"Unknown item")
			}
		}
		ValueTypes.nbt.process(proc,value.nbt,{registry: 'item',entry: value.tag ? undefined : value.id}) */
	}

}