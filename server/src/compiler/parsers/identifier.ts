import { ValueParser } from './parsers';
import { TokenIterator, TokenType } from '../tokenizer';
import { UntypedLazy, Evaluator, parseExpression } from '../parser';
import { parseIdentifierOrVariable, VariableTypes } from '../util';
import { SpecialNumber, NumberType } from './special_numbers';
import { LazyCompoundEntry, DataContext } from '../data_structs'
import { Registry } from '../registries';

interface Options {
	name: string
	numeralIndex?: boolean
	values: any
	numberType?: string
}

export class IdentifierParser extends ValueParser<string | number | SpecialNumber,Options> {
	id: string = "identifer";
	parse(t: TokenIterator, ctx: Options): LazyCompoundEntry<string | number | SpecialNumber> {
		let opts = typeof ctx.values == 'string' ? builtin[ctx.values] : ctx;
		t.suggestHere(...Object.keys(opts.values).map(k=>opts.values[k]));
		let v = parseIdentifierOrVariable(t);
		return e=>{
			let val = e.valueOf(v.value);
			let index: string;
			for (let x of Object.keys(opts.values)) {
				if (opts.values[x] == val || x == val) {
					index = x;
				}
			}
			if (!index) {
				e.error(v.range,"Unknown " + (opts.name || '') + ' value')
			}
			if (opts.numeralIndex) {
				if (opts.numberType) {
					return {num: Number(index),type: NumberType[opts.numberType]};
				}
				return Number(index);
			}
			return index;
		}
	}

	toString(value: string | number | SpecialNumber): string {
		return typeof value == 'object' ? value.num + value.type.suffix : value.toString()
	}
	
	getLabel(opts: Options) {
		return opts.name
	}
}

const builtin: {[id: string]: Options} = {
	direction: {
		name: "direction",
		values: {0:"down",1:"up",2:"north",3:"south",4:"west",5:"east"},
		numberType: "b",
		numeralIndex: true
	}
}

export class EnumParser extends ValueParser<string,{values?: string[], registry?: string}> {
	id: string = "enum"
	parse(t: TokenIterator, ctx: { values?: string[]; registry?: string}): LazyCompoundEntry<string> {
		let values = ctx.values || Registry.getKeys(ctx.registry);
		t.suggestHere(...values);
		if (t.isTypeNext(TokenType.identifier)) {
			let id = t.next().value;
			return e=>id;
		}
		let lazy = parseExpression(t,VariableTypes.string);
		return (e)=>{
			let r = e.valueOf(lazy);
			if (values.indexOf(r) < 0) {
				if (ctx.values) {
					e.error(lazy.range,"Expected one of: " + ctx.values.join(', '));
				} else {
					e.error(lazy.range,"Expected " + ctx.registry + " value");
				}
			}
			return r;
		};
	}
	toString(value: string, e: Evaluator, data: { values: string[]; }): string {
		return value;
	}
	
}