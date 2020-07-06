import { ValueParser, ParsingContext } from './parsers';
import { VariableType } from '../util';
import { TokenIterator } from '../tokenizer';
import { Evaluator, UntypedLazy, parseExpression, Lazy } from '../parser';


export class VariableParser extends ValueParser<any,{type: string | VariableType<any>}> {
	id: string = "variable"
	parse<T>(t: TokenIterator, ctx: { type: string | VariableType<T> }): T | UntypedLazy<any> {
		let lazy = parseExpression(t,[typeof ctx.type == 'string' ? VariableType.getById(ctx.type) : ctx.type]);
		return e=>{
			return e.valueOf(lazy);
		}
	}
	toString(value: any, e: Evaluator, data: { type: string | VariableType<any> }): string {
		return e.stringify(Lazy.literal(value,typeof data.type == 'string' ? VariableType.getById(data.type) : data.type));
	}
	
}