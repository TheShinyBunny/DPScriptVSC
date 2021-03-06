import { Parser } from '../parser';
import { TokenType } from '../tokenizer';
import { BinaryOperator, Operation } from '../operators';
import { Value, ValueType, ValueTypes } from './types';


export class StringType extends ValueType<string> {

	getDetail(ctx: any, key: string): string {
		return 'string'
	}
	parse(p: Parser): string {
		if (p.isTypeNext(TokenType.string)) return p.nextToken().value;
	}
	
	getOperators() {
		return [
			<Operation<string,string,string>>{
				op: '+',
				operand: ValueTypes.string,
				result: ValueTypes.string,
				apply: (a,b)=>a + b
			}
		]
	}

}