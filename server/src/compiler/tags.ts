import { TokenIterator, TokenType, Token } from './tokenizer';
import { Statement, Evaluator } from './parser';
import { CompletionItemKind, Location } from 'vscode-languageserver';
import { DatapackItem, ResourceLocation } from '.';
import * as path from 'path'
import * as fs from 'fs'
import { getRegistryEntries, ensureUnique } from './util';

export interface TagType {
	dir: string
	registry: string
}

export const TagTypes: {[id: string]: TagType} = {
	block: {
		dir: "blocks",
		registry: "blocks"
	},
	item: {
		dir: "items",
		registry: "items"
	},
	entity: {
		dir: "entity_types",
		registry: "entities"
	}
}

export class Tag extends DatapackItem {
	declaration: Location

	constructor(public type: TagType, public id: string, loc: ResourceLocation, public entries: TagEntry[], public replace: boolean) {
		super(loc)
	}
	save(dir: string): void {
		let tagDir = path.join(dir,this.type.dir);
		fs.mkdirSync(tagDir);
		let json = {
			values: this.entries.map(e=>typeof e == 'string' ? e : e.toString()),
			replace: this.replace
		}
		fs.writeFileSync(path.join(tagDir,this.loc.path + '.json'),JSON.stringify(json,undefined,'    '))
	}
	dirName: string = "tags"

	toString() {
		return '#' + this.loc.toString()
	}
	
}

export interface UnresolvedTag {
	token: Token
	type: TagType
}

namespace UnresolvedTag {
	export function is(obj: TagEntry): obj is UnresolvedTag {
		return typeof obj !== 'string' && !(obj instanceof Tag)
	}
}

export type TagEntry = string | UnresolvedTag | Tag


export function parseTagDeclaration(t: TokenIterator): Statement {
	if (!t.isTypeNext(TokenType.identifier)) return;
	t.suggestHere(...Object.keys(TagTypes).map(k=>({value: k, detail: "tag", type: CompletionItemKind.Keyword})));
	for (let k in TagTypes) {
		let tt = TagTypes[k];
		if (t.skip(k)) {
			t.suggestHere('tag');
			if (t.skip('tag')) {
				let name = t.expectType(TokenType.identifier);
				let tag = parseTag(t,tt,name.value);
				if (ensureUnique(t,name,t.ctx.script.tags,t=>t.id,'tag')) {
					t.ctx.script.namespace.add(tag);
					t.ctx.script.tags.push(tag);
				}
				tag.declaration = {uri: t.ctx.script.uri, range: name.range}
				return e=>{
					let resolvedTags: Tag[] = []
					for (let ent of tag.entries) {
						if (UnresolvedTag.is(ent)) {
							e.suggestAt(ent.token.range,...e.tags.filter(t=>t.type == tag.type).map(t=>({value: t.id, type: CompletionItemKind.Enum})))
							resolvedTags.push(e.requireTag(ent));
						}
					}
					tag.entries = tag.entries.filter(e=>!UnresolvedTag.is(e));
					tag.entries.push(...resolvedTags)
				};
			}
		}
	}
}

function parseTag(t: TokenIterator, type: TagType, name: string): Tag {
	let entries: TagEntry[];
	if (t.skip('=')) {
		entries = parseInlineEntries(t,type);
	} else {
		entries = parseBlockEntries(t,type);
	}
	return new Tag(type,name,new ResourceLocation(t.ctx.script.namespace,name),entries,false);
}

function parseInlineEntries(t: TokenIterator, type: TagType): TagEntry[] {
	let entries: TagEntry[] = []
	while (t.hasNext() && t.peek().type !== TokenType.line_end) {
		entries.push(parseTagEntry(t,type));
		t.skip(',');
	}
	return entries;
}


function parseBlockEntries(t: TokenIterator, type: TagType): TagEntry[] {
	let entries: TagEntry[] = []
	if (t.expectValue('{')) {
		t.nextLine(true)
		while (t.hasNext() && !t.isNext('}')) {
			entries.push(parseTagEntry(t,type));
			t.nextLine(true)
		}
		t.expectValue('}')
	}
	return entries;
}

function parseTagEntry(t: TokenIterator, type: TagType): TagEntry {
	if (t.skip('#')) {
		let id = t.expectType(TokenType.identifier);
		return {token: id, type};
	}
	t.suggestHere(...getRegistryEntries(type.registry).map(e=>({value: e, detail: 'minecraft'})))
	return t.expectType(TokenType.identifier).value;
}