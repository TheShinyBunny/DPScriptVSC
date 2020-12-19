import { ValueParser } from './parsers';
import { Token, TokenIterator, TokenType } from '../tokenizer';
import { LazyCompoundEntry } from '../data_structs';
import { Evaluator, parseSingleValue, Lazy } from '../parser';
import { VariableTypes } from '../util';



export class DurationParser extends ValueParser<number> {
	id: string = 'duration'
	parse(t: TokenIterator): LazyCompoundEntry<number> {
		let nodes: {n: Token, factor: number}[] = [];
		let num = t.expectType(TokenType.int);
		if (!num.value) return undefined;
		while (t.hasNext()) {
			t.suggestHere('s','t','m','h','d');
			if (t.isTypeNext(TokenType.identifier)) {
				let unit = t.next();
				let stop = false;
				switch(unit.value) {
					case 's':
					case 'secs':
					case 'seconds':
						nodes.push({n: num, factor: 20})
						break;
					case 't':
					case 'ticks':
						nodes.push({n: num, factor: 1})
						break;
					case 'm':
					case 'mins':
					case 'minutes':
						nodes.push({n: num, factor: 1200});
						break;
					case 'h':
					case 'hours':
						nodes.push({n: num, factor: 72000});
						break;
					case 'd':
					case 'days':
						nodes.push({n: num, factor: 1728000});
						break;
					case 'hide':
						stop = true;
						break;
					default:
						t.error(unit.range,'Invalid duration unit');
				}
				if (stop) {
					nodes.push({n: num, factor: 1});
					break;
				}
				if (t.isTypeNext(TokenType.int)) {
					num = t.next();
				} else {
					break;
				}
			} else {
				nodes.push({n: num, factor: 1});
				break;
			}
		}
		return e=>{
			let result = 0;
			for (let n of nodes){
				result += Number(n.n.value) * n.factor;
			}
			return Math.round(result);
		}
	}
	toString(value: number, e: Evaluator, data: any): string {
		return value + ''
	}
	
}