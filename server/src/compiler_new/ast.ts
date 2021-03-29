import { ProcessContext } from './process';
import { GenContext } from './generate';
import { DPScriptFile, Exportable, MCFunction, Tag } from './project';
import { Token } from './tokenizer';
import { NumberType } from './types/numbers';
import { Value, ValueType, ValueTypes } from './types/types';
import { BinaryOperator, UnaryOperator } from './operators';
import { Condition, getCondCommands } from './types/condition';
import { NumberRange } from './types/range';
import { Selector } from './types/selector';
import { Range } from 'vscode-languageserver';
import { MemberUsage } from './utils';
import { Score } from './types/score';
import { Objective } from './types/objective';
import { AbstractContext, Parser } from './parser';


export abstract class AST<T> {

	abstract process(proc: ProcessContext): void

	abstract generate(gen: GenContext): T

}

export abstract class Statement extends AST<void> {

}

export abstract class GlobalStatement extends Statement {

}

export class FunctionStatement extends GlobalStatement {

	constructor(private name: Token,private code: Block, private addToTag?: string) {
		super()
	}

	process(proc: ProcessContext): void {
		//this.addUnique('function',name)
		this.code.process(proc)
	}
	generate(gen: GenContext): void {
		let func = new MCFunction(gen.script,this.name.value);
		let c = gen.withWritingTarget((c)=>func.commands.push(c))
		this.code.generate(c)
		gen.builder.entries.push(func)
		if (this.addToTag) {
			gen.builder.getTag(this.addToTag,'functions').add(func.id)
		}
		
	}
	
}

export class ConstDeclaration extends GlobalStatement {

	constructor(private name: Token, private value: Expression<number>) {
		super()
	}

	process(proc: ProcessContext): void {
		
	}
	generate(gen: GenContext): void {
		let num = this.value.generate(gen);
		if (num && num.type == ValueTypes.int) {
			let score = gen.createConst(num.value,this.name.value)
			gen.variables[this.name.value] = {type: ValueTypes.score,value: score}
		}
	}
	
}

export class GlobalScoreDeclaration extends GlobalStatement {

	constructor(private name: Token) {
		super()
	}

	process(proc: ProcessContext): void {
		
	}
	generate(gen: GenContext): void {
		gen.ensureObjective('global')
		gen.variables[this.name.value] = {type: ValueTypes.score,value: new Score(this.name.value,'global')}
	}
	
}

export class ObjectiveStatement extends GlobalStatement {
	
	constructor(private obj: Objective, private declare: boolean) {
		super()
	}

	process(proc: ProcessContext): void {
		/* if (proc.getVariableType(this.obj.name)) {
			proc.error(this.obj.name.range,"Duplicate variable named " + this.obj.name.value)
		} else {
			proc.addVariable(this.obj.name.value,{decl: this.obj.name.range,name: this.obj.name,type: ValueTypes.objective})
		} */
	}
	generate(gen: GenContext): void {
		gen.builder.objectives.push(this.obj.name.value)
		gen.variables[this.obj.name.value] = {type: ValueTypes.objective,value: this.obj}
		if (!this.declare) {
			gen.load('scoreboard objectives add ' + this.obj.name.value + ' ' + this.obj.type)
		}
	}
}

export class ForVarLoop extends Statement {
	
	
	constructor(private init: Statement, private cond: Expression<Condition>, private inc: Statement, private code: Statement) {
		super()
	}

	process(proc: ProcessContext): void {
		this.init.process(proc)
		proc.pushed(()=>{
			this.cond.process(proc)
			this.inc.process(proc)
			this.code.process(proc)
		})
	}

	generate(gen: GenContext): void {
		this.init.generate(gen);
		let cond = this.cond.generate(gen);
		let func = gen.generateFunction('for',[...gen.getCommands(this.code),...gen.getCommands(this.inc)]);
		let cmds = getCondCommands(cond.value,'function ' + func.id,gen)
		func.commands.push(...cmds)
		gen.write(...cmds);
	}
	
}

export class PrintStatement extends Statement {
	
	constructor(private str: Expression<string>) {
		super()
	}

	process(proc: ProcessContext): void {
		
	}
	generate(gen: GenContext): void {
		let res = this.str.generate(gen)
		if (res) {
			gen.write('say ' + res.value)
		}
	}
}


export class Block extends Statement {
	
	constructor(public statements: Statement[]) {
		super()
	}

	process(proc: ProcessContext): void {
		
	}

	generate(gen: GenContext): void {
		for (let s of this.statements) {
			s.generate(gen);
		}
	}
	
}

export abstract class Expression<T> extends AST<Value<T>> {
	ensure(predicate: (v: Value<T>) => boolean): Expression<T> {
		return new CheckedExpression(this,predicate)
	}

	abstract getResult(ctx: AbstractContext): ValueType<T>

}

export class CheckedExpression<T> extends Expression<T> {

	constructor(private expr: Expression<T>, private predicate: (v: Value<T>)=>boolean) {
		super()
	}

	getResult(ctx: AbstractContext): ValueType<T, any> {
		return this.expr.getResult(ctx)
	}
	process(proc: ProcessContext): void {
		this.expr.process(proc)
	}
	generate(gen: GenContext): Value<T> {
		let res = this.expr.generate(gen)
		if (res && this.predicate(res)) {
			return res
		}
	}
	
}


export class ValueExpression<T> extends Expression<T> {
	

	constructor(public type: ValueType<T>, public value: T) {
		super()
	}

	process(proc: ProcessContext): void {
		// todo: validate number types (like int, short, byte) for their max / min values
	}

	getResult(): ValueType<T> {
		return this.type;
	}

	generate(gen: GenContext): Value<T> {
		return {type: this.type,value: this.value}
	}

}

export class CastedExpression extends Expression<any> {

	constructor(private expr: Expression<any>, private type: ValueType<any>) {
		super()
	}

	getResult(ctx: AbstractContext): ValueType<any, any> {
		return this.type
	}
	process(proc: ProcessContext): void {
		this.expr.process(proc)
	}
	generate(gen: GenContext): Value<any> {
		let res = this.expr.generate(gen)
		if (res) {
			let cast = this.type.getCasts().find(c=>c.type.matches(res.type))
			if (cast) {
				return this.type.of(cast.apply(res))
			}
		}
	}
	
}

export class IdentifierExpression extends Expression<any> {
	
	
	constructor(private token: Token) {
		super()
	}

	process(proc: ProcessContext): void {
		//let t = this.getResult(proc)

	}

	getResult(ctx: AbstractContext): ValueType<any> {
		return ctx.getVariableType(this.token)
	}
	
	generate(gen: GenContext): Value<any> {
		return gen.variables[this.token.value]
	}
	
}

export class AnyNumberExpression extends Expression<number> {
	
	constructor(private expr: Expression<any>) {
		super()
	}

	getResult(ctx: AbstractContext): ValueType<number, any> {
		return this.expr.getResult(ctx)
	}
	process(proc: ProcessContext): void {
		this.expr.process(proc)
	}
	generate(gen: GenContext): Value<number> {
		let t = this.expr.generate(gen)
		if (t.type instanceof NumberType) {
			return t
		}
	}
}

export class CompoundExpression extends Expression<any> {
	static make(p: Parser, left: Expression<any>, op: Token, right: Expression<any>): Expression<any> {
		if (!left) return
		if (!right) {
			p.error(p.token.range,"Expected right side of operator")
			return left
		}
		let l = left.getResult(p);
		let r = right.getResult(p);
		if (l && r) {
			let oper = l.getOperation(op.value as BinaryOperator,r);
			if (!oper) {
				p.error(op.range,"Operator " + op.value + " cannot be applied to " + l.getDetail({},'') + " and " + r.getDetail({},''))
			}
			return new CompoundExpression(left,op,right)
		}
	}
	

	constructor(public left: Expression<any>, public op: Token, public right: Expression<any>) {
		super()
		
	}

	process(proc: ProcessContext): void {
		/* let l = this.left.getResult(proc);
		let r = this.right.getResult(proc);
		if (l && r) {
			let oper = l.getOperation(this.op.value as BinaryOperator,r);
			if (!oper) {
				proc.error(this.op.range,"Operator " + this.op.value + " cannot be applied to " + l.getDetail({},'') + " and " + r.getDetail({},''))
			}
		} */
	}

	getResult(ctx: AbstractContext): ValueType<any> {
		if (!this.left || !this.right) return
		let l = this.left.getResult(ctx);
		let r = this.right.getResult(ctx);
		if (!l || !r) return
		let oper = l.getOperation(this.op.value as BinaryOperator,r);
		return oper ? oper.result : undefined;
	}

	generate(gen: GenContext): Value<any> {
		if (!this.left || !this.right) return
		let l = this.left.getResult(gen);
		let r = this.right.getResult(gen);
		if (!l || !r) return
		let oper = l.getOperation(this.op.value as BinaryOperator,r);
		if (!oper) return
		let lv = this.left.generate(gen);
		let rv = this.right.generate(gen);
		if (!lv || !rv) return
		return {type: oper.result, value: oper.apply(lv.value,rv.value,gen,this.op.value as BinaryOperator)};
	}
	
}

export class UnaryExpression extends Expression<any> {
	
	constructor(private expr: Expression<any>, private op: Token) {
		super()
	}

	getResult(ctx: AbstractContext): ValueType<any> {
		let t = this.expr.getResult(ctx)
		if (t) {
			let oper = t.getUnaryOperation(this.op.value as UnaryOperator);
			if (oper) return oper.result
		}
	}
	process(proc: ProcessContext): void {
		// check if can apply op
	}
	generate(gen: GenContext): Value<any> {
		return
	}
}

export class RangeExpression extends Expression<NumberRange> {
	
	constructor(private min?: Expression<number>, private max?: Expression<number>, private minExcl?: boolean, private maxExcl?: boolean) {
		super()
	}

	getResult(ctx: AbstractContext): ValueType<NumberRange, any> {
		return ValueTypes.range
	}
	
	process(proc: ProcessContext): void {
		
	}
	generate(gen: GenContext): Value<NumberRange> {
		let res = (this.min ? this.min.getResult(gen) : this.max.getResult(gen)) as NumberType
		return {type: ValueTypes.range,value: {type: res, min: this.min ? this.min.generate(gen).value : undefined,max: this.max ? this.max.generate(gen).value : undefined}}
	}
	
}

export class MemberUsageStatement extends Statement {
	
	constructor(private obj: Value<any>, private usage: MemberUsage, private objectToken: string) {
		super()
	}
	process(proc: ProcessContext): void {
		
	}
	generate(gen: GenContext): void {
		console.log('generating member usage',this.usage)
		let cmd = buildUsageCommand(gen,this.usage,this.objectToken,this.obj)
		
		gen.write(cmd)
	}
}

function buildUsageCommand(gen: GenContext, usage: MemberUsage, objectToken: string, obj: Value<any>) {
	let cmd = usage.command;
	if (cmd.indexOf(objectToken) >= 0) {
		cmd = cmd.replace(objectToken,gen.stringify(obj))
	}
	for (let p in usage.params) {
		let v = usage.params[p];
		let str = gen.stringify(v);
		console.log('command before: ' + cmd + ', setting ' + p + ' = ' + str)
		cmd = cmd.replace('<' + p + '>',str)
		cmd = cmd.replace('[' + p + ']',str)
		console.log('cmd now: ' + cmd)
	}
	return cmd.replace(/\[.+]/g,'')
}

export class MemberUsageExpression extends Expression<any> {
	constructor(private obj: Value<any>, private usage: MemberUsage, private objectToken: string) {
		super()
	}

	getResult(ctx: AbstractContext): ValueType<any, any> {
		return ValueTypes.score;
	}
	process(proc: ProcessContext): void {
		
	}
	generate(gen: GenContext): Value<any> {
		let temp = gen.getTemp('queryRes');
		let cmd = buildUsageCommand(gen,this.usage,this.objectToken,this.obj)
		
		gen.write('execute store result score ' + temp.toString() + ' run ' + cmd)
		return {value: temp, type: ValueTypes.score}
	}
	
}



export class EntityScoreExpression extends Expression<Score> {

	constructor(private sel: Selector, private name: Token) {
		super()
	}

	getResult(ctx: AbstractContext): ValueType<Score, any> {
		return ValueTypes.score
	}
	process(proc: ProcessContext): void {
		/* let t = proc.getVariableType(this.name,true);
		if (t != ValueTypes.objective) { // or trigger
			proc.error(this.name.range,"Expected objective name");
		} */
	}
	generate(gen: GenContext): Value<Score> {
		return ValueTypes.score.of(new Score(ValueTypes.selector.toString(this.sel,{},gen),this.name.value))
	}

}
