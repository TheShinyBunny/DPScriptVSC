import { Parser } from '../parser';
import { ListNBTContext } from './nbt';
import { ValueType, ValueTypes } from './types';

export interface ListOptions<T> {
	item?: string | ValueType<T>
	itemConfig?: any
	count?: number
}


export class ListType<T> extends ValueType<T[],ListOptions<T>> {
	parse(p: Parser, ctx: ListOptions<T>): T[] {
		let arr: T[] = []
		if (ctx && ctx.item && p.isNext('[')) {
			p.nextToken()
			let type = typeof ctx.item == 'string' ? ValueType.get(ctx.item) : ctx.item
			do {
				let v = type.parse(p,{})
				if (v === undefined) {
					break
				} else {
					arr.push(v)
				}
				if (p.isNext(',')) p.nextToken()
				else break
			} while (!p.isNext(']'))
			if (ctx.count !== undefined && arr.length !== ctx.count) {
				p.error(p.token.range,"Expected " + ctx.count + " items in this list")
			}
			p.expectValue(']')
			return arr
		}
	}
	getDetail(ctx: ListOptions<T>, key: string): string {
		let type = ctx ? typeof ctx.item == 'string' ? ValueType.get(ctx.item) : ctx.item : undefined
		return 'List<' + (type ? type.getDetail({},'') : 'unknown') + '>'
	}

	getNBTContext(ctx: ListOptions<T>) {
		let type = ctx ? typeof ctx.item == 'string' ? ValueType.get(ctx.item) : ctx.item : undefined
		return new ListNBTContext(type)
	}

}