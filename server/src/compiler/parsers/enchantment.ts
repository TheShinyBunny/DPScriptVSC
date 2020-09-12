import { Lazy, UntypedLazy, Evaluator } from '../parser';
import { TokenIterator } from '../tokenizer';
import { Registry } from '../registries';
import { ValueParser } from './parsers';
import { parseIdentifierOrVariable, parseRomanOrInt, VariableTypes } from '../util';
import { LazyCompoundEntry } from '../data_structs'
import { NBTPathContext } from '../nbt';

export interface Enchantment {
	id: string
	lvl?: number
}

export class EnchantmentParser extends ValueParser<Enchantment,{checkTier?: boolean}> {
	
	id: string = "enchantment"
	parse(t: TokenIterator, ctx: {checkTier?: boolean}): LazyCompoundEntry<Enchantment> {
		t.suggestHere(...Registry.enchantments.entries().map(e=>({value: e.key, detail: "Max Level: " + e.value})));
		let id = parseIdentifierOrVariable(t);
		let trange = t.startRange();
		let tier = parseRomanOrInt(t);
		t.endRange(trange);
		return e=>{
			let idv = e.valueOf(id.value,'protection');
			if (idv) {
				let max = Registry.enchantments.get(idv);
				let tv = e.valueOf(tier);
				if (max === undefined) {
					e.error(id.range,"Unknown enchantment '" + idv + "'");
				} else if (ctx.checkTier && tv > max) {
					e.warn(trange,"The maximum level of " + idv + " is " + max);
				}
				return {id: idv, lvl: tv};
			}
		}
	}

	toString(value: Enchantment): string {
		return value.id + ' ' + value.lvl
	}

	createPathContext(data: any): NBTPathContext {
		return new NBTPathContext({
			id: {
				type: "string"
			},
			lvl: {
				type: "int"
			}
		})
	}
}