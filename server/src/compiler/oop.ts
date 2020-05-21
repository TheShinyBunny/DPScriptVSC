import { VariableType, parseList, VariableTypes, toLowerCaseUnderscored, Variable } from './util';
import { Statement, Lazy, parseExpression, Evaluator, Scope, RegisterStatement } from './parser';
import { TokenIterator, TokenType, Token } from './tokenizer';
import { CompletionItemKind, Range } from 'vscode-languageserver';
import { CompilationContext } from './compiler';


export class ClassDefinition {
	extends?: Token
	variableType: VariableType<ObjectInstance>
	abstract?: boolean
	methods: Method[] = []
	properties: Property[] = []
	ctor: ParameterList
	superCall?: TokenIterator

	superClass?: ClassDefinition;

	constructor(public name: Token, public ctx: CompilationContext) {
		this.variableType = {
			defaultValue: undefined,
			isPrimitive: false,
			name: name.value,
			stringify: (i,e)=>i.toString(),
			isClass: true
		}
	}

	getAllProps(e: Evaluator) {
		let list = [...this.properties];
		if (this.extends) {
			list.push(...this.getSuperclass(e).getAllProps(e));
		}
		return list;
	}

	getAllMethods(e: Evaluator): Method[] {
		let list: Method[] = [...this.methods];
		if (this.extends) {
			let sc = this.getSuperclass(e);
			list.push(...sc.getAllMethods(e));
		}
		return list;
	}

	getSuperclass(e: Evaluator) {
		if (!this.extends) return;
		return this.superClass || (this.superClass = e.getClass(this.extends.value));
	}

	init(instance: ObjectInstance, e: Evaluator, initArgs: Lazy<any>[], errorsToken: Token) {
		if (this.extends) {
			let sc = this.getSuperclass(e);
			sc.init(instance,e,sc.ctor.parse(this.superCall),errorsToken);
		}
		this.ctor.apply(initArgs,instance,e,errorsToken);
		this.initProps(instance,e);
	}

	initProps(instance: ObjectInstance, e: Evaluator) {
		for (let p of this.getAllProps(e)) {
			if (p.containingClass == this) {
				if (instance.data[p.name.value] === undefined && p.defaultValue) {
					instance.data[p.name.value] = p.defaultValue(e);
				} else {
					instance.data[p.name.value] = {value: p.type.base.defaultValue, type: p.type.base};
				}
			} else {
				if (p.abstract) {
					if (p.containingClass != this && instance.data[p.name.value] === undefined) {
						e.error(this.name.range,"This class does not initialize abstract property " + p.name.value + " from superclass " + p.containingClass.name.value);
					}
				}
			}
		}
	}
}

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
			instance.data[param.name.value] = res;
		}
		e.setVariable(param.name.value,res);
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

	parse(t: TokenIterator): Lazy<any>[] {
		return parseList(t,'(',')',(i)=>{
			if (i < this.params.length) {
				return parseExpression(t,this.params[i].type.base);
			}
			return parseExpression(t);
		});
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
	data: {[name: string]: Variable<any>} = {}

	constructor(public type: ClassDefinition, init: Lazy<any>[], e: Evaluator, creationToken: Token) {
		let newE = e.recreate();
		type.init(this,newE,init,creationToken);
	}

	toString() {
		return this.type.name.value + '({' + Object.keys(this.data).map(k=>k + '=' + this.data[k].value).join(',') + '})';
	}
}

export class ClassScope extends Scope {
	@RegisterStatement()
	prop(): Statement {
		if (!this.ctx.insideClassDef) return;
		let name = this.tokens.expectType(TokenType.identifier);
		this.tokens.expectValue(':');
		let type = readTypeFlag(this.tokens);
		let value: Lazy<any> = undefined;
		if (this.tokens.skip('=')) {
			value = parseExpression(this.tokens,type.base);
		}
		let prop: Property = {
			name,
			type,
			containingClass: this.ctx.insideClassDef,
			defaultValue: value
		};
		if (this.ctx.insideClassDef.properties.find(p=>p.name.value == name.value)) {
			this.tokens.error(name.range,"Duplicate property " + name.value);
		}
		this.ctx.insideClassDef.properties.push(prop);
		return e=>{
			let cls = e.insideClass;
			if (!cls) {
				console.log("PROP NOT INSIDE CLASS");
				return;
			}
			if (cls.extends) {
				let pr = getClassProperty(e.getClass(cls.name.value),name.value,e);
				if (pr) {
					e.error(name.range,"Cannot override property from super class " + pr.containingClass.name.value);
				}
			}
			e.requireType(type);
		}
	}

	@RegisterStatement({inclusive: true})
	classMethod(): Statement {
		if (!this.tokens.isTypeNext(TokenType.identifier) || !this.ctx.insideClassDef) return;
		let abstract = this.tokens.skip('abstract');
		let name = this.tokens.expectType(TokenType.identifier);
		if (!this.tokens.isNext('(')) return;
		let add = true;
		if (this.ctx.insideClassDef.methods.find(m=>m.name.value == name.value)) {
			this.tokens.error(name.range,"Duplicate method " + name.value);
			add = false;
		}
		let params = parseParameters(this.tokens);
		this.ctx.enterBlock();
		params.params.forEach(p=>{
			this.ctx.addVariable(p.name,p.type.base);
		})
		let ctxSnap = this.ctx.snapshot();
		let code = this.parser.parseBlock("function");
		this.ctx.exitBlock();
		if (add) {
			this.ctx.insideClassDef.methods.push({name,params,code,abstract,containingClass: this.ctx.insideClassDef});
		}
		return e=>{
			params.validate(e);
			// let newE = e.recreate();
			// newE.variables = {};
			// for (let v of ctxSnap.variables) {
			// 	for (let k of Object.keys(v)) {
			// 		newE.variables[k] = e.getVariable(k);
			// 	}
			// }
			// newE.disableWriting = true;
			// newE.setVariable('this',{value: undefined, type: newE.insideClass.variableType});
			// for (let p of params.params) {
			// 	newE.setVariable(p.name.value,{value: p.type.base.defaultValue,type: p.type.base});
			// }
			// code(newE);
		}
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
	let cls = new ClassDefinition(name,t.ctx);
	cls.abstract = abstract;
	let ctor: ParameterList = new ParameterList([]);
	if (t.isNext('(')) {
		ctor = parseParameters(t);
	}
	cls.ctor = ctor;
	let extend: Token = undefined;
	let superCall: TokenIterator = undefined;
	if (t.skip('extends')) {
		extend = t.expectType(TokenType.identifier);
		if (t.isNext('(')) {
			superCall = t.collectInsideBrackets('(',')',t.ctx.snapshot());
		}
	}
	cls.extends = extend;
	cls.superCall = superCall;
	t.ctx.insideClassDef = cls;
	t.ctx.script.classes.push(cls);
	t.ctx.enterBlock();
	t.ctx.addVariable({value: 'this',range: name.range, type: TokenType.identifier},cls.variableType);
	if (!t.ctx.parser) {
		console.log("THERE IS NO PARSER IN THE CONTEXT");
	}
	let code = t.ctx.parser.parseBlock('class');
	t.ctx.exitBlock();
	t.ctx.insideClassDef = undefined;
	return e=>{
		ctor.validate(e);
		if (cls.extends) {
			let ext = e.requireClass(cls.extends);
			if (ext) {
				for (let am of ext.getAllMethods(e).filter(m=>m.abstract)) {
					if (!cls.methods.find(m=>m.name.value == am.name.value)) {
						e.error(name.range,"This class does not implement abstract method " + am.name.value + " from super class " + am.containingClass.name.value);
					}
				}
			}
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
	let init = t.collectInsideBrackets('(',')',t.ctx.snapshot());
	return e=>{
		e.suggestAt(type.range,...e.classes.map(cd=>({value: cd.name.value,kind: CompletionItemKind.Class})));
		e.suggestAt(type.range,...VariableType.nonNatives().map(t=>({value: t.name, kind: CompletionItemKind.Class})));
		let vtype = VariableType.getById(type.value);
		if (vtype) {
			let parsed = parseExpression(init,vtype);
			return parsed(e);
		}
		let cls = e.requireClass(type);
		let args = cls.ctor.parse(init);
		let instance = new ObjectInstance(cls,args,e,type);
		return {value: instance,type: cls.variableType};
	}
}

export function parseObjectInstanceAccess(t: TokenIterator, accessedVar: Lazy<any>): Lazy<any> {
	return parseAccessNode(t,accessedVar);
}

function parseAccessNode(t: TokenIterator, currentGetter: Lazy<any>): Lazy<any> {
	if (!t.skip('.')) return;
	let mname = t.expectType(TokenType.identifier);
	if (t.isNext('(')) {
		let args = t.collectInsideBrackets('(',')',t.ctx.snapshot());
		return chainAccess(t,e=>{
			let v = currentGetter(e);
			let type = v.type;
			let c = e.getClass(type.name)
			if (!c) {
				e.error(mname.range,"Unknown class " + type.name);
				return;
			}
			let allMethods = c.getAllMethods(e);
			e.suggestAt(mname.range,...allMethods.map(m=>({value: m.name.value,type: CompletionItemKind.Method})));
			let method = allMethods.find(m=>m.name.value == mname.value);
			if (!method) {
				e.error(mname.range,"Unknown method " + mname.value);
				return;
			}
			let resArgs = method.params.parse(args);
			let ret = runMethod(mname,method,resArgs,v.value,e);
			if (ret) {
				return ret;
			}
		});
	};
	return chainAccess(t,e=>{
		let inst = currentGetter(e);
		if (inst) {
			console.log("getting field " + mname.value + " of " + inst.value);
			if (!inst.value) return;
			let v = (<ObjectInstance>inst.value).data[mname.value];
			if (!v) {
				e.error(mname.range,"Unknown field " + mname.value);
			}
			return v;
		}
	});
}

function chainAccess(t: TokenIterator, accessSoFar: Lazy<any>): Lazy<any> {
	if (t.isNext('.')) {
		return parseAccessNode(t,accessSoFar);
	}
	return accessSoFar;
}

function runMethod(callToken: Token, method: Method, args: Lazy<any>[], instance: ObjectInstance, e: Evaluator): Variable<any> {
	let newE = e.recreate();
	newE.variables = {};
	for (let v of instance.type.ctx.variables) {
		for (let k of Object.keys(v)) {
			newE.setVariable(k,e.getVariable(k));
		}
	}
	method.params.apply(args,instance,newE,callToken);
	let func = e.currentFile.createFunction(instance.type.name.value + "_" + toLowerCaseUnderscored(method.name.value) + callToken.range.start.line,false);
	newE.target = func;
	let ret = method.code(newE);
	if (ret) {
		return ret;
	}
}

export function readTypeFlag(t: TokenIterator): TypeFlag {
	let name = t.expectType(TokenType.identifier);
	let vt = VariableType.getById(name.value);
	if (vt) return {base: vt, range: name.range};
	return {base: VariableType.create(name.value), range: name.range}
}