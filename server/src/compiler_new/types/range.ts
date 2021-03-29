import { Expression } from '../ast'
import { ComparisonOperator } from '../operators'
import { Parser } from '../parser'
import { NumberType } from './numbers'
import { Value, ValueType, ValueTypes } from './types'


export class NumberRange {
	constructor(public type: NumberType, public min?: number, public max?: number) {

	}
	static from(num: Value<number>, op: ComparisonOperator) {
		let val = num.value;
		let type: NumberType = num.type as NumberType
		switch (op) {
			case '<':
				return new NumberRange(type,undefined,val - 1)
			case '<=':
				return new NumberRange(type,undefined,val)
			case '>':
				return new NumberRange(type,val + 1,undefined)
			case '>=':
				return new NumberRange(type,val,undefined)
			case '==':
				return new NumberRange(type,val,val)
		}
	}

	toString() {
		if (this.min !== undefined && this.max !== undefined && this.min == this.max) return '' + this.min
		return (this.min !== undefined ? this.min : '') + '..' + (this.max !== undefined ? this.max : '')
	}
}

export interface RangeOptions {
	type: string | NumberType
}

export class RangeType extends ValueType<NumberRange,RangeOptions> {
	parse(p: Parser, ctx: RangeOptions): NumberRange {
		return
	}
	getDetail(ctx: RangeOptions, key: string): string {
		let t = typeof ctx.type == 'string' ? ValueType.get(ctx.type) : ctx.type;
		return 'Range<' + (t ? t.getDetail({},'') : 'number') + '>'
	}

	toString(val: NumberRange) {
		return val.toString()
	}
	
}