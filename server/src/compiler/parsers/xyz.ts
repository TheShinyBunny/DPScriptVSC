import { ValueParser, ParsingContext, Parsers } from './parsers';
import { TokenIterator } from '../tokenizer';
import { Evaluator, UntypedLazy } from '../parser';
import { CompoundItem, DataProperty, LazyCompoundEntry } from '../data_structs';
import { NBTPathContext } from '../nbt';

interface Options {
	prefix?: string
	suffix?: string
	double?: string
}

interface XYZ {
	X: number
	Y: number
	Z: number
}

const XYZ_TAGS: CompoundItem<DataProperty> = {
	X: {
		type: "int"
	},
	Y: {
		type: "int"
	},
	Z: {
		type: "int"
	}
}

export class XYZParser extends ValueParser<XYZ,Options> {
	id: string = "xyz"
	parse(t: TokenIterator, ctx: Options): LazyCompoundEntry<XYZ> {
		if (ctx.prefix || ctx.suffix) {
			let list = Parsers.list.parse<number>(t,{item: ctx.double ? Parsers.double : Parsers.int, count: 3});
			return e=>{
				return {X: e.valueOf(list[0]), Y: e.valueOf(list[1]), Z: e.valueOf(list[2])}
			}
		}
		return Parsers.nbt.parse(t,{tags: XYZ_TAGS});
	}

	toString(value: XYZ, e: Evaluator, data: Options): string {
		return JSON.stringify(value);
	}

	private apply(axis: string, data: Options) {
		return (data.prefix || '') + axis + (data.suffix || '')
	}
	
	customValueSetter = (value: any, container: any, ctx: ParsingContext<Options>)=>{
		if (ctx.data.prefix || ctx.data.suffix) {
			container[this.apply('X',ctx.data)] = value.X;
			container[this.apply('Y',ctx.data)] = value.Y;
			container[this.apply('Y',ctx.data)] = value.Z;
		} else {
			return false;
		}
	}

	createPathContext(data: Options) {
		let type = data.double ? "double" : "int"
		let ctx = new NBTPathContext({
			X: {
				type
			},
			Y: {
				type
			},
			Z: {
				type
			}
		});
		if (data.prefix || data.suffix) {
			ctx.mapProps(k=>this.apply(k,data));
		}
		return ctx;
	}

}