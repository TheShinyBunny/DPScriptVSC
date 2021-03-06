import { isArray } from 'util';
import { Parser } from '../parser';
import { TokenType } from '../tokenizer';
import { ValueType } from './types';
import { Registry } from '../registry/registry'

export class EnumType extends ValueType<string,{values: string[] | string /* | Registry */}> {
	parse(p: Parser, ctx: { values: string[] | string; /* | Registry */ }): string {
		let keys = ctx.values ? (isArray(ctx.values) ? ctx.values : Registry.getKeys(ctx.values)) : []
		p.suggestHere(...keys.map(k=>({value: k})))
		if (p.isTypeNext(TokenType.identifier)) {
			let id = p.nextToken()
			if (keys.indexOf(id.value) >= 0) return id.value
			p.error(id.range,"Expected " + this.getEnumDetail(ctx.values))
			return this.sample(keys)
		}
	}
	getDetail(ctx: { values: string[] | string /* | Registry */ }, key: string): string {
		return 'enum[' + this.getEnumDetail(ctx.values) + ']'
	}

	getEnumDetail(values: string[] | string /* | Registry */) {
		return values ? (isArray(values) ? values.join('|') : values) : 'some enum value'
	}

	sample(values: string[] | string /* | Registry */) {
		return !values || values.length == 0 ? 'unknown' : values[0]
	}

}

