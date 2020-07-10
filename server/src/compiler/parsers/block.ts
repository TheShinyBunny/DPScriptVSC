import { ValueParser, ParsingContext, Parsers } from './parsers';
import { TokenIterator, TokenType } from '../tokenizer';
import { Evaluator, Lazy, UntypedLazy } from '../parser';
import { toStringNBT, NBTContext, NBTPathContext } from '../nbt';
import { Registry } from '../registries';
import { parseIdentifierOrVariable, VariableTypes } from '../util';
import { TagTypes } from '../tags';
import { CompletionItemKind } from 'vscode-languageserver';
import { LazyCompoundEntry } from '../data_structs'

export interface Block {
	tagged: boolean
	id: string
	state?: any
	nbt?: any
}

export class BlockParser extends ValueParser<Block,{tag?: boolean, nbt?: boolean}> {
	id: string = "block"
	parse(t: TokenIterator, ctx: {tag?: boolean, nbt?: boolean}): LazyCompoundEntry<Block> {
		t.suggestHere(...Object.keys(Registry.blocks));
		let tagged = false;
		if (ctx.tag) {
			tagged = t.skip('#');
		}
		let id = parseIdentifierOrVariable(t);
		if (!id) return;
		
		let state = undefined;
		let nbt = undefined;
		if (t.isNext('[')) {
			state = Parsers.blockstate.configured({blockId: id.literal}).parse(t)
		}
		let pos = t.pos;
		if (ctx.nbt && t.skip('{')) {
			let readNBT = true;
			if (!t.isTypeNext(TokenType.identifier) && !t.isNext('}')) {
				readNBT = false;
			}
			t.pos = pos;
			if (readNBT) {
				nbt = Parsers.nbt.parse(t,{registry: "tile_entities", entry: Lazy.map(id.value,v=>Registry.blocks[v].tile_entity)});
			}
		}
		return e=>{
			let realId = e.valueOf(id.value);
			if (!tagged && Registry.blocks[realId] === undefined) {
				e.error(id.range,"Unknown block ID " + realId);
			}
			if (tagged) {
				e.suggestAt(id.range,...e.tags.filter(t=>t.type == TagTypes.block).map(t=>({value: t.id, type: CompletionItemKind.Enum})))
				let tag = e.requireTag({type: TagTypes.block, token: {range: id.range, value: realId, type: TokenType.identifier}});
				realId = tag.loc.toString();
			}
			return {tagged,id: realId,state,nbt: e.valueOf(nbt)}
		}
	}

	toCompoundData(block: Block) {
		return {Name: block.id, Properties: block.state}
	}
	
	toString(block: Block, e: Evaluator) {
		return toStringBlock(block,e)
	}

	createPathContext(data: any): NBTPathContext {
		return new NBTPathContext({
			Name: {
				type: "string"
			},
			Properties: {
				type: "blockstate"
			}
		})
	}

}

export function toStringBlock(block: Block, e: Evaluator) {
	return (block.tagged ? '#' : '') + 
		block.id + 
		(block.state ? Parsers.blockstate.toString(block.state) : '') +
		(block.nbt ? toStringNBT(block.nbt,e) : '')
}

export class BlockStateParser extends ValueParser<any,{blockId?: string}> {
	
	id: string = "blockstate"
	parse(t: TokenIterator, ctx: {blockId?: string}): LazyCompoundEntry<any> {
		t.expectValue('[');
		let state = {};
		let props = ctx.blockId ? (Registry.blocks[ctx.blockId] || {}).props : undefined;
		while (t.hasNext()) {
			if (props) {
				t.suggestHere(...Object.keys(props));
			}
			if (t.isNext(']')) break;
			let key = t.expectType(TokenType.identifier);
			let values = props ? props[key.value] : undefined;
			if (props && !values) {
				t.error(key.range,"Unknown property for block " + ctx.blockId + ": '" + key.value + "'");
			}
			t.expectValue('=');
			if (values) {
				t.suggestHere(...values);
			}
			let value = t.next();
			if (values && values.indexOf(value.value) < 0) {
				t.error(value.range,"Invalid value for property " + key.value);
			}
			state[key.value] = value.value;
			if (!t.skip(',')) {
				break
			}
		}
		t.expectValue(']');
		return e=>state;
	}

	toString(state: any): string {
		return Object.keys(state).map(k=>k + '=' + state[k]).join(',') + ']'
	}

	createPathContext(data: any): NBTPathContext {
		return new NBTPathContext({})
	}
	
}