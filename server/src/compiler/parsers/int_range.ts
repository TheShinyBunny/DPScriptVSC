import { DataContext, LazyCompoundEntry } from '../data_structs';
import { Evaluator, parseExpression, RangedLazy } from '../parser';
import { TokenIterator } from '../tokenizer';
import { NumberRange, Ranges, VariableTypes } from '../util';
import { ValueParser } from './parsers';


export class IntRangeParser extends ValueParser<NumberRange> {
	id: string = 'int_range'
	parse(t: TokenIterator, ctx: any, key?: string, dataCtx?: DataContext<any>): LazyCompoundEntry<NumberRange> {
		let left: RangedLazy<number> = undefined;
		if (!t.isNext('..')) {
			left = parseExpression(t,VariableTypes.int)
		}
		if (t.expectValue('..')) {
			let right = parseExpression(t,VariableTypes.int,false);
			return e=>{
				return {min: e.valueOf(left,undefined),max: e.valueOf(right,undefined)}
			}
		}
	}
	
	toString(value: NumberRange, e: Evaluator, data: any): string {
		return Ranges.toString(value);
	}
	
}