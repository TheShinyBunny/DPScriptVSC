import { TokenIterator, TokenType } from './tokenizer';
import { Lazy, parseExpression, Evaluator } from './parser';
import { CompletionItemKind } from 'vscode-languageserver';
import { VariableType, VariableTypes } from './util';

export interface DataStructureType<C> {
	toString: (d: any, e: Evaluator)=>string;
	properties: DataProperty<C>[],
	varType: VariableType<any>
}

export interface DataProperty<C> {
	key: string
	aliases?: string[]
	desc?: string
	useKeyAsAlias?: boolean
	parser: (t: TokenIterator)=>Lazy<any>
	valid?: (ctx: C)=>boolean
}

export function parseDataCompound<C>(t: TokenIterator, type: DataStructureType<C>, ctx: C): Lazy<any> {
	if (!t.expectValue('{')) return undefined;
	let data: {[k: string]: Lazy<any>} = {};
	while (t.hasNext()) {
		let tok = t.expectType(TokenType.identifier,()=>type.properties.filter(i=>i.valid(ctx)).map(i=>({value: i.key, desc: i.desc, type: CompletionItemKind.Field})));
		let prop = findProp(type.properties,tok.value);
		if (prop) {
			t.expectValue(':');
			let res: Lazy<any> = prop.parser(t);
			data[prop.key] = res;
		} else if (tok.type !== TokenType.line_end) {
			t.error(tok.range,"Unknown property '" + tok.value + "'");
		} else {
			t.error(tok.range,"Expected property");
			return e=>({value: {},type: type.varType});
		}
		if (!t.skip(',')) {
			t.expectValue('}');
			break
		}
	}
	return e=>{
		let val = {};
		for (let k of Object.keys(data)) {
			let v = data[k];
			val[k] = e.valueOf(v);
		}
		return {value: val, type: type.varType};
	}
}

function findProp(props: DataProperty<any>[], label: string) {
	for (let p of props) {
		if ((p.useKeyAsAlias && p.key === label) || p.aliases.indexOf(label) > -1) return p;
	}
}