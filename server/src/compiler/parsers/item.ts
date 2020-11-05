import { ValueParser, Parsers } from './parsers';
import { TokenIterator, TokenType } from '../tokenizer';
import { parseIdentifierOrVariable, VariableTypes } from '../util';
import { Lazy, parseSingleValue, UntypedLazy, Evaluator } from '../parser';
import { TagTypes } from '../tags';
import { CompletionItemKind } from 'vscode-languageserver';
import { toStringNBT, NBTPathContext } from '../nbt';
import { LazyCompoundEntry } from '../data_structs'
import { Registry } from '../registries';

export interface Item {
	slot?: number
	tagged?: boolean
	id: string
	count?: number
	nbt?: any
}

export class ItemParser extends ValueParser<Item,{tag?: boolean, nbt?: boolean, slot?: boolean, count?: boolean}> {
	id: string = "item"
	parse(t: TokenIterator, ctx: { tag?: boolean; nbt?: boolean; slot?: boolean, count?: boolean}): LazyCompoundEntry<Item> {
		let slot: Lazy<number>
		if (ctx.slot) {
			t.expectValue('#');
			slot = parseSingleValue(t,VariableTypes.int);
			t.expectValue(':');
		}
		t.suggestHere(...Registry.items.keys());
		let tagged = false;
		if (ctx.tag) {
			tagged = t.skip('#');
		}
		let id = parseIdentifierOrVariable(t);
		if (!id) return;
		let nbt: LazyCompoundEntry<any> = undefined;
		if (t.isNext('{') && (!ctx.nbt || ctx.nbt === true)) {
			nbt = Parsers.nbt.parse(t,{registry: "items",entry: id.value})
		}
		console.log(nbt);
		let count: Lazy<number>
		if ((ctx.count || ctx.slot) && t.skip('*')) {
			count = parseSingleValue(t,VariableTypes.int)
		}
		return e=>{
			let realId = e.valueOf(id.value);
			if (realId !== "" && !tagged && Registry.items.get(realId) === undefined) {
				e.error(id.range,"Unknown item ID " + realId);
			}
			if (tagged) {
				e.suggestAt(id.range,...e.tags.filter(t=>t.type == TagTypes.item).map(t=>({value: t.id, type: CompletionItemKind.Enum})))
				let tag = e.requireTag({type: TagTypes.item, token: {range: id.range, value: realId, type: TokenType.identifier}});
				realId = tag.loc.toString();
			}
			console.log('item nbt',nbt)
			return {id: realId,nbt: nbt ? nbt(e,{}) : undefined, tagged, slot: e.valueOf(slot), count: e.valueOf(count)}
		}
	}

	toCompoundData(item: Item) {
		return {Slot: item.slot, id: item.id, Count: item.count, tag: item.nbt}
	}

	toString(item: Item, e: Evaluator) {
		return toStringItem(item,e)
	}

	createPathContext(data: any): NBTPathContext {
		let slot = {}
		if (data.slot) {
			slot = {
				Slot: {
					desc: "The item's slot in the inventory",
					type: "byte"
				}
			}
		}
		return new NBTPathContext({
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
			},
			...slot
		})
	}
	
}

export function toStringItem(item: Item, e: Evaluator) {
	console.log('tostring item',item);
	return (item.tagged ? '#' : '') + item.id + (item.nbt ? toStringNBT(item.nbt,e) : '')
}