import { VariableType, parseList, VariableTypes } from './util';
import { Statement, Lazy, parseExpression } from './parser';
import { TokenIterator, TokenType, Token } from './tokenizer';
import { CompilationContext } from './compiler';
import { CompletionItemKind } from 'vscode-languageserver';


export interface ClassDefinition {
	name: Token
	extends?: Token
	abstract?: boolean,
	properties: PropertyDef[]
	initFields: {[name: string]: Lazy<any>}
	ctor?: ParameterList
	superCall?: Lazy<any>[]
	methods: Method[]
}

export interface CustomClass {
	name: string
	extends?: CustomClass
	abstract?: boolean
	properties: Property[]
	initFields: {[name: string]: Lazy<any>}
	ctor?: ParameterList
	superCall?: Lazy<any>[]
	methods: Method[]
}

export interface PropertyDef {
	name: Token
	type: Token
	defaultValue?: Lazy<any>
}

export interface Property {
	name: string
	type: TypeId
	defaultValue?: any
}

export type TypeId = VariableType<any> | CustomClass

export class ParameterList {
	
	constructor(public params: Parameter[] | ParameterDef[], public resolved: boolean) {

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

export interface ParameterDef {
	name: Token
	type: Token
	defaultValue?: Lazy<any>
	optional?: boolean
	setToField?: boolean
}

export interface Parameter {
	name: string
	type: TypeId
	defaultValue?: Lazy<any>
	optional?: boolean
	setToField?: boolean
}

export interface Method {
	name: string
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
	let code = t.ctx.parser.codeBlock('class');
	t.ctx.insideClassDef = undefined;
	return e=>{
		
	}
}

export function parseParameters(t: TokenIterator) {
	return new ParameterList(parseList(t,'(',')',()=>parseSingleParameter(t)),false);
}

export function parseSingleParameter(t: TokenIterator): ParameterDef {
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