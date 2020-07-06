import { ValueParser, ParsingContext } from './parsers';
import { TokenIterator } from '../tokenizer';
import { parseFutureNBT, toStringNBT } from '../nbt';
import { Lazy, Evaluator } from '../parser';
import { PredicateManager } from '../predicates';
import { praseJson, JsonData, JsonContext, JsonTextType } from '../json_text';
import { parseDataCompound } from '../data_structs';


interface Options {
	predicate?: string
	json_type?: string
}

export class CompoundParser extends ValueParser<any,Options> {
	
	id = "compound"
	parse(t: TokenIterator, ctx: Options) {
		if (ctx.predicate) {
			let pred = PredicateManager.getPredicate(ctx.predicate)
			return parseDataCompound(t,JsonData,new JsonContext(pred));
		} else if (ctx.json_type) {
			return praseJson(t,JsonContext.of(JsonTextType.get(ctx.json_type)));
		}
	}

	toString(value: any, e: Evaluator): string {
		return toStringNBT(value,e);
	}
}