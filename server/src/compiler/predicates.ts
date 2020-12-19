import { VariableTypes, parseMethod, MethodParameter, getSignatureFromParam, ValueTypeObject } from './util';
import { Evaluator, Lazy } from './parser';
import { TokenType, TokenIterator } from './tokenizer';
import { Registry } from './registries';
import { DatapackItem, ResourceLocation, Files } from '.';
import { CompoundItem, DataProperty, validateDataProperty, BaseCompoundRegistry, setValueInCompound } from './data_structs';
import { ValueParserUtil, Parsers } from './parsers/parsers'

export interface LootCondition {
	realKey?: string
	params: CompoundItem<DataProperty>
}

export class LootConditionRegistry extends BaseCompoundRegistry<LootCondition,DataProperty> {
	getCompounds(): {[k: string]: CompoundItem<DataProperty>} {
		let comps: {[k: string]: CompoundItem<DataProperty>} = {};
		for (let e of this.entries()) {
			comps[e.key] = e.value.params
		}
		return comps;
	}
}


export function parsePredicateNode(t: TokenIterator): Lazy<Predicate> {
	let entry = t.expectId(Registry.loot_conditions.entries(),'predicate',(p)=>p.key);
	if (entry && t.expectValue('(')) {
		let pred = entry.value.value;
		let signatureHelp = t.ctx.editor.createSignatureHelp(entry.value.key,[{desc: "",params: Object.keys(pred.params).map(k=>({key: k, ...pred.params[k]})).map(v=>({key: v.key,type: Parsers[v.type],desc: v.desc, optional: v.writeonly}))}])
		let params: MethodParameter[] = Object.keys(pred.params).map(k=>({key: k,type: Parsers[pred.params[k].type].configured(pred.params[k].context || {}), desc: pred.params[k].desc, optional: pred.params[k].writeonly}));
		let res = parseMethod(t,params,signatureHelp);
		if (res.success) {
			t.expectValue(')');
		} else {
			t.skip(')');
		}
		t.ctx.editor.setSignatureHelp(signatureHelp);
		if (!res.success) return Lazy.literal({id: "unknown",data: {}},VariableTypes.predicate);
		return e=>{
			let finalRes = {};
			for (let k of Object.keys(res.data)) {
				setValueInCompound(e.valueOf(res.data[k]),k,pred.params[k],finalRes,e)
			}
			console.log('predicate final res:',finalRes)
			return {value: {id: pred.realKey || entry.value.key, data: finalRes}, type: VariableTypes.predicate};
		}
	}
	return Lazy.empty;
}

export function flattenPredicate(pred: Predicate) {
	if (pred.id == 'list') return pred.data;
	return {condition: pred.id, ...pred.data}
}

export type Predicate = {id: string, data: any, loc?: ResourceLocation}

export class PredicateItem extends DatapackItem {

	constructor(private data: Predicate, loc: ResourceLocation) {
		super(loc);
		this.loc.ns.add(this);
	}

	save(dir: Files.Directory): void {
		let file = dir.file(this.loc.path + '.json');
		file.write(JSON.stringify(flattenPredicate(this.data),undefined,4))
	}
	dirName: string = 'predicates'

}

export function getPredicateLocation(e: Evaluator, pred: Predicate): ResourceLocation {
	if (pred.loc) {
		return pred.loc;
	} else {
		e.file.namespace.inlinePredicateCount++;
		let id = new ResourceLocation(e.file.namespace,'predicate_' + pred.id + '_' + e.file.namespace.inlinePredicateCount);
		new PredicateItem(pred,id);
		return id;
	}
	
}