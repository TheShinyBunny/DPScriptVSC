import { GenContext } from '../generate';
import { Parser } from '../parser';
import { Operation, UnaryOperation } from '../operators';
import { Casting, Value, ValueType, ValueTypes } from './types';
import { Selector } from './selector';
import { Score } from './score';


export type Condition = OrCondition | AndCondition | ConditionNode

export interface OrCondition {
	negated: boolean
	orNodes: Condition[]
}

export interface AndCondition {
	negated: boolean
	andNodes: Condition[]
}

export interface ConditionNode {
	negated: boolean
	executeIf: (gen: GenContext)=>string
}


export class ConditionType extends ValueType<Condition> {
	parse(p: Parser, ctx: any): Condition {
		throw new Error('Method not implemented.');
	}
	getDetail(ctx: any, key: string): string {
		return 'Condition'
	}

	getOperators() {
		return [
			<Operation<Condition,Condition,Condition>>{
				op: '&&',
				operand: ValueTypes.condition,
				result: ValueTypes.condition,
				apply: (a,b,g)=>{
					return {
						negated: false,
						andNodes: [a,b]
					}
				}
			},
			<Operation<Condition,Condition,Condition>>{
				op: '||',
				operand: ValueTypes.condition,
				result: ValueTypes.condition,
				apply: (a,b,g)=>{
					return {
						negated: false,
						orNodes: [a,b]
					}
				}
			}
		]
	}

	getUnaryOperators() {
		return [
			<UnaryOperation<Condition,Condition>>{
				op: '!',
				result: this,
				apply: (cond,g)=>{
					return {...cond,negated: !cond.negated}
				}
			}
		]
	}

	getCasts(): Casting<any,Condition>[] {
		return [
			<Casting<Selector,Condition>>{
				type: ValueTypes.selector,
				apply: (value)=>{
					return {negated: false,executeIf: (g)=>'entity ' + g.stringify(value)}
				}
			},
			<Casting<Score,Condition>>{
				type: ValueTypes.score,
				apply: (value)=>{
					return {negated: false,executeIf: (g)=>'score ' + g.stringify(value) + ' matches 1..'}
				}
			}
		]
	}
}

export function getCondCommands(cond: Condition, run: string, gen: GenContext): string[] {
	let node = <ConditionNode>cond
	if (node.executeIf !== undefined) {
		return ['execute ' + getNegationString(node.negated) + ' ' + node.executeIf(gen) + ' run ' + run]
	}
	let and = <AndCondition>cond
	if (and.andNodes !== undefined) {
		return buildAndNodes(and.andNodes,and.negated,run,gen)
	}
	let or = <OrCondition>cond
	let ortemp = gen.getTemp('or')
	let cmds = ['scoreboard players set ' + ortemp.toString() + ' 0']
	for (let o of or.orNodes) {
		cmds.push(...getCondCommands(o,'scoreboard players set ' + ortemp.toString() + ' 1',gen));
	}
	cmds.push('execute if score ' + ortemp.toString() + ' matches 1 run ' + run)
	return cmds
}

function buildAndNodes(nodes: Condition[], negated: boolean, run: string, gen: GenContext): string[] {
	let n = nodes[0];
	let temp1 = gen.getTemp('and')
	if (nodes.length == 1) {
		return [
			'scoreboard players set ' + temp1.toString() + ' 0',
			'execute if score ' + temp1 + ' matches ' + (negated ? 0 : 1) + ' run ' + run
		];
	}
	let cmds1 = getCondCommands(n,'scoreboard players set ' + temp1 + ' 1',gen);
	let cmds2 = buildAndNodes(nodes.slice(1),false,run,gen)
	let func = gen.generateFunction('if',cmds2);
	return [
		'scoreboard players set ' + temp1.toString() + ' 0',
		...cmds1,
		'execute if score ' + temp1 + ' matches ' + (negated ? 0 : 1) + ' run function ' + func.id
	]
}

function getNegationString(neg: boolean) {
	return neg ? 'unless' : 'if'
}