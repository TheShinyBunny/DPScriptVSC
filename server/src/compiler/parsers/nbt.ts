import { ValueParser } from './parsers';
import { TokenIterator } from '../tokenizer';
import { Evaluator, Lazy } from '../parser';
import { CompoundItem, DataProperty, DataContext } from '../data_structs';
import { Registry } from '../registries';
import { NBTContext, toStringNBT, parseNBTValue, NBTRegistry, parseFutureNBT, toStringValue } from '../nbt';
import { LazyCompoundEntry } from '../data_structs'

interface Options {
	tags?: CompoundItem<DataProperty>
	strict?: boolean
	registry?: string
	entry?: string | {from: string, inside: boolean} | Lazy<string>
}

export class NBTParser extends ValueParser<any,Options> {
	id: string = "nbt"
	parse(t: TokenIterator, ctx: Options, key?: string, dataCtx?: DataContext<any>): LazyCompoundEntry<any> {
		let nbtCtx: NBTContext;
		let reg: NBTRegistry;
		if (ctx.registry) {
			reg = Registry.getNBTRegistry(ctx.registry);
			nbtCtx = reg.createContext(typeof ctx.entry == 'string' ? ctx.entry : undefined);
		} else {
			nbtCtx = new NBTContext({});
		}
		if (ctx.tags) {
			nbtCtx.properties = {...nbtCtx.properties,...ctx.tags};
		}
		if (typeof ctx.entry == 'object' && !Lazy.is(ctx.entry) && ctx.entry.inside) {
			nbtCtx.entry = '#all';
			nbtCtx.resolvePath = ctx.entry.from;
		}
		return parseFutureNBT(t,(e,comp)=>{
			if (typeof ctx.entry == 'object' && !Lazy.is(ctx.entry) && !ctx.entry.inside && reg) {
				nbtCtx.properties = {...nbtCtx.properties, ...reg.getTags(comp[ctx.entry.from])}
			}
			return nbtCtx;
		});
	}

	toString(value: any, e: Evaluator, data: Options): string {
		return toStringNBT(value,e);
	}
	
}

export class NBTValueParser extends ValueParser<any> {
	id: string = "nbt_value"
	parse(t: TokenIterator, ctx: any, key?: string): LazyCompoundEntry<any> {
		let res = parseNBTValue(t);
		return e=>{
			if (Lazy.is(res)) return e.valueOf(res);
			return res;
		}
	}
	toString(value: any, e: Evaluator, data: any): string {
		return toStringValue(value,e);
	}
	
}