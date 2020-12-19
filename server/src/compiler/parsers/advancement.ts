import { DataContext, KeyValueContext, parseDataCompound } from '../data_structs';
import { Evaluator } from '../parser';
import { TokenIterator } from '../tokenizer';
import { ValueParser } from './parsers';


export class AdvancementPredicateParser extends ValueParser<any> {
	id: string = 'advancement'
	parse(t: TokenIterator, ctx: any, key?: string, dataCtx?: DataContext<any>) {
		if (t.suggestHere('true','false')) {
			return t.next().value === 'true';
		}
		return parseDataCompound(t,new KeyValueContext(undefined,{
			type: 'bool'
		}));
	}
	toString(value: any, e: Evaluator, data: any): string {
		return JSON.stringify(value);
	}
	
}