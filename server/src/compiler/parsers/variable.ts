import { ValueParser } from './parsers';
import { VariableType, getAsArray } from '../util';
import { TokenIterator } from '../tokenizer';
import { Evaluator, UntypedLazy, parseExpression, Lazy } from '../parser';
import { isArray } from 'util';
//import { getAsArray } from '../compiler'


export class VariableParser extends ValueParser<any,{type: string | VariableType<any> | VariableType<any>[]}> {
	id: string = "variable"
	parse<T>(t: TokenIterator, ctx: { type: string | VariableType<T> | VariableType<any>[]}): T | UntypedLazy<any> {
		let lazy = parseExpression(t,typeof ctx.type == 'string' ? VariableType.getById(ctx.type) : ctx.type);
		return e=>{
			return e.valueOf(lazy);
		}
	}
	toString(value: any, e: Evaluator, data: { type: string | VariableType<any> | VariableType<any>[] }): string {
		return e.stringify(Lazy.literal(value,typeof data.type == 'string' ? VariableType.getById(data.type) : getAsArray(data.type)[0]));
	}
	
	getLabel(ctx: {type: string | VariableType<any> | VariableType<any>[]}) {
		return typeof ctx.type == 'string' ? ctx.type : isArray(ctx.type) ? ctx.type.map(t=>t.name).join(' | ') : ctx.type.name
	}

	toCompoundData(value: any, data: {type: string | VariableType<any> | VariableType<any>[]}, e: Evaluator) {
		let type = typeof data.type == 'string' ? VariableType.getById(data.type) : getAsArray(data.type)[0];
		return type.toCompound ? type.toCompound(value,e) : value
	}
	
}