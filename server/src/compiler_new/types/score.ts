import { Expression, Statement } from '../ast';
import { ComparisonOperator, Operation } from '../operators';
import { Parser } from '../parser';
import { Condition } from './condition';
import { NumberType, NumberTypes } from './numbers';
import { NumberRange } from './range';
import { ValueType, ValueTypes } from './types';


export class Score {
	constructor(public entry: string, public objective: string) {
		
	}

	toString() {
		return this.entry + ' ' + this.objective
	}
}


export class ScoreType extends ValueType<Score> {
	parse(p: Parser, ctx: any): Score {
		return
	}
	getDetail(ctx: any, key: string): string {
		return 'Score'
	}

	getOperators() {
		return [
			<Operation<Score,Score,Score>>{
				op: ['+','-','*','/','%'],
				operand: this,
				result: this,
				apply: (a,b,g,op)=>{
					let temp = g.getTemp('expr')
					g.write('scoreboard players operation ' + temp.toString() + ' = ' + a.toString())
					g.write('scoreboard players operation ' + temp.toString() + ' ' + op + '= ' + b.toString())
					return temp
				}
			},
			<Operation<Score,number,Score>>{
				op: '+',
				operand: ValueTypes.int,
				result: this,
				apply: (a,b,g)=>{
					let temp = g.getTemp('expr')
					g.write('scoreboard players operation ' + temp.toString() + ' = ' + a.toString())
					g.write('scoreboard players add ' + temp.toString() + ' ' + b)
					return temp
				}
			},
			<Operation<Score,number,Score>>{
				op: '-',
				operand: ValueTypes.int,
				result: this,
				apply: (a,b,g)=>{
					let temp = g.getTemp('expr')
					g.write('scoreboard players operation ' + temp.toString() + ' = ' + a.toString())
					g.write('scoreboard players remove ' + temp.toString() + ' ' + b)
					return temp
				}
			},
			<Operation<Score,number,Score>>{
				op: ['*','/','%'],
				operand: ValueTypes.int,
				result: this,
				apply: (a,b,g,op)=>{
					let temp = g.getTemp('expr')
					let cons = g.createConst(b)
					g.write('scoreboard players operation ' + temp.toString() + ' = ' + a.toString())
					g.write('scoreboard players operation ' + temp.toString() + ' ' + op + '= ' + cons.toString())
					return temp
				}
			},
			<Operation<Score,Score,Condition>>{
				op: ['>','<','>=','<=','==','!='],
				operand: this,
				result: ValueTypes.condition,
				apply: (a,b,g,op)=>{
					let op2 = op == '!=' ? '==' : op
					return {executeIf: (g)=>'score ' + a.toString() + ' ' + (op2 == '==' ? '=' : op2) + ' ' + b.toString(),negated: op == '!='}
				}
			},
			<Operation<Score,number,Condition>>{
				op: ['>','<','>=','<=','==','!='],
				operand: ValueTypes.int,
				result: ValueTypes.condition,
				apply: (a,b,g,op)=>{
					let op2 = op == '!=' ? '==' : op
					return {executeIf: (g)=>'score ' + a.toString() + ' matches ' + NumberRange.from(NumberTypes.integer.int(b),op2 as ComparisonOperator),negated: op == '!='}
				}
			},
			<Operation<Score,NumberRange,Condition>>{
				op: ['==','!='],
				operand: ValueTypes.range,
				result: ValueTypes.condition,
				apply: (score,range,g,op)=>{
					return {executeIf: (g)=>'score ' + score.toString() + ' matches ' + range.toString(),negated: op == '!='}
				}
			}
		]
	}

	toString(val: Score) {
		return val.toString()
	}

}

export function parseScoreModification(p: Parser, score: Expression<Score>): Statement {
	return
}