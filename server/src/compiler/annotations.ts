import { TokenIterator, TokenType } from './tokenizer';
import { Evaluator } from './parser';
import { MCFunction } from '.';
import { VariableTypes, MethodParameter, parseMethod, getSignatureFromParam } from './util';
import { SignatureHelp } from 'vscode-languageserver';
import { Range } from 'vscode-languageserver-textdocument';
import { SemanticType } from '../server';

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
	params: ()=>MethodParameter[]
	target: AnnotationTarget<T>
	usedOn: (target: T, e: Evaluator, params: any)=>void
}

export interface AnnotationInstance {
	type: Annotation<any>
	params: any
	range: Range
}

export namespace Annotations {
	export const score: Annotation<MCFunction> = {
		name: 'score',
		target: Targets.func,
		params: ()=>[
			{
				key: 'score',
				type: [VariableTypes.trigger,VariableTypes.objective]
			},
			{
				key: 'value',
				type: VariableTypes.int,
				optional: true
			},
			{
				key: 'maxValue',
				type: VariableTypes.int,
				optional: true
			}
		],
		usedOn: (func,e,params)=>{
			e.tick('execute as @a[scores={' + e.valueOf(params.score) + '=' + (params.value ? e.valueOf(params.value) : 1) + (params.maxValue ? '..' + e.valueOf(params.maxValue) : '') + '}] at @s run function ' + func.loc.toString());
		}
	}
}

export function parseAnnotation(t: TokenIterator): boolean {
	if (!t.skip('[')) return false
	let name = t.expectType(TokenType.identifier,()=>Object.keys(Annotations));
	if (!name) return false
	let a: Annotation<any> = Annotations[name.value];
	if (!a) {
		t.error(name.range,"Unknown annotation " + name.value);
		return true
	}
	t.ctx.editor.addSemantic(name.range,SemanticType.enumMember)
	let mp = a.params();
	let signature: SignatureHelp = t.ctx.editor.createSignatureHelp(name.value,[{params: mp,desc: undefined}]);
	t.ctx.editor.setHover(name.range,{syntax: signature.signatures[0].label});
	let params: any;
	if (!t.skip('(')) {
		if (mp.length == 0 || mp[0].optional) {
			params = {}
		} else {
			t.errorNext('This annotation has required parameters')
			t.skip(']')
			return true
		}
	} else {
		let res = parseMethod(t,mp,signature);
		t.expectValue(')');
		if (res.success) {
			params = res.data;
		} else {
			return true
		}
	}
	t.expectValue(']')
	t.ctx.collectedAnnotations.push({type: a,params,range: name.range});
	t.ctx.editor.setSignatureHelp(signature);
	return true;
}

export type AnnotationContainer<T> = (target: T, e: Evaluator)=>void