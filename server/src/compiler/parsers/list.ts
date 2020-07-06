import { ValueParser, ParsingContext, Parsers } from './parsers';
import { NumberRange, Ranges } from '../util';
import { TokenIterator } from '../tokenizer';
import { SemanticType } from '../../server';
import { Range } from 'vscode-languageserver-textdocument';
import { Evaluator } from '../parser';
import { LazyCompoundEntry } from '../data_structs'

export interface ListOptions<T,D = any> {
	open?: string
	close?: string
	item: ValueParser<T,D> | string
	context?: D
	count?: NumberRange
}

export class ListParser extends ValueParser<any[],ListOptions<any,any>> {
	
	id: string = "list"
	parse<T,D = any>(t: TokenIterator, ctx: ListOptions<T,D>) {
		let arr: (T | LazyCompoundEntry<T>)[] = [];
		if (!t.expectValue(ctx.open || '[')) return [];
		t.ctx.editor.addSemantic(t.lastPos,SemanticType.struct);
		let i = 0;
		let outOfRange: Range;
		let parser = asValueParser(ctx.item);
		while (t.hasNext() && !t.isNext(ctx.close)) {
			let inRange = !ctx.count || Ranges.inRange(ctx.count,i);
			if (!inRange) {
				if (!outOfRange) {
					outOfRange = t.startRange();
				}
			}
			let v = parser.parse(t,ctx.context);
			if (inRange) {
				arr.push(v);
			}
			if (!t.skip(',')) {
				break;
			}
			i++;
		}
		if (outOfRange) {
			t.endRange(outOfRange);
			t.error(outOfRange,"Expected only " + Ranges.toString(ctx.count) + " items, but found " + i);
		}
		t.expectValue(ctx.close || ']');
		t.ctx.editor.addSemantic(t.lastPos,SemanticType.struct);
		return arr;
	}

	toString(value: any[], e: Evaluator, data: ListOptions<any>): string {
		return '[' + value.map((v,i)=>asValueParser(data.item).toString(v,e,new ParsingContext(data.context,i,value))).join(',') + ']'
	}

	toCompoundData(value: any[], ctx: ParsingContext<ListOptions<any>>) {
		console.log(value);
		return value.map((a,i)=>asValueParser(ctx.data.item).toCompoundData(a,new ParsingContext(ctx.data.context,i,value)))
	}

}

export function asValueParser<T,D>(parser: ValueParser<T,D> | string): ValueParser<T,D> {
	return typeof parser == 'string' ? Parsers[parser] : parser;
}