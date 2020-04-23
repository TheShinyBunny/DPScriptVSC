import { VariableType, parseList, VariableTypes, toLowerCaseUnderscored } from './util';
import { Statement, Lazy, parseExpression, Evaluator } from './parser';
import { TokenIterator, TokenType, Token } from './tokenizer';
import { CompletionItemKind, Range } from 'vscode-languageserver';
import { CompilationContext } from './compiler';


export interface ClassDefinition {
	name: Token
	extends?: Token
	variableType: VariableType<ObjectInstance>
	abstract?: boolean
	methods: Method[]
	properties: Property[]
	ctor: ParameterList
	superCall?: Lazy<any>[]
	ctx: CompilationContext
}
/* 
export class CustomClass {
	name: string
	extends?: ClassDefinition
	abstract?: boolean
	members: Member[]
	ctor: ParameterList
	superCall?: Lazy<any>[]

	constructor(def: ClassDefinition, e: Evaluator) {
		this.name = def.name.value;
		this.extends = e.getClass(def.extends.value);
		this.abstract = def.abstract;
		this.members = def.members;
		this.ctor = def.ctor;
		this.superCall = def.superCall;
	}

	getMethod(name: Token) {
		let mem = this.getMembers();
		return mem.find()
	}

	getMembers() {
		
	}
} */

export interface Property {
	abstract?: boolean
	name: Token
	type: TypeFlag
	defaultValue?: Lazy<any>
	containingClass: ClassDefinition
}

export interface TypeFlag {
	range: Range
	base: VariableType<any>
	params?: TypeFlag[]
}

export type Member = Method | Property


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
		let args = [...values];
		let argCount = args.length;
		for (let i = 0; i < this.params.length; i++) {
			let p = this.params[i];
			let a: Lazy<any>;
			if (i >= argCount) {
				if (!p.optional) {
					e.error(callingToken.range,"Expected at least " + this.requiredCount + " arguments but got only " + argCount);
				}
				a = p.defaultValue;
			} else {
				a = args.shift();
			}
			this.applyParam(p,a,instance,e);
		}
		if (args.length > 0) {
			e.error(callingToken.range,"Expected at most " + this.params.length + " arguments but got " + argCount);
		}
	}

	applyParam(param: Parameter, value: Lazy<any>, instance: ObjectInstance, e: Evaluator) {
		if (!value) return;
		let res = value(e);
		if (!VariableType.canCast(res.type,param.type.base)) {
			e.error(value.range,"Expected an argument of type " + param.type.base.name + " but got " + res.type.name);
		}
		if (param.setToField) {
			instance.data[param.name.value] = res.value;
		}
		e.setVariable(param.name.value,{value: res.value,type: res.type});
	}

	validate(e: Evaluator) {
		let unique: string[] = [];
		for (let p of this.params) {
			if (unique.indexOf(p.name.value) >= 0) {
				e.error(p.name.range,"Duplicate parameter named " + p.name.value);
			} else {
				unique.push(p.name.value);
			}
			e.requireType(p.type);
		}
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
	type: TypeFlag
	defaultValue?: Lazy<any>
	optional?: boolean
	setToField?: boolean
}

export interface Method {
	name: Token
	params: ParameterList
	abstract?: boolean
	code: Statement
	containingClass: ClassDefinition
}

export class ObjectInstance {
	data: {[name: string]: any} = {}

	constructor(public type: ClassDefinition, init: Lazy<any>[], e: Evaluator, creationToken: Token) {
		let newE = e.recreate();
		type.ctor.apply(init,this,newE,creationToken);
		/* for (let k of Object.keys(type.initFields)) {
			let v = type.initFields[k];
			this.data[k] = newE.valueOf(v);
		} */
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
	let ctor: ParameterList = new ParameterList([]);
	if (t.isNext('(')) {
		ctor = parseParameters(t);
	}
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
		methods: [],
		properties: [],
		ctx: t.ctx,
		variableType: {
			name: name.value,
			defaultValue: undefined,
			isNative: false,
			stringify: (v)=>v.toString(),
			expressionParser: (t)=>{
				return parseNewInstanceCreation(t);
			},
			usageParser: (t,v,varName)=>parseObjectInstanceAccess(t,varName)
		}
	}
	t.ctx.insideClassDef = cls;
	t.ctx.script.classes.push(cls);
	let code = t.ctx.parser.codeBlock('class');
	t.ctx.insideClassDef = undefined;
	return e=>{
		ctor.validate(e);
		if (cls.extends) {
			let ext = e.requireClass(cls.extends);
			for (let am of getAllMethods(ext,e).filter(m=>m.abstract)) {
				if (!cls.methods.find(m=>m.name.value == am.name.value)) {
					e.error(name.range,"This class does not implement abstract method " + am.name.value + " from super class " + am.containingClass.name.value);
				}
			}
		}
		e.insideClass = cls;
		code(e);
		e.insideClass = undefined;
	}
}

export function getAllMethods(cls: ClassDefinition, e: Evaluator): Method[] {
	let list: Method[] = [...cls.methods];
	if (cls.extends) {
		list.push(...getAllMethods(e.getClass(cls.extends.value),e))
	}
	return list;
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
	let type = readTypeFlag(t);
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

export function parseNewInstanceCreation(t: TokenIterator): Lazy<ObjectInstance> {
	if (!t.expectValue('new')) return;
	let type = t.expectType(TokenType.identifier);
	let init = parseList(t,'(',')',()=>parseExpression(t));
	return e=>{
		e.suggestAt(type.range,...e.classes.map(cd=>({value: cd.name.value,kind: CompletionItemKind.Class})));
		let cls = e.requireClass(type);
		let instance = new ObjectInstance(cls,init,e,type);
		return {value: instance,type: cls.variableType};
	}
}

export function parseObjectInstanceAccess(t: TokenIterator, varName: string): Statement {
	if (!t.skip('.')) return;
	let mname = t.expectType(TokenType.identifier);
	if (t.isNext('(')) {
		let args = parseList(t,'(',')',()=>parseExpression(t));
		return e=>{
			let v = e.getVariable(varName);
			let type = v.type;
			let c = e.getClass(type.name) || (varName == 'this' ? e.insideClass : undefined)
			if (!c) {
				e.error(mname.range,"Unknown class " + type.name);
				return;
			}
			let allMethods = getAllMethods(c,e);
			e.suggestAt(mname.range,...allMethods.map(m=>({value: m.name.value,type: CompletionItemKind.Method})));
			let method = allMethods.find(m=>m.name.value == mname.value);
			if (!method) {
				e.error(mname.range,"Unknown method " + mname.value);
				return;
			}
			return runMethod(mname,method,args,v.value,e);
		}
	}
	return e=>{
		let inst = e.getVariable(varName);
		if (inst) {
			console.log("getting field " + mname.value + " of " + inst.value);
			if (!inst.value) return;
			let v = (<ObjectInstance>inst.value).data[mname.value];
			console.log('the field value is ' + v);
			console.log(v);
			if (!v) {
				e.error(mname.range,"Unknown field " + mname.value);
			}
			return v;
		}
	}
}

function runMethod(callToken: Token, method: Method, args: Lazy<any>[], instance: ObjectInstance, e: Evaluator) {
	let newE = e.recreate();
	newE.variables = {};
	for (let v of instance.type.ctx.variables) {
		for (let k of Object.keys(v)) {
			newE.variables[k] = e.getVariable(k);
		}
	}
	newE.variables['this'] = {value: instance, type: instance.type.variableType};
	method.params.apply(args,instance,newE,callToken);
	let func = e.namespace.createFunction(instance.type.name.value + "_" + toLowerCaseUnderscored(method.name.value) + callToken.range.start.line);
	newE.disableLangFeatures = true;
	newE.target = func;
	return method.code(newE);
}

export function readTypeFlag(t: TokenIterator): TypeFlag {
	let name = t.expectType(TokenType.identifier);
	let vt = VariableType.getById(name.value);
	if (vt) return {base: vt, range: name.range};
	return {base: VariableType.create(name.value), range: name.range}
}