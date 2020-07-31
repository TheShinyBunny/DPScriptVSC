import { TokenIterator, TokenType } from './tokenizer';
import { Evaluator, Statement } from './parser';
import { MCFunction } from '.';
import { VariableTypes, MethodParameter, parseMethod, getSignatureFromParam } from './util';
import { SignatureHelp } from 'vscode-languageserver';
import { Range } from 'vscode-languageserver-textdocument';

export interface AnnotationTarget<T> {
	label: string
}

export namespace Targets {
	export const func: AnnotationTarget<MCFunction> = {
		label: 'functions'
	}
	export const tick: AnnotationTarget<MCFunction> = {
		label: 'tick functions'
	}
	export const load: AnnotationTarget<MCFunction> = {
		label: 'load functions'
	}
}


export interface Annotation<T> {
	name: string
	params: MethodParameter[]
	target: AnnotationTarget<T>
	usedOn: (target: T, e: Evaluator, params: any)=>void
}

export interface AnnotationInstance {
	type: Annotation<any>
	params: any
	range: Range
}

export namespace Annotations {
	export const triggered: Annotation<MCFunction> = {
		name: 'triggered',
		target: Targets.func,
		params: [
			{
				key: 'trigger',
				type: VariableTypes.trigger
			},
			{
				key: 'value',
				type: VariableTypes.integer,
				optional: true
			},
			{
				key: 'maxValue',
				type: VariableTypes.integer,
				optional: true
			}
		],
		usedOn: (func,e,params)=>{
			e.tick('execute as @a[scores={' + e.valueOf(params.trigger) + '=' + (params.value ? e.valueOf(params.value) : 1) + (params.maxValue ? '..' + e.valueOf(params.maxValue) : '') + '}] at @s run function ' + func.loc.toString());
		}
	}
}

export function parseAnnotation(t: TokenIterator): boolean {
	if (!t.skip('$')) return false
	let name = t.expectType(TokenType.identifier,()=>Object.keys(Annotations));
	if (!name) return false
	let a: Annotation<any> = Annotations[name.value];
	if (!a) {
		t.error(name.range,"Unknown annotation " + name.value);
		return true
	}
	let signature: SignatureHelp = t.ctx.editor.createSignatureHelp(name.value,[{params: a.params.map(getSignatureFromParam),desc: undefined}])
	let params: any;
	if (!t.skip('(')) {
		if (a.params.length == 0 || a.params[0].optional) {
			params = {}
		} else {
			return true
		}
	} else {
		let res = parseMethod(t,a.params,signature);
		t.expectValue(')');
		if (res.success) {
			params = res.data;
		} else {
			return true
		}
	}
	t.ctx.currentAnnotations.push({type: a,params,range: name.range});
	return true;
}

export type AnnotationContainer<T> = (target: T, e: Evaluator)=>void