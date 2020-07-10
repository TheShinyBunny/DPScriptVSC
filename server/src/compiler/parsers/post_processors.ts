import { Evaluator } from '../parser';
import { ValueParser, ConfiguredParser, ContextValidator, ValueParserUtil } from './parsers';
import { getValueInPath } from '../data_structs';
import { getAsArray } from '../util';
import { toStringValue } from '../nbt';


export abstract class PostProcessor<R,D = any> {

	abstract process(value: any, e: Evaluator, options: D): R

	canProcess(value: any): boolean {
		return true;
	}

	customSetValue: (value: R, compound: any, key: string, e: Evaluator, options: D)=>boolean

	readonly contextValidator: ContextValidator

	validateContext(ctx: any, reporter: (msg: string)=>void): void {
		if (!this.contextValidator) return;
		ValueParserUtil.validateContext(ctx,this.contextValidator,reporter);
	}
}

class Stringify extends PostProcessor<string> {
	process(value: any, e: Evaluator): string {
		return toStringValue(value,e)
	}
}

interface BitOptions {
	components: {
		path: string[]
		shift: number
		modulo?: number
	}[]
}

class OperateBits extends PostProcessor<number,BitOptions> {
	process(value: any, e: Evaluator, options: BitOptions): number {
		let result: number;
		for (let c of options.components) {
			let v = e.valueOf(getValueInPath(value,c.path));
			if (typeof v == 'number') {
				if (c.modulo) {
					v = v % c.modulo;
				}
				if (result) {
					result = result | (v << c.shift)
				} else {
					result = v << c.shift
				}
			}
		}
		return result;
	}
	
	canProcess(value: any) {
		return typeof value == 'object'
	}
	
}

interface ToCompOptions {
	values: {
		[key: string]: string
	}
}

class ToCompound extends PostProcessor<any,ToCompOptions> {
	process(value: any, e: Evaluator, options: ToCompOptions) {
		let res = {}
		for (let k of Object.keys(options.values)) {
			res[k] = getValueInPath(value,options.values[k].split('.'));
		}
		return res;
	}

}

type MergeEntry = string | {
	if?: string
	equal?: any
	value: string
	processor?: string
}

interface MergeOptions {
	values: {
		$self: MergeEntry
		[key: string]: MergeEntry
	}
}

class MergeCompound extends PostProcessor<any,MergeOptions> {
	process(value: any, e: Evaluator, options: MergeOptions) {
		let res = {};
		
		for (let k of Object.keys(options.values)) {
			let m = options.values[k];
			if (typeof m == 'string') {
				res[k] = getValueInPath(value,m.split('.'))
			} else if (!m.if || getValueInPath(value,m.if.split('.')) == m.equal) {
				let v = getValueInPath(value,m.value.split('.'));
				if (m.processor) {
					v = postProcess(v,res,k,e,m.processor);
					if (v !== undefined) {
						res[k] = v;
					}
				}
			}
		}
		return res;
	}

	customSetValue = (value: any, compound: any, key: string, e: Evaluator, options: MergeOptions)=>{
		for (let k of Object.keys(options.values)) {
			if (k != '$self') {
				compound[k] = value[k];
			}
		}
		return options.values.$self !== undefined
	}

}

export const PostProcessors = {
	stringify: new Stringify(),
	bit_flags: new OperateBits(),
	to_compound: new ToCompound(),
	merge_compound: new MergeCompound()
}

export function postProcess(value: any, compound: any, key: string, e: Evaluator, processor: string | {id: string}) {

	let id = typeof processor == 'string' ? processor : processor.id;
	let proc: PostProcessor<any> = PostProcessors[id];
	if (proc && proc.canProcess(value)) {
		let opts = typeof processor == 'string' ? {} : processor
		value = proc.process(value,e,opts);
		if (proc.customSetValue) {
			let r = proc.customSetValue(value,compound,key,e,opts);
			if (r) {
				return;
			}
		}
	}
	return value;
}