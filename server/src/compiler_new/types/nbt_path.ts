import { Range } from 'vscode-languageserver';
import { Expression } from '../ast';
import { Parser } from '../parser';
import { Token, TokenType } from '../tokenizer';
import { RegistryNBTContext, NBT, NBTContext, SimpleNBTContext, ListNBTContext } from './nbt';
import { NumberValue } from './numbers';
import { Value, ValueType, ValueTypes } from './types';


export interface NBTPath {
	ctx: NBTContext
	endType: ValueType<any>
	path: PathNode[]
}

export interface PathOptions {
	ctx: NBTContext
}

export class NBTPathType extends ValueType<NBTPath,PathOptions> {
	parse(p: Parser, opts: PathOptions): NBTPath {
		if (p.isNext('/')) {
			p.nextToken()
			let path: PathNode[] = []
			let ctx = opts ? opts.ctx : new SimpleNBTContext({},false)
			while (p.hasNext()) {
				if (p.isTypeNext(TokenType.identifier) || p.isTypeNext(TokenType.string)) {
					let name = p.nextToken()
					let prop = ctx.getProperties()[name.value]
					let type: ValueType<any>
					if (prop) {
						type = ValueType.get(prop.type);
						if (prop.config) {
							type = type.configured(prop.config)
						}
						ctx = type.getNBTContext(name.value)
						if (!ctx) {
							ctx = new SimpleNBTContext(undefined,false)
							if (p.isNext('[') || p.isNext('{')) {
								p.error(p.nextToken().range,"This property has no child properties")
							}
						}
					} else {
						if (ctx.isStrict()) {
							p.error(name.range,"Unknown property")
						}
						ctx = new SimpleNBTContext(undefined,false)
					}
					if (p.isNext('{')) {
						let start = p.token.range.start
						let nbt = ValueTypes.nbt.parse(p,{ctx})
						if (nbt) {
							let finalName = name
							if (prop && prop.path) {
								for (let p of prop.path.slice(0,prop.path.length-1)) {
									path.push(new NameNode(name.withValue(p),name.range,ValueTypes.nbt))
								}
								finalName = name.withValue(prop.path[prop.path.length-1])
							}
							path.push(new FilteredNameNode(finalName,nbt,{start,end: p.prevToken.range.end},type))
						}
					} else {
						let finalName = name
						if (prop && prop.path) {
							for (let p of prop.path.slice(0,prop.path.length-1)) {
								path.push(new NameNode(name.withValue(p),name.range,ValueTypes.nbt))
							}
							finalName = name.withValue(prop.path[prop.path.length-1])
						}
						path.push(new NameNode(finalName,name.range,type))
					}
					if (p.isNext('[')) {
						let start = p.token.range.start
						let itemType = ctx.isArray() ? (<ListNBTContext>ctx).itemType : undefined
						if (ctx.isStrict() && !ctx.isArray()) {
							p.error(p.nextToken().range,"This property is not a list")
						} else {
							p.nextToken()
						}
						if (p.isNext(']')) {
							p.nextToken()
							path.push(new AllListNode({start,end: p.prevToken.range.end},itemType))
						} else if (p.isNext('{')) {
							let nbt = ValueTypes.nbt.parse(p,{ctx: itemType ? itemType.getNBTContext('') : undefined})
							if (nbt) {
								p.expectValue(']')
								path.push(new ListFilterNode(nbt,{start, end: p.prevToken.range.end},itemType))
							}
						} else {
							let index = p.parseExpression(ValueTypes.int)
							if (index) {
								path.push(new ListIndexNode(index,{start,end: p.prevToken.range.end},itemType))
							}
						}
						ctx = itemType ? itemType.getNBTContext({},'') || new SimpleNBTContext({},false) : new SimpleNBTContext({},false)
					}
				} else if (path.length === 0) {
					if (p.isNext('{')) {
						let start = p.token.range.start
						let nbt = ValueTypes.nbt.parse(p,{ctx})
						if (nbt) {
							path.push(new RootFilterNode(nbt,{start,end: p.prevToken.range.end}))
						}
					} else {
						p.error(p.nextToken().range,"Invalid token in path");
						break
					}
				} else {
					break
				}
				if (!p.isNext('/')) break
				p.nextToken()
			}
			return {ctx,endType: path[path.length - 1].type,path}
		}
	}
	getDetail(ctx: PathOptions, key: string): string {
		return 'NBTPath'
	}

}

export abstract class PathNode {
	constructor(public range: Range, public type?: ValueType<any>) {

	}
}

export class NameNode extends PathNode {
	constructor(public name: Token, range: Range, type?: ValueType<any>) {
		super(range,type);
	}
}

export class ListIndexNode extends PathNode {
	constructor(public index: Expression<NumberValue>, range: Range, type?: ValueType<any>) {
		super(range,type);
	}
}

export class ListFilterNode extends PathNode {
	constructor(public filter: NBT, range: Range, type?: ValueType<any>) {
		super(range,type);
	}
}

export class AllListNode extends PathNode {
	
}

export class FilteredNameNode extends PathNode {
	constructor(public name: Token, public filter: NBT,range: Range, type?: ValueType<any>) {
		super(range,type);
	}
}

export class RootFilterNode extends PathNode {
	constructor(public filter: NBT,range: Range) {
		super(range);
	}
}

export interface NBTAccess {
	type: 'entity' | 'block' | 'storage'
	selector: Value<any>
	path: NBTPath
}

export class NBTAccessType extends ValueType<NBTAccess> {
	parse(p: Parser, ctx: any): NBTAccess {
		throw new Error('Method not implemented.');
	}
	getDetail(ctx: any, key: string): string {
		return 'nbt_access'
	}

}