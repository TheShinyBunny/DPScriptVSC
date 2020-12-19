import { ValueParser } from './parsers';
import { TokenIterator } from '../tokenizer';
import { parseFutureNBT, toStringNBT } from '../nbt';
import { Lazy, Evaluator } from '../parser';
import { praseJson, JsonContext, JsonTextType } from '../json_text';
import { parseDataCompound, CompoundItem, DataProperty, KeyValueContext } from '../data_structs';
import { Registry } from '../registries';


interface Options {
	predicate?: string
	json_type?: string
	keys?: string
	values?: DataProperty
}

export class CompoundParser extends ValueParser<any,Options> {
	
	id = "compound"
	parse(t: TokenIterator, ctx: Options) {
		if (ctx.predicate) {
			let pred: CompoundItem<DataProperty>
			if (typeof ctx.predicate == 'string') {
				pred = Registry.predicate_compounds.get(ctx.predicate);
			} else {
				pred = ctx.predicate;
			}
			return parseDataCompound(t,new JsonContext(pred));
		} else if (ctx.json_type) {
			return praseJson(t,JsonContext.of(JsonTextType.get(ctx.json_type)));
		}
		if (!ctx.keys || !ctx.values) return
		return parseDataCompound(t,new KeyValueContext(ctx.keys,ctx.values));
	}

	toString(value: any, e: Evaluator): string {
		return toStringNBT(value,e);
	}

	getLabel(data: Options) {
		return data.predicate ? 'predicate<' + (typeof data.predicate == 'string' ? data.predicate : '...') + '>' : data.json_type ? 'json_text' : 'compound'
	}
}