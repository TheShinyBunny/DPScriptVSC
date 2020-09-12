import { ValueParser } from './parsers';
import { TokenIterator } from '../tokenizer';
import { parseFutureNBT, toStringNBT } from '../nbt';
import { Lazy, Evaluator } from '../parser';
import { praseJson, JsonData, JsonContext, JsonTextType } from '../json_text';
import { parseDataCompound, CompoundItem, DataProperty } from '../data_structs';
import { Registry } from '../registries';


interface Options {
	predicate?: string
	json_type?: string
}

export class CompoundParser extends ValueParser<any,Options> {
	
	id = "compound"
	parse(t: TokenIterator, ctx: Options) {
		if (ctx.predicate) {
			let pred: CompoundItem<DataProperty>
			if (typeof ctx.predicate == 'string') {
				pred = Registry.predicate_compounds.get(ctx.predicate);
			}
			return parseDataCompound(t,JsonData,new JsonContext(pred));
		} else if (ctx.json_type) {
			return praseJson(t,JsonContext.of(JsonTextType.get(ctx.json_type)));
		}
	}

	toString(value: any, e: Evaluator): string {
		return toStringNBT(value,e);
	}

	getLabel(data: Options) {
		return data.predicate ? 'predicate<' + data.predicate + '>' : data.json_type ? 'json_text' : ''
	}
}