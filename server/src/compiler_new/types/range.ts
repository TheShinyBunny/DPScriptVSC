import { Expression } from '../ast'
import { ComparisonOperator } from '../operators'
import { Parser } from '../parser'
import { NumberType, NumberValue } from './numbers'
import { ValueType, ValueTypes } from './types'


export class NumberRange {
	constructor(public min?: NumberValue, public max?: NumberValue) {

	}
	static from(num: NumberValue, op: ComparisonOperator) {
		switch (op) {
			case '<':
				return new NumberRange(undefined,{num: num.num - 1,type: num.type})
			case '<=':
				return new NumberRange(undefined,num)
			case '>':
				return new NumberRange({num: num.num + 1,type: num.type},undefined)
			case '>=':
				return new NumberRange(num,undefined)
			case '==':
				return new NumberRange(num,num)
		}
	}

	toString() {
		if (this.min && this.max && this.min.num == this.max.num) return '' + this.min.num
		return (this.min ? this.min.num : '') + '..' + (this.max ? this.max.num : '')
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