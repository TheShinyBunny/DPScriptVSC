import { Expression, Statement } from './ast';
import { GenContext } from './generate';
import { Parser } from './parser';
import { ProcessContext } from './process';
import { TokenType } from './tokenizer';
import { Condition, getCondCommands } from './types/condition';
import { Selector } from './types/selector';
import { ValueType, ValueTypes } from './types/types';

export class ExecuteSelectorStatement extends Statement {

	constructor(private selector: Selector, private code: Statement, private commandPrefix: string, private commandSuffix?: string) {
		super()
	}

	process(proc: ProcessContext): void {
		//ValueTypes.selector.process(proc,this.selector,{})
		proc.pushed(()=>this.code.process(proc))
	}
	generate(gen: GenContext): void {
		let cmd = gen.groupCommandsFrom('execute',this.code)
		gen.write('execute ' + this.commandPrefix + ' ' + ValueTypes.selector.toString(this.selector,{},gen) + (this.commandSuffix ? ' ' + this.commandSuffix : '') + ' run ' + cmd)
	}
	
}

export class IfStatement extends Statement {
	constructor(private expr: Expression<any>, private code: Statement, private elseCode?: Statement) {
		super()
	}

	process(proc: ProcessContext): void {
		this.expr.process(proc)
		proc.pushed(()=>{
			this.code.process(proc)
			
		})
		if (this.elseCode) {
			proc.pushed(()=>{
				this.elseCode.process(proc)
			})
		}
	}
	generate(gen: GenContext): void {
		let res = this.expr.generate(gen)
		console.log('res',res)
		if (res && res.type.matches(ValueTypes.condition)) {
			let cond: Condition = res.value;
			let exeIf = []
			exeIf.push(...gen.getCommands(this.code))
			let temp = gen.getTemp('ranIf')
			if (this.elseCode) {
				gen.write('scoreboard players set ' + temp.toString() + ' 0')
				exeIf.push('scoreboard players set ' + temp.toString() + ' 1')
			}
			let cmd = gen.groupCommands('if',exeIf);
			gen.write(...getCondCommands(cond,cmd,gen))
			if (this.elseCode) {
				let elseCmd = gen.groupCommandsFrom('else',this.elseCode)
				gen.write('execute unless score ' + temp.toString() + ' matches 1 run ' + elseCmd)
			}
		}
		
	}
	
}

export namespace Execute {

	export function parseFor(p: Parser): Statement {
		p.nextToken()
		let selector = ValueTypes.selector.parse(p)
		if (selector) {
			let t = p.contextSelfType
			p.contextSelfType = selector.type
			let code = p.parseStatement()
			p.contextSelfType = t
			return new ExecuteSelectorStatement(selector,code,'as','at @s')
		}
	}

	export function parseAs(p: Parser) {
		p.nextToken()
		let selector = ValueTypes.selector.parse(p)
		if (selector) {
			let t = p.contextSelfType
			p.contextSelfType = selector.type
			let code = p.parseCodeBlock()
			p.contextSelfType = t
			return new ExecuteSelectorStatement(selector,code,'as')
		}
	}

	export function parseAt(p: Parser) {
		p.nextToken()
		let selector = ValueTypes.selector.parse(p)
		if (selector) {
			let code = p.parseCodeBlock()
			return new ExecuteSelectorStatement(selector,code,'at')
		}
	}

	export function parseIf(p: Parser) {
		p.nextToken()
		if (p.expectValue('(')) {
			let expr = p.parseExpression(ValueTypes.condition)
			if (expr) {
				if (p.expectValue(')')) {
					console.log('first after if parentheses',p.token)
					let code = p.parseStatement()
					let elseCode: Statement
					while (p.hasNext()) {
						if (p.isNext('else')) {
							p.nextToken()
							elseCode = p.parseStatement()
							break
						} else if (p.isTypeNext(TokenType.line_end) && p.peek(1).type == TokenType.line_end || p.peek(1).value == 'else') {
							p.nextToken()
						} else {
							break
						}
					}
					return new IfStatement(expr,code,elseCode)
				}
			}
		}
	}

}