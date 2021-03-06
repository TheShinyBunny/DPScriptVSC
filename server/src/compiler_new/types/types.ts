import { GenContext } from '../generate';
import { Parser } from '../parser';
import { NBTContext } from './nbt';
import { BinaryOperator, Operation, UnaryOperation, UnaryOperator } from '../operators';
import { ProcessContext } from '../process';
import { getAsArray } from '../utils';
import { AST } from '../ast';

export interface Value<T> {
	type: ValueType<T>
	value: T
}

export interface Casting<T,R> {
	type: ValueType<T>
	apply: (val: Value<T>)=>R
}

export abstract class ValueType<T,D = any> {

	abstract parse(p: Parser, ctx: D): T
	
	getOperators(): Operation<T,any,any>[] {
		return []
	}

	getUnaryOperators(): UnaryOperation<T,any>[] {
		return []
	}

	of(value: T): Value<T> {
		return {type: this, value}
	}

	toString(value: T, ctx: D, gen: GenContext): string {
		return value + ""
	}

	abstract getDetail(ctx: D, key: string): string

	toNBT(value: T, ctx: D, gen: GenContext): any {

	}

	getOperation(op: BinaryOperator, r: ValueType<any>): Operation<T,any,any> {
		return this.getOperators().find(o=>{
			return getAsArray(o.op).indexOf(op) >= 0 && o.operand == r
		})
	}

	getUnaryOperation(op: UnaryOperator): UnaryOperation<T,any> {
		return this.getUnaryOperators().find(o=>{
			return o.op == op
		})
	}

	configured(ctx: D, detail?: string): ConfiguredValueType<T,D> {
		return new ConfiguredValueType(this,ctx,detail)
	}

	static get(id: string): ValueType<any> {
		return ValueTypes[id]
	}

	static parseById(p: Parser, id: string, config?: any): Value<any> {
		console.log('parsing type by ID of',id)
		let t = ValueType.get(id)
		if (t) {
			let v = t.parse(p,config || {})
			if (v !== undefined) {
				return {value: v, type: t}
			} else {
				console.log(t,'returned undefined')
				return
			}
		}
		console.log('not found')
	}

	static getDetailOf(type: string, config?: any, key?: string) {
		let t = ValueType.get(type)
		if (t) {
			return t.getDetail(config || {},key || '')
		}
		return 'unknown'
	}

	process(proc: ProcessContext, value: T,ctx: D) {

	}

	parseAccess(p: Parser, value: T, ctx: D, canModify: boolean): AST<any> {
		return
	}

	matches(other: ValueType<any>): boolean {
		return this.getBase() == other.getBase()
	}

	getBase(): ValueType<any> {
		return this
	}

	getNBTContext(ctx: D,key?: string): NBTContext {
		return undefined
	}

	getCasts(): Casting<any,T>[] {
		return []
	}
	
	validateConfig(ctx: any): string {
		return
	}

}

export class ConfiguredValueType<T,D = any> extends ValueType<T,D> {

	constructor(private inner: ValueType<T,D>, private ctx: D, private detail?: string) {
		super()
	}
	
	parse(p: Parser, ctx: D): T {
		return this.inner.parse(p,this.ctx)
	}
	getDetail(ctx: D, key: string): string {
		return this.detail ? this.detail : this.inner.getDetail(this.ctx,key)
	}
	
	toNBT(value: T, ctx: D, gen: GenContext): any {
		return this.inner.toNBT(value,this.ctx,gen)
	}

	of(value: T): Value<T> {
		return {type: this.inner, value}
	}

	toString(value: T, ctx: D, gen: GenContext) {
		return this.inner.toString(value,this.ctx,gen)
	}

	process(proc: ProcessContext, value: T,ctx: D) {
		this.inner.process(proc,value,this.ctx)
	}

	parseAccess(p: Parser, value: T, ctx: D, canModify: boolean): AST<any> {
		return this.inner.parseAccess(p,value,this.ctx,canModify)
	}

	getBase(): ValueType<any> {
		return this.inner.getBase()
	}

	cast(value: Value<any>): T {
		return
	}

	getOperators() {
		return this.inner.getOperators()
	}

	getUnaryOperators() {
		return this.inner.getUnaryOperators()
	}

	validateConfig(ctx: any): string {
		return this.inner.validateConfig(this.ctx)
	}

}

import { BoolType } from './bool';
import { ConditionType } from './condition';
import { FloatType, IntType } from './numbers';
import { NBTType, NBTValueType } from './nbt'
import { SelectorType } from './selector';
import { StringType } from './string';
import { EnumType } from './enum';
import { ListType } from './list';
import { RangeType } from './range';
import { ItemType } from './items';
import { NBTAccessType, NBTPathType } from './nbt_path';
import { ScoreType } from './score';
import { ObjectiveType } from './objective';


export namespace ValueTypes {
	export const selector = new SelectorType()
	export const string = new StringType()
	export const int = new IntType()
	export const float = new FloatType()
	export const boolean = new BoolType()
	export const nbt = new NBTType()
	export const nbtValue = new NBTValueType()
	export const condition = new ConditionType()
	export const enumValue = new EnumType()
	export const list = new ListType()
	export const range = new RangeType()
	export const item = new ItemType()
	export const nbtPath = new NBTPathType()
	export const nbtAccess = new NBTAccessType()
	export const score = new ScoreType()
	export const objective = new ObjectiveType()
}