import { TokenIterator } from '../tokenizer';
import { Evaluator, Lazy, UntypedLazy } from '../parser';
import { LazyCompoundEntry } from '../data_structs'

export class ParsingContext<D> {
	

	constructor(public data: D, public key: string | number, public compound: any, public dataCtx?: DataContext<any>) {

	}
}

export abstract class ValueParser<R, D = any> {
	abstract id: string
	abstract parse(t: TokenIterator, ctx: D, key?: string, dataCtx?: DataContext<any>): R | LazyCompoundEntry<R>;

	abstract toString(value: R, e: Evaluator, data: D): string

	customValueSetter: (value: any, container: any, ctx: ParsingContext<D>)=>boolean;

	toCompoundData(value: R, ctx: ParsingContext<D>): any {
		return value;
	}

	configured(data: D, label?: string): ConfiguredParser<R,D> {
		return new ConfiguredParser(this,data,label);
	}
}

export class ConfiguredParser<R,D = any> extends ValueParser<R,D> {
	
	id: string;

	constructor(public inner: ValueParser<R,D>, public data: D, id?: string) {
		super()
		this.id = id || inner.id;
	}
	parse(t: TokenIterator): R | LazyCompoundEntry<R> {
		return this.inner.parse(t,this.data);
	}
	toString(value: R, e: Evaluator): string {
		return this.inner.toString(value,e,this.data);
	}
	toCompoundData(value: R, ctx: ParsingContext<D>) {
		return this.inner.toCompoundData(value,ctx);
	}
	
}

export class CustomValueParser extends ValueParser<any> {
	id: string

	constructor(id: string, private parser: (t: TokenIterator)=>any) {
		super()
		this.id = id;
	}
	parse(t: TokenIterator, ctx: any, key?: string, dataCtx?: DataContext<any>): any | UntypedLazy<any> {
		return this.parser(t);
	}
	toString(value: any, e: Evaluator, data: any): string {
		return toStringValue(value,e);
	}
	
}

import { CompoundParser } from './compound';
import { ItemParser } from './item';
import { BlockParser, BlockStateParser } from './block';
import { SpecialNumberParser, NumberType } from './special_numbers';
import { DataContext } from '../data_structs';
import { EffectParser } from './effect';
import { ColorParser, RGBParser } from './color';
import { ListParser } from './list';
import { EnchantmentParser } from './enchantment';
import { NBTParser, NBTValueParser } from './nbt';
import { FlagsParser } from './flags';
import { IdentifierParser, EnumParser } from './identifier'
import { VariableParser } from './variable';
import { VariableTypes } from '../util';
import { toStringValue } from '../nbt';

const _SpecialNumberParser = new SpecialNumberParser()

const _EffectParser = new EffectParser()

const _VariableParser = new VariableParser()

export const Parsers = {
	compound: new CompoundParser(),
	item: new ItemParser(),
	block: new BlockParser(),
	blockstate: new BlockStateParser(),
	float: _SpecialNumberParser.configured({type: NumberType.float}),
	long: _SpecialNumberParser.configured({type: NumberType.long}),
	short: _SpecialNumberParser.configured({type: NumberType.short}),
	byte: _SpecialNumberParser.configured({type: NumberType.byte}),
	effect_id: _EffectParser.configured({full: false,tier: false}),
	effect: _EffectParser.configured({full: true, tier: true}),
	color_id: new ColorParser(),
	rgb: new RGBParser(),
	list: new ListParser(),
	enchantment: new EnchantmentParser(),
	nbt: new NBTParser(),
	nbt_value: new NBTValueParser(),
	flags: new FlagsParser(),
	indexed_identifier: new IdentifierParser(),
	int: _VariableParser.configured({type: 'integer'}),
	double: _VariableParser.configured({type: 'double'}),
	bool: _VariableParser.configured({type: 'boolean'}),
	string: _VariableParser.configured({type: 'string'}),
	variable: _VariableParser,
	enum: new EnumParser()
}