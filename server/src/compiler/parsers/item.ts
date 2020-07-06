import { ValueParser, ParsingContext, Parsers } from './parsers';
import { TokenIterator, TokenType } from '../tokenizer';
import { Registry } from '../registries';
import { parseIdentifierOrVariable, VariableTypes } from '../util';
import { Lazy, parseSingleValue, UntypedLazy, Evaluator } from '../parser';
import { TagTypes } from '../tags';
import { CompletionItemKind } from 'vscode-languageserver';
import { toStringNBT } from '../nbt';
import { LazyCompoundEntry } from '../data_structs'

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
			slot = parseSingleValue(t,VariableTypes.integer);
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
		let count: Lazy<number>
		if ((ctx.count || ctx.slot) && t.skip('*')) {
			count = parseSingleValue(t,VariableTypes.integer)
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
			return {id: realId,nbt: nbt ? nbt(e,undefined) : undefined, tagged, slot: e.valueOf(slot), count: e.valueOf(count)}
		}
	}

	toCompoundData(item: Item) {
		return {Slot: item.slot, id: item.id, Count: item.count, tag: item.nbt}
	}

	toString(item: Item, e: Evaluator) {
		return toStringItem(item,e)
	}
	
}

export function toStringItem(item: Item, e: Evaluator) {
	console.log('tostring item',item);
	return (item.tagged ? '#' : '') + item.id + (item.nbt ? toStringNBT(item.nbt,e) : '')
}