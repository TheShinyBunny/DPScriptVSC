import { ValueParser } from './parsers';
import { TokenIterator } from '../tokenizer';
import { Lazy, parseExpression, Evaluator, UntypedLazy, RangedLazy } from '../parser';
import { VariableTypes } from '../util';
import { LazyCompoundEntry } from '../data_structs';

export interface NumberType {
	name: string
	suffix: string
	max_value?: number
}

export namespace NumberType {
	export const byte: NumberType = {
		name: "byte",
		suffix: 'b',
		max_value: 127
	}
	export const short: NumberType = {
		name: "short",
		suffix: 's',
		max_value: 32767
	}
	export const long: NumberType = {
		name: "long",
		suffix: 'L'
	}
	export const float: NumberType = {
		name: "float",
		suffix: 'f'
	}
}

export interface SpecialNumber {
	num: number
	type: NumberType
}


export class SpecialNumberParser extends ValueParser<SpecialNumber,{type: NumberType}> {
	
	id: string = 'special_number'
	parse(t: TokenIterator, ctx: { type: NumberType; }): LazyCompoundEntry<SpecialNumber> {
		let num: RangedLazy<number>;
		console.log('special number',this);
		if (ctx.type == NumberType.float) {
			num = parseExpression(t,VariableTypes.double);
		} else {
			num = parseExpression(t,VariableTypes.int)
		}
		return e=>{
			let v = e.valueOf(num);
			if (ctx.type.max_value && ctx.type.max_value < v) {
				e.error(num.range,"Value exceeds maximum " + ctx.type.name + " value")
			}
			return {num: e.valueOf(num), type: ctx.type}
		}
	}
	
	toString(value: SpecialNumber): string {
		return value.num + value.type.suffix
	}

	getLabel(ctx: { type: NumberType; }) {
		return ctx.type.name
	}
}