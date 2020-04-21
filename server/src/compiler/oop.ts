import { VariableType, parseList, VariableTypes } from './util';
import { Statement, Lazy, parseExpression, Evaluator } from './parser';
import { TokenIterator, TokenType, Token } from './tokenizer';
import { CompletionItemKind } from 'vscode-languageserver';


export interface ClassDefinition {
	name: Token
	extends?: Token
	variableType: VariableType<ObjectInstance>
	abstract?: boolean,
	properties: Property[]
	initFields: {[name: string]: Lazy<any>}
	ctor?: ParameterList
	superCall?: Lazy<any>[]
	methods: Method[]
}

export interface Property {
	name: Token
	type: Token
	defaultValue?: Lazy<any>
	containingClass: ClassDefinition
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

	apply(values: Lazy<any>[], instance: ObjectInstance, e: Evaluator, callingToken: Token) {
		let argCount = values.length;
		for (let i = 0; i < this.params.length; i++) {
			let p = this.params[i];
			let a: Lazy<any>;
			if (i >= argCount) {
				if (!p.optional) {
					e.error(callingToken.range,"Expected at least " + this.requiredCount + " arguments but got only " + argCount);
				}
				a = p.defaultValue;
			} else {
				a = values.shift();
			}
			this.applyParam(p,a,instance,e);
		}
	}

	applyParam(param: Parameter, value: Lazy<any>, instance: ObjectInstance, e: Evaluator) {
		if (!value) return;
		let res = value(e);
		let t = getTypeByName(param.type.value,e);
		if (t) {
			if (!VariableType.canCast(res.type,t)) {
				e.error(value.range,"Expected an argument of type " + t.name + " but got " + res.type);
			}
			if (param.setToField) {
				instance.data[param.name.value] = res.value;
			}
		}
	}

	validate(e: Evaluator) {
		
	}
}

export function getTypeByName(name: string, e: Evaluator): VariableType<any> {
	let vt = VariableType.getById(name);
	if (vt) return vt;
	let cls = e.getClass(name);
	if (cls) return cls.variableType;
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

export class ObjectInstance {
	data: {[name: string]: any}

	constructor(public type: ClassDefinition, init: Lazy<any>[], e: Evaluator, creationToken: Token) {
		type.ctor.apply(init,this,e,creationToken);
	}

	toString() {
		return this.type.name.value + '({' + Object.keys(this.data).map(k=>k + '=' + this.data[k]).join(',') + '})';
	}
}

export function parseClassDeclaration(t: TokenIterator): Statement {
	let pos = t.pos;
	let abstract = t.skip('abstract');
	if (!t.skip('class')) {
		t.pos = pos;
		return;
	}
	let name = t.expectType(TokenType.identifier);
	t.ctx.ensureUniqueClass(name);
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
		properties: [],
		variableType: {
			name: name.value,
			defaultValue: undefined,
			isNative: false,
			stringify: (v)=>v.toString(),
			expressionParser: (t)=>{
				return parseNewInstanceCreation(t,cls);
			},
			usageParser: (t,v,varName)=>parseObjectInstanceAccess(t,varName,cls)
		}
	}
	t.ctx.insideClassDef = cls;
	t.ctx.script.classes.push(cls);
	let code = t.ctx.parser.codeBlock('class');
	t.ctx.insideClassDef = undefined;
	return e=>{
		ctor.validate(e);
		let ext: ClassDefinition = undefined;
		if (cls.extends) {
			ext = e.requireClass(cls.extends);
		}
		e.insideClass = cls;
		code(e);
		e.insideClass = undefined;
	}
}

export function getClassProperty(cls: ClassDefinition, name: string, e: Evaluator): Property {
	let f = cls.properties.find(p=>p.name.value == name);
	if (f) return f;
	if (!cls.extends) return;
	let sup = e.getClass(cls.extends.value);
	return getClassProperty(sup,name,e);
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

export function parseNewInstanceCreation(t: TokenIterator, suggestedType?: ClassDefinition): Lazy<ObjectInstance> {
	if (!t.expectValue('new')) return;
	if (suggestedType) {
		t.suggestHere({value: suggestedType.name.value,type: CompletionItemKind.Class});
	}
	let type = t.expectType(TokenType.identifier);
	let init = parseList(t,'(',')',()=>parseExpression(t));
	return e=>{
		e.suggestAt(type.range,...e.classes.map(cd=>({value: cd.name.value,kind: CompletionItemKind.Class})))
		let cls = e.requireClass(type);
		return {value: new ObjectInstance(cls,init,e,type),type: cls.variableType};
	}
}

export function parseObjectInstanceAccess(t: TokenIterator, varName: string, cls?: ClassDefinition): Statement {
	return e=>{}
}