import { DiagnosticSeverity, Position, Range } from 'vscode-languageserver';
import { DPScript } from './compiler';
import { AbstractContext, Variable } from './parser';
import { Token } from './tokenizer';
import { ValueType } from './types/types';



export class ProcessContext extends AbstractContext {
	

	variables: {[name: string]: Variable}[] = [{}]
	uniques: {[id: string]: Token[]} = {}

	constructor(public script: DPScript, public pos?: Position) {
		super()
	}

	getVariableType(name: Token, require = false): ValueType<any> {
		let v = this.getVariable(name,require);
		if (v) return v.type
	}

	getVariable(name: Token, require = false): Variable {
		for (let f of this.variables) {
			if (f[name.value]) {
				return f[name.value]
			}
		}
		
		/* if (require) {
			this.error(name.range,"Unknown variable " + name.value)
		} */
	}

	addVariable(name: string, v: Variable) {
		if (this.variables.length > 0) {
			this.variables[this.variables.length-1][name] = v
		}
	}


	push() {
		this.variables.unshift({})
	}

	pop() {
		this.variables.shift()
	}

	pushed(run: ()=>void) {
		this.push()
		run()
		this.pop()
	}

}
