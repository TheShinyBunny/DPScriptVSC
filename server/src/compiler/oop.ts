import { VariableType, parseList, VariableTypes } from './util';
import { Statement, Lazy, parseExpression, Evaluator } from './parser';
import { TokenIterator, TokenType, Token } from './tokenizer';


export interface ClassDefinition {
	name: Token
	extends?: Token
	abstract?: boolean,
	properties: Property[]
	initFields: {[name: string]: Lazy<any>}
	ctor?: ParameterList
	superCall?: Lazy<any>[]
	methods: Method[]
}

export interface Property {
	name: string
	type: Token
	defaultValue?: Lazy<any>
}

export class ParameterList {
	
	constructor(public params: Parameter[]) {

	}
	
	get requiredCount() {
		let i = 0;
		for (let p of this.params) {
			if (p.optional) {
				break
			}
			i++;
		}
		return i;
	}
}


export interface Parameter {
	name: Token
	type: Token
	defaultValue?: Lazy<any>
	optional?: boolean
	setToField?: boolean
}

export interface Method {
	name: Token
	params: ParameterList
	abstract?: boolean
	code: Statement
}

export function parseClassDeclaration(t: TokenIterator): Statement {
	let pos = t.pos;
	let abstract = t.skip('abstract');
	if (!t.skip('class')) {
		t.pos = pos;
		return;
	}
	let name = t.expectType(TokenType.identifier);
	let ctor = parseParameters(t);
	let extend: Token = undefined;
	let superCall: Lazy<any>[] = undefined;
	if (t.skip('extends')) {
		extend = t.expectType(TokenType.identifier);
		superCall = parseList(t,'(',')',()=>parseExpression(t));
	}
	let cls: ClassDefinition = {
		name,
		abstract,
		ctor,
		extends: extend,
		superCall,
		initFields: {},
		methods: [],
		properties: []
	}
	t.ctx.insideClassDef = cls;
	t.ctx.script.classes.push(cls);
	let code = t.ctx.parser.codeBlock('class');
	t.ctx.insideClassDef = undefined;
	return e=>{
		e.classes.push(cls);
		e.insideClass = cls;
		code(e);
		e.insideClass = undefined;
	}
}

export function parseParameters(t: TokenIterator) {
	return new ParameterList(parseList(t,'(',')',()=>parseSingleParameter(t)));
}

export function parseSingleParameter(t: TokenIterator): Parameter {
	let type = t.expectType(TokenType.identifier);
	let setToField = t.skip('this');
	if (setToField) {
		t.expectValue('.');
	}
	let name = t.expectType(TokenType.identifier);
	if (t.skip('?')) {
		return {
			type,
			name,
			optional: true,
			setToField
		}
	}
	if (t.skip('=')) {
		let val = parseExpression(t);
		return {
			type,
			name,
			defaultValue: val,
			setToField
		}
	}
	return {
		type,
		name,
		setToField
	}
}