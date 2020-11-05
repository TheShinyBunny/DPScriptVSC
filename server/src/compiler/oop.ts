import { VariableType, VariableTypes, toLowerCaseUnderscored, Variable } from './util';
import { Statement, Lazy, parseExpression, Evaluator, Scope, RegisterStatement, Scopes, castExprResult, RangedLazy } from './parser';
import { TokenIterator, TokenType, Token, INVALID_POS } from './tokenizer';
import { CompletionItemKind, Range, SymbolKind, DocumentHighlightKind } from 'vscode-languageserver';
import { CompilationContext, DeclarationSpan } from './compiler';
import { isBoolean } from 'util';
import { Parsers, CustomValueParser } from './parsers/parsers';
import { NBTEntry } from './nbt';


export class ClassDefinition {
	extends?: Token
	variableType: VariableType<ObjectInstance>
	abstract?: boolean
	methods: Method[] = []
	properties: Property[] = []
	ctor: ParameterList
	superCall?: RangedLazy<any>[]
	declaration: DeclarationSpan
	entity?: NBTEntry

	superClass?: ClassDefinition;

	constructor(public name: Token, public ctx: CompilationContext) {
		this.variableType = VariableType.create(name.value)
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
			if (sc) {
				list.push(...sc.getAllMethods(e));
			} else {
				console.log('super class not found:',this.extends.value)
			}
		}
		return list;
	}

	getSuperclass(e: Evaluator) {
		if (!this.extends) return;
		return this.superClass || (this.superClass = e.getClass(this.extends.value));
	}

	init(instance: ObjectInstance, e: Evaluator, initArgs: RangedLazy<any>[], errorsToken: Token) {
		if (this.extends) {
			let sc = this.getSuperclass(e);
			if (sc) {
				sc.init(instance,e,this.superCall || [],errorsToken);
			}
		}
		this.ctor.apply(initArgs,instance,e,errorsToken);
		this.initProps(instance,e);
	}

	initProps(instance: ObjectInstance, e: Evaluator) {
		for (let p of this.properties) {
			//console.log('setting prop',p.name,p.type);
			if (p.containingClass == this) {
				if (instance.data[p.name] === undefined && p.defaultValue) {
					instance.data[p.name] = p.defaultValue(e);
				} else {
					instance.data[p.name] = {value: p.type.base.defaultValue, type: p.type.base};
				}
			} else {
				if (p.abstract) {
					if (p.containingClass != this && instance.data[p.name] === undefined) {
						e.error(this.name.range,"This class does not initialize abstract property " + p.name + " from superclass " + p.containingClass.name.value);
					}
				}
			}
		}
	}
}

export interface Property {
	abstract?: boolean
	name: string
	type: TypeFlag
	defaultValue?: Lazy<any>
	containingClass: ClassDefinition
	declaration: DeclarationSpan
	desc?: string
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

	apply(values: RangedLazy<any>[], instance: ObjectInstance, e: Evaluator, callingToken: Token) {
		let args = [...values];
		let argCount = args.length;
		for (let i = 0; i < this.params.length; i++) {
			let p = this.params[i];
			let a: RangedLazy<any>;
			if (i >= argCount) {
				if (!p.optional) {
					e.error(callingToken.range,"Expected at least " + this.requiredCount + " arguments but got only " + argCount);
				}
				a = Lazy.ranged(p.defaultValue,INVALID_POS);
			} else {
				a = args.shift();
			}
			this.applyParam(p,a,instance,e);
		}
		if (args.length > 0) {
			e.error(callingToken.range,"Expected at most " + this.params.length + " arguments but got " + argCount);
		}
	}

	applyParam(param: Parameter, value: RangedLazy<any>, instance: ObjectInstance, e: Evaluator) {
		if (!value) return;
		let res = castExprResult(value(e),param.type.base,e,value.range);
		if (param.setToField) {
			instance.data[param.name.value] = res;
		}
		e.setVariable(param.name.value,{...res, decl: e.toLocation(param.name.range)});
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
	name: string
	params: ParameterList
	abstract?: boolean
	code: Statement
	containingClass: ClassDefinition
	declaration: DeclarationSpan
}

export class ObjectInstance {
	
	data: {[name: string]: Variable<any>} = {}

	constructor(public type: ClassDefinition, init: RangedLazy<any>[], e: Evaluator, creationToken: Token) {
		let newE = e.recreate();
		type.init(this,newE,init,creationToken);
	}

	toString() {
		return this.type.name.value + '({' + Object.keys(this.data).map(k=>k + '=' + this.data[k].value).join(',') + '})';
	}

	get(name: string): Variable<any> {
		if (this.type.entity) {
			// todo: use /data get
		} else {
			return this.data[name];
		}
	}
	set(name: string, v: Variable<any>) {
		if (this.type.entity) {
			// todo: use /data modify
		} else {
			this.data[name] = v;
		}
	}
}

export class ClassScope extends Scope {
	@RegisterStatement()
	prop(): Statement {
		if (!this.ctx.insideClassDef) return;
		let name = this.tokens.expectType(TokenType.identifier);
		this.ctx.editor.addSymbol(name.range,name.value,SymbolKind.Property,DocumentHighlightKind.Write);
		this.tokens.expectValue(':');
		let type = readTypeFlag(this.tokens);
		let value: Lazy<any> = undefined;
		if (this.tokens.skip('=')) {
			value = parseExpression(this.tokens,type.base);
		}
		let prop: Property = {
			name: name.value,
			type,
			containingClass: this.ctx.insideClassDef,
			defaultValue: value,
			declaration: {name: name.range, uri: this.ctx.script.uri}
		};
		if (this.ctx.insideClassDef.properties.find(p=>p.name == name.value)) {
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
				let pr = getClassProperty(e.getClass(cls.extends.value),name.value,e);
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
		let range = this.tokens.startRange();
		let abstract = this.tokens.skip('abstract');
		let name = this.tokens.expectType(TokenType.identifier);
		if (!this.tokens.isNext('(')) return;
		let add = true;
		if (this.ctx.insideClassDef.methods.find(m=>m.name == name.value)) {
			this.tokens.error(name.range,"Duplicate method " + name.value);
			add = false;
		}
		let params = parseParameters(this.tokens);
		this.ctx.enterBlock();
		params.params.forEach(p=>{
			this.ctx.addVariable(p.name,p.type.base);
		})
		let ctxSnap = this.ctx.snapshot();
		let code = this.parser.parseBlock(Scopes.function);
		this.ctx.exitBlock();
		this.tokens.endRange(range);
		if (add) {
			this.ctx.insideClassDef.methods.push({name: name.value,params,code,abstract,containingClass: this.ctx.insideClassDef,declaration: {name: name.range, uri: this.ctx.script.uri, fullRange: range}});
		}
		this.ctx.editor.addSymbolGroup(name,range,SymbolKind.Method);
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
	let range = t.startRange();
	let abstract = t.skip('abstract');
	if (!t.skip('class')) {
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
	let superCall: RangedLazy<any>[] = undefined;
	if (t.skip('extends')) {
		extend = t.expectType(TokenType.identifier);
		if (t.isNext('(')) {
			superCall = Parsers.list.parse(t,{item: new CustomValueParser('SuperParameter',t=>parseExpression(t))})
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
	let code = t.ctx.parser.parseBlock(new ClassScope());
	t.ctx.exitBlock();
	t.ctx.insideClassDef = undefined;
	t.endRange(range);
	cls.declaration = {name: name.range,uri: t.ctx.script.uri,fullRange: range};
	t.ctx.editor.addSymbolGroup(name,range,SymbolKind.Class);
	return e=>{
		ctor.validate(e);
		if (cls.extends) {
			let ext = e.requireClass(cls.extends);
			if (ext) {
				for (let am of ext.getAllMethods(e).filter(m=>m.abstract)) {
					if (!cls.methods.find(m=>m.name == am.name)) {
						e.error(name.range,"This class does not implement abstract method " + am.name + " from super class " + am.containingClass.name.value);
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
	let f = cls.properties.find(p=>p.name == name);
	if (f) return f;
	if (!cls.extends) return;
	let sup = e.getClass(cls.extends.value);
	if (!sup) return;
	return getClassProperty(sup,name,e);
}

export function parseParameters(t: TokenIterator) {
	return new ParameterList(Parsers.list.parse(t,{open: '(',close: ')',item: new CustomValueParser('Parameter',()=>parseSingleParameter(t))}));
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

function parseParameterCallList(t: TokenIterator): RangedLazy<any>[] {
	return Parsers.list.parse(t,{open: '(',close: ')',item: new CustomValueParser('Parameter',t=>parseExpression(t))})
}

export function parseNewInstanceCreation(t: TokenIterator): Lazy<ObjectInstance> {
	if (!t.skip('new')) return;
	let type = t.expectType(TokenType.identifier);
	let call = parseParameterCallList(t);
	return e=>{
		e.suggestAt(type.range,...e.classes.map(cd=>({value: cd.name.value,kind: CompletionItemKind.Class})));
		e.suggestAt(type.range,...VariableType.nonNatives().map(t=>({value: t.name, kind: CompletionItemKind.Class})));
		let vtype = VariableType.getById(type.value);
		if (vtype) {
			if (call.length != 1) {
				e.error(type.range,"Expected only 1 argument for builtin variable creation");
				if (call.length == 0) return;
			}
			return call[0](e);
		}
		let cls = e.requireClass(type);
		if (!cls) return {value: undefined, type: VariableTypes.any};
		let instance = new ObjectInstance(cls,call,e,type);
		return {value: instance,type: cls.variableType};
	}
}

export function parseObjectInstanceAccess(t: TokenIterator, accessedVar: Lazy<any>, allowModify: boolean = false): Lazy<any> {
	return parseAccessNode(t,accessedVar,allowModify);
}

function parseAccessNode(t: TokenIterator, currentGetter: Lazy<any>, allowModify: boolean = false): Lazy<any> {
	if (!t.skip('.')) {
		return currentGetter
	}
	let mname = t.expectType(TokenType.identifier);
	if (t.isNext('(')) {
		let args = parseParameterCallList(t);
		return chainAccess(t,e=>{
			let v = currentGetter(e);
			//console.log("accessing method " + mname.value + " in var",v);
			let type = v.type;
			let c = e.getClass(type.name)
			if (!c) {
				e.error(mname.range,"Cannot resolve method " + mname.value + " of " + type.name);
				return;
			}
			let allMethods = c.getAllMethods(e);
			e.suggestAt(mname.range,...allMethods.map(m=>({value: m.name,type: CompletionItemKind.Method})));
			let method = allMethods.find(m=>m.name == mname.value);
			if (!method) {
				e.error(mname.range,"Unknown method " + mname.value);
				return;
			}
			e.file.editor.declarationLinks.push({range: mname.range, decl: method.declaration});
			let ret = runMethod(mname,method,args,v.value,e);
			if (ret) {
				return ret;
			}
		},allowModify);
	};
	let newVal: TokenIterator;
	if (allowModify && t.skip('=')) {
		newVal = t.collectToLineEnd();
	}
	return chainAccess(t,e=>{
		let inst = currentGetter(e);
		if (inst) {
			if (!inst.value) return;
			let obj = <ObjectInstance>inst.value;
			let t = obj.type;
			e.suggestAt(mname.range,...[
				...t.getAllMethods(e).map(m=>({value: m.name,type: CompletionItemKind.Method})),
				...t.getAllProps(e).map(p=>({value: p.name, type: CompletionItemKind.Property, desc: p.desc, detail: p.type.base.name}))
			]);
			
			let fds = t.getAllProps(e);
			let f = fds.find(fd=>fd.name == mname.value);
			if (f) {
				t.ctx.editor.setHover(mname.range,{syntax: mname.value + ': ' + f.type.base.name, desc: f.desc})
				e.file.editor.declarationLinks.push({range: mname.range,decl: f.declaration});
				if (newVal) {
					if (!f.type.base.parser) return
					newVal.reset();
					let val = f.type.base.parser(newVal);
					newVal.errorIfHasExtras();
					let res = castExprResult(val(e),f.type.base,e,newVal.fullRange);
					obj.set(mname.value,res);
				} else {
					return obj.get(mname.value);
				}
			} else {
				e.error(mname.range,"Unknown property " + mname.value)
			}
		}
	},allowModify);
}

function chainAccess(t: TokenIterator, accessSoFar: Lazy<any>, allowModify: boolean = false): Lazy<any> {
	if (t.isNext('.')) {
		return parseAccessNode(t,accessSoFar,allowModify);
	}
	return accessSoFar;
}

function runMethod(callToken: Token, method: Method, args: RangedLazy<any>[], instance: ObjectInstance, e: Evaluator): Variable<any> {
	let newE = e.recreate();
	newE.variables = {};
	for (let v of instance.type.ctx.variables) {
		for (let k of Object.keys(v)) {
			newE.setVariable(k,e.getVariable(k));
		}
	}
	newE.setVariable('this',{decl: {name: instance.type.name.range,uri: ''},type: instance.type.variableType,value: instance})
	method.params.apply(args,instance,newE,callToken);
	let func = e.file.createFunction(instance.type.name.value + "_" + toLowerCaseUnderscored(method.name) + callToken.range.start.line,false);
	e.write('function ' + func.loc.toString());
	newE.target = func;
	let ret = method.code(newE);
	if (!isBoolean(ret) && ret) {
		return ret;
	}
}

export function readTypeFlag(t: TokenIterator): TypeFlag {
	let name = t.expectType(TokenType.identifier);
	t.ctx.editor.addSymbol(name.range,name.value,SymbolKind.Class)
	let vt = VariableType.getById(name.value);
	if (vt) return {base: vt, range: name.range};
	return {base: VariableType.create(name.value), range: name.range}
}