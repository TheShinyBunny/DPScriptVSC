import { isArray } from 'util';
import { CompletionItemKind, Range } from 'vscode-languageserver';
import { Parser, Suggestion } from './parser';
import { Token, TokenType } from './tokenizer';
import { Value, ValueType, ValueTypes } from './types/types';


export interface Parameter {
	name: string
	optional?: boolean
	type: string
	config?: any
	desc?: string
	setValues?: {[k: string]: string}
}

export type InvokeParams = {[key: string]: Value<any>}

export interface Method {
	params: Parameter[]
	command: string
	desc?: string
}

export interface MemberContainer {
	fields?: FieldList
	methods?: MethodList
}

export interface Field {
	desc?: string
	getter?: FieldGetter
	setter?: FieldSetter
	assign_operators?: {[op: string]: FieldSetter}
}

export interface FieldGetter extends MemberContainer {
	command?: string
}

export interface FieldSetter {
	type: string
	config?: any
	command: string
}

export type FieldList = {[name: string]: Field}
export type MethodList = {[name: string]: Method}

export interface MethodParseResults {
	success: boolean
	name: Token
	method?: Method
	params?: InvokeParams
}

export interface MemberUsage {
	name: Token
	success: boolean
	command?: string
	member?: Method | Field
	params?: InvokeParams
}

export function parseMemberUsage(p: Parser, name: Token, members: MemberContainer, canModifyFields: boolean): MemberUsage {
	if (p.isNext('(') && members.methods) {
		return parseMethodCall(p,name,members.methods)
	}
	if (members.fields) {
		return parseFieldUsage(p,name,members.fields,canModifyFields)
	}
	return {success: false,name}
}

export function parseMethodCall(p: Parser, name: Token, methods: MethodList): MemberUsage {
	let method = methods[name.value]
	if (!method) {
		return {success: false,name}
	}
	if (!p.expectValue('(')) return {success: false, name}
	let params: InvokeParams = {}
	let pi = 0;
	let success = true;
	p.setHover(name.range,makeMethodSignatureString(name.value,method))
	if (method.params.length > 0) {
		while (p.hasNext()) {
			if (pi < method.params.length) {
				let param = method.params[pi]
				let res = ValueType.parseById(p,param.type,param.config)
				if (res) {
					if (param.setValues) {
						for (let k in param.setValues) {
							let val = param.setValues[k]
							params[k] = {value: val.startsWith('$') ? res[val.substr(1)] : val, type: ValueTypes.string}
						}
					} else {
						params[param.name] = res
					}
					pi++
				} else if (param.optional) {
					pi++
				} else {
					p.error(p.token.range,"Expected " + ValueType.getDetailOf(param.type,param.config,param.name))
					success = false
				}
				if (p.isNext(',')) p.nextToken()
				else break
			} else {
				p.error(p.token.range,"Expected " + method.params.length + " arguments, but got " + pi);
				success = false;
				break
			}
		}
	}
	if (success) {
		console.log('next token: ',p.token)
		p.expectValue(')')
	} else {
		p.nextToken()
	}
	return {success,name,member: method,params, command: method.command}
}

function makeMethodSignatureString(name: string, method: Method) {
	return name + '(' + method.params.map(p=>p.name + ': ' + ValueType.getDetailOf(p.type,p.config || {},p.name)).join(', ') + ')'
}

function getRequiredCount(m: Method): number {
	let req = m.params.findIndex(p=>p.optional)
	return req < 0 ? m.params.length : req
}

export function parseFieldUsage(p: Parser, name: Token, fields: FieldList, canModify: boolean): MemberUsage {
	let field = fields[name.value];
	if (!field) {
		return {success: false,name}
	}
	if (p.isNext('=')) {
		if (!field.setter) {
			p.error(p.nextToken().range,"This field is read only");
			return {success: false,name}
		}
		p.setHover(name.range,name.value + ': ' + ValueType.getDetailOf(field.setter.type,field.setter.config || {},name.value))
		if (!canModify) {
			p.error(p.nextToken().range,"Cannot modify field in this context");
			return {success: false,name}
		}
		p.nextToken();
		let val = ValueType.parseById(p,field.setter.type,field.setter.config || {});
		if (val) {
			return {name,success: true,command: field.setter.command,member: field,params: {value: val}}
		}
		p.error(p.nextToken().range,"Expected value");
		return {success: false,name}
	}
	if (field.assign_operators) {
		for (let opc in field.assign_operators) {
			if (p.isNext(opc)) {
				if (!canModify) {
					p.error(p.nextToken().range,"This field is read only");
					return
				}
				p.nextToken()
				let op = field.assign_operators[opc];
				let val = ValueType.parseById(p,op.type,op.config || {});
				if (val) {
					return {name,success: true,command: op.command,member: field,params: {value: val}}
				}
				p.error(p.nextToken().range,"Expected value");
				return
			}
		}
	}
	if (field.getter) {
		if (field.getter.fields || field.getter.methods) {
			if (p.isNext('.')) {
				p.nextToken();
				if (p.isTypeNext(TokenType.identifier)) {
					return parseMemberUsage(p,p.nextToken(),field.getter,canModify)
				}
				return {success: false, name}
			}
		}
		if (field.getter.command) {
			return {success: true,name,command: field.getter.command}
		}
	}
	return {success: false,name}
}

export function getMemberSuggestions(container: MemberContainer): Suggestion[] {
	let list: Suggestion[] = []
	if (container.methods) {
		list.push(...Object.keys(container.methods).map(k=>({value: k,dec: container.methods[k].desc, kind: CompletionItemKind.Method})))
	}
	if (container.fields) {
		list.push(...Object.keys(container.fields).map(k=>({value: k,desc: container.fields[k].desc, kind: CompletionItemKind.Field})))
	}
	return list
}

export class ResourceLocation {
	constructor(public namespace: string, public path: string, public range?: Range) {

	}

	static from(str: string): ResourceLocation {
		let sep = str.indexOf(':');
		if (sep >= 0) {
			return new ResourceLocation(str.substring(0,sep),str.substring(sep + 1))
		}
		return new ResourceLocation('minecraft',str)
	}

	equals(other: ResourceLocation) {
		return this.namespace == other.namespace && this.path == other.path
	}

	toString() {
		return this.namespace + ':' + this.path
	}

	matches(str: string) {
		return this.equals(ResourceLocation.from(str))
	}
}

export function toStringResourceLocation(loc: string | ResourceLocation) {
	if (typeof loc == 'string') return loc;
	return loc.toString()
}


export function getAsArray<T>(value: T | T[]): T[] {
	return isArray(value) ? value : [value]
}

export function forEachEntry<T>(obj: {[key: string]: T}, action: (k: string, v: T)=>void) {
	Object.keys(obj).forEach(k=>{
		action(k,obj[k])
	})
}