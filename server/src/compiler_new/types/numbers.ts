import { ComparisonOperator, Operation, Operators, UnaryOperation } from '../operators';
import { Parser } from '../parser';
import { Token, TokenType } from '../tokenizer';
import { Condition } from './condition';
import { NumberRange } from './range';
import { Score } from './score';
import { ValueType, ValueTypes } from './types';


export interface NumberValue {
	type: NumberType
	num: number
}

export abstract class NumberType extends ValueType<NumberValue> {


	abstract tokenType: TokenType

	parse(p: Parser): NumberValue {
		if (p.isTypeNext(this.tokenType)) {
			return {num: Number(p.nextToken().value),type: this}
		}
	}
	
	static createValue(token: Token): NumberValue {
		let t = NumberTypes[TokenType[token.type]];
		if (t) return {type: t, num: Number(token.value)};
	}

	toString(num: NumberValue) {
		return num.num + ""
	}

	getOperators() {
		return [
			<Operation<NumberValue,NumberValue,NumberRange>>{
				op: '..',
				operand: this,
				result: ValueTypes.range,
				apply: (a,b,g)=>{
					return new NumberRange(a,b)
				}
			},
			<Operation<NumberValue,Score,Score>>{
				op: ['+','-','*','/','%'],
				operand: ValueTypes.score,
				result: ValueTypes.score,
				apply: (a,b,g,op)=>{
					let temp = g.getTemp('expr')
					g.write('scoreboard players set ' + temp.toString() + ' ' + a.num)
					g.write('scoreboard players operation ' + temp.toString() + ' ' + op + '= ' + b.toString())
					return temp
				}
			},
			<Operation<NumberValue,Score,Condition>>{
				op: ['>','<','>=','<=','==','!='],
				operand: ValueTypes.score,
				result: ValueTypes.condition,
				apply: (a,b,g,op)=>{
					let op2 = op == '!=' ? '==' : op
					return {executeIf: (g)=>'score ' + b.toString() + ' matches ' + NumberRange.from(a,Operators.flipComparison(op2 as ComparisonOperator)),negated: op == '!='}
				}
			}
		]
	}
	
	getUnaryOperators() {
		return [
			<UnaryOperation<NumberValue,NumberValue>>{
				op: '-',
				result: this,
				apply: (val,g)=>({num: -val.num,type: val.type})
			}
		]
	}

}

export class FloatType extends NumberType {
	getDetail(ctx: any, key: string): string {
		return 'float'
	}
	tokenType: TokenType = TokenType.float;
}

export class IntType extends NumberType {
	getDetail(ctx: any, key: string): string {
		return 'int'
	}
	tokenType: TokenType = TokenType.integer
}

export const NumberTypes = {
	integer: new IntType(),
	float: new IntType()
}