import { DiagnosticSeverity, Range } from 'vscode-languageserver';
import { AST, Expression } from './ast';
import { DPScript } from './compiler';
import { AbstractContext } from './parser';
import { DatapackBuilder, DPScriptFile, MCFunction } from './project';
import { Token } from './tokenizer';
import { Score } from './types/score';
import { Value, ValueType } from './types/types';



export class GenContext extends AbstractContext {
	
	variables: {[name: string]: Value<any>} = {}
	uniques: {[name: string]: number} = {}
	numberConsts: number[] = []
	loadCommands: string[] = []

	constructor(public script: DPScript, public builder: DatapackBuilder, private target?: WritingTarget) {
		super()
	}

	copy() {
		let c = new GenContext(this.script,this.builder,this.target)
		c.variables = {...this.variables}
		c.numberConsts = this.numberConsts
		c.uniques = this.uniques
		c.loadCommands = this.loadCommands
		return c;
	}

	withWritingTarget(target: WritingTarget) {
		let c = this.copy()
		c.target = target;
		return c;
	}

	getVariableType(name: Token): ValueType<any> {
		let v = this.variables[name.value];
		if (v) return v.type
	}

	hasVariable(name: Token, type: ValueType<any, any>): boolean {
		throw new Error('Method not implemented.');
	}

	getUniqueId(name: string) {
		if (this.uniques[name]) return ++this.uniques[name]
		return this.uniques[name] = 1
	}

	getTemp(name: string): Score {
		let id = this.getUniqueId(name)
		this.ensureObjective('temps')
		return new Score(name + id,'temps')
	}

	createConst(num: number, name?: string) {
		if (!name) {
			name = '#' + num;
		}
		this.ensureObjective('consts')
		let score = new Score(name,'consts')
		if (this.numberConsts.indexOf(num) < 0) {
			this.load('scoreboard players set ' + score.toString() + ' ' + num)
		}
		return score
	}



	generateFunction(name: string, cmds: string[]) {
		let func = new MCFunction(this.script,name + this.getUniqueId(name))
		func.commands.push(...cmds)
		this.builder.entries.push(func)
		return func
	}
	
	write(...cmds: string[]) {
		if (this.target) {
			for (let c of cmds) {
				this.target(c)
			}
		}
	}

	ensureObjective(name: string) {
		if (this.builder.objectives.indexOf(name) < 0) {
			this.builder.objectives.push(name)
			this.load('scoreboard objectives add ' + name + ' dummy')
		}
	}

	load(cmd: string) {
		this.loadCommands.push(cmd)
	}

	getCommands(ast: AST<any>) {
		let cmds: string[] = []
		let c = this.withWritingTarget((c)=>{
			cmds.push(c)
		})
		ast.generate(c)
		return cmds
	}

	groupCommandsFrom(name: string, ast: AST<any>) {
		return this.groupCommands(name,this.getCommands(ast))
	}

	groupCommands(name: string, cmds: string[]) {
		if (cmds.length > 1) {
			return 'function ' + this.generateFunction(name,cmds).id
		} else if (cmds.length === 1) {
			return cmds[0]
		}
		return 'say EMPTY STATEMENT'
	}



	stringify(value: Expression<any> | Value<any>): string {
		if (!value) return 'undefined'
		if (value instanceof Expression) {
			return this.stringify(value.generate(this))
		}
		return value.type.toString(value.value,{},this);
	}

}

type WritingTarget = (cmd: string)=>void