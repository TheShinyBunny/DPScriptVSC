import { ComparisonOperator, Operation, Operators, UnaryOperation } from '../operators';
import { Parser } from '../parser';
import { Token, TokenType } from '../tokenizer';
import { Condition } from './condition';
import { NumberRange } from './range';
import { Score } from './score';
import { Value, ValueType, ValueTypes } from './types';


export abstract class NumberType extends ValueType<number> {


	abstract tokenType: TokenType

	parse(p: Parser): number {
		if (p.isTypeNext(this.tokenType)) {
			return Number(p.nextToken().value)
		}
	}
	
	static createValue(token: Token): Value<number> {
		let t = NumberTypes[TokenType[token.type]];
		if (t) return {type: t, value: Number(token.value)};
	}

	toString(num: number) {
		return num.toString()
	}

	getOperators() {
		let self = this;
		return [
			<Operation<number,number,NumberRange>>{
				op: '..',
				operand: this,
				result: ValueTypes.range,
				apply: (a,b,g)=>{
					return new NumberRange(self,a,b)
				}
			},
			<Operation<number,Score,Score>>{
				op: ['+','-','*','/','%'],
				operand: ValueTypes.score,
				result: ValueTypes.score,
				apply: (a,b,g,op)=>{
					let temp = g.getTemp('expr')
					g.write('scoreboard players set ' + temp.toString() + ' ' + a)
					g.write('scoreboard players operation ' + temp.toString() + ' ' + op + '= ' + b.toString())
					return temp
				}
			},
			<Operation<number,Score,Condition>>{
				op: ['>','<','>=','<=','==','!='],
				operand: ValueTypes.score,
				result: ValueTypes.condition,
				apply: (a,b,g,op)=>{
					let op2 = op == '!=' ? '==' : op
					return {executeIf: (g)=>'score ' + b.toString() + ' matches ' + NumberRange.from({type: self,value: a},Operators.flipComparison(op2 as ComparisonOperator)),negated: op == '!='}
				}
			}
		]
	}
	
	getUnaryOperators() {
		return [
			<UnaryOperation<number,number>>{
				op: '-',
				result: this,
				apply: (val,g)=>(-val)
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

	int(num: number): Value<number> {
		return {type: this,value: num}
	}
}

export const NumberTypes = {
	integer: new IntType(),
	float: new IntType()
}