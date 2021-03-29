import { GenContext } from './generate';
import { Value, ValueType } from './types/types';


export interface Operation<A,B,R> {
	op: BinaryOperator | BinaryOperator[]
	operand: ValueType<B>
	result: ValueType<R>
	apply: (value: A, other: B, gen: GenContext, op: BinaryOperator)=>R
}

export type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '>' | '<=' | '>=' | '&&' | '||' | '..'
const binaryOps = ['+','-','*','/','%','==','!=','<','>','<=','>=','&&','||']
export type UnaryOperator = '!' | '-'

export namespace Operators {
	export function isUnary(op: string) {
		return ['!','-'].indexOf(op) >= 0
	}
	export function isBinary(op: string) {
		return binaryOps.indexOf(op) >= 0
	}

	export function flipComparison(op: ComparisonOperator): ComparisonOperator {
		switch (op) {
			case '<':
				return '>'
			case '>':
				return '<'
			case '>=':
				return '<='
			case '<=':
				return '>='
			case '==':
			case '!=':
				return op
		}
	}
}

export interface UnaryOperation<T,R> {
	op: UnaryOperator
	result: ValueType<R>
	apply: (value: T, gen: GenContext)=>R
}

export type ComparisonOperator = '>' | '>=' | '<' | '<=' | '==' | '!='

export type AssignOperator = '+=' | '-=' | '*=' | '/=' | '%=' 