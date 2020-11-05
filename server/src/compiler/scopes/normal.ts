import { Scope, RegisterStatement, Statement, parseExpression, getLazyVariable, parseCondition, TempScore, RegisteredStatement, Evaluator, Lazy, Scopes } from '../parser';
import { VariableTypes, parseLocation, toStringPos, Location, MethodParameter, parseMethod, ValueTypeObject, parseValueTypeObject, parseRotation, toStringRot, MemberGroup, BaseMemberEntry, parseLootSource, CommandGetter, toStringMemberSignature, parseParticleType, chainSpaced, ParticleInstance, getSignatureFromParam } from '../util';
import * as selectors from '../selector';
import { TokenType, TokenIterator, Token } from '../tokenizer';
import { CompletionItemKind, SymbolKind } from 'vscode-languageserver';
import { parseNBT, parseNBTPath, NBTPathContext, parseNBTAccess, NBTPath, PathNodeType, parseFullNBTAccess, toStringNBTAccess } from '../nbt';
import { isArray } from 'util';
import { Registry } from '../registries';
import { makeVariableStatement } from './utility';
import { SemanticType } from '../../server';
import { Parsers } from '../parsers/parsers';
import { Block, toStringBlock } from '../parsers/block';
import { toStringItem } from '../parsers/item';

function MethodStatement(desc: string, paramGetter: ()=>MethodParameter[]) {
	return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
		if (!target.registered) {
			target.registered = [];
		}
		let newFunc = (stype, instance)=>{
			if (!(instance instanceof Scope)) {
				console.log('WARNING: MethodStatement was not called with Scope as the "instance" arg');
				console.log('called with:',instance);
			}
			let t: TokenIterator = instance.tokens;
			t.ctx.editor.addSymbol(t.lastPos,propertyKey,SymbolKind.Method);
			t.ctx.editor.addSemantic(t.lastPos,SemanticType.function)
			if (t.expectValue('(')) {
				let params = paramGetter();
				let signature = t.ctx.editor.createSignatureHelp(propertyKey,[{desc, params}])
				let res = parseMethod(t,params,signature);
				t.ctx.editor.setSignatureHelp(signature);
				if (!res.success) {
					t.skip(')');
					return e=>{}
				}
				t.expectValue(')');
				return (e: Evaluator)=>{
					let args = new Array(1 + (isArray(params) ? params.length : 1));
					args[0] = e;
					if (Lazy.is(res.data)) {
						args[1] = e.valueOf(res);
					} else if (typeof res == 'object') {
						for (let k of Object.keys(res.data)) {
							let i = params.findIndex((p,i)=>(p.key || i) == k) + 1;
							args[i] = e.valueOf(res.data[k]);
						}
					}
					return descriptor.value.apply(instance,args);
				}
			}
		}
		target.registered.push(<RegisteredStatement>{options: {keyword: propertyKey, desc,inclusive: false},func: newFunc});
	}
}

interface FieldValueType {
	type: ValueTypeObject
	required?: boolean
}

function FieldStatement(desc: string, valueGetter: ()=>FieldValueType) {
	return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
		if (!target.registered) {
			target.registered = [];
		}
		let newFunc = (stype, instance)=>{
			if (!(instance instanceof Scope)) {
				console.log('WARNING: MethodStatement was not called with Scope as the "instance" arg');
				console.log('called with:',instance);
			}
			let type = valueGetter();
			if (type.required ? instance.tokens.expectValue('=') : instance.tokens.skip('=')) {
				let res = parseValueTypeObject(instance.tokens,type.type,false)
				if (!res) return e=>{};
				return e=>{
					return descriptor.value.apply(instance,[e,e.valueOf(res)]);
				}
			}
			if (type.required) return;
			return e=>{
				return descriptor.value.apply(instance,[e,undefined]);
			}
		}
		target.registered.push(<RegisteredStatement>{options: {keyword: propertyKey, desc,inclusive: false},func: newFunc});
	}
}

export class NormalScope extends Scope {

	@RegisterStatement({inclusive: true})
	codeBlock(): Statement {
		if (!this.tokens.isNext('{')) return undefined;
		return this.parser.parseBlock(Scopes.function);
	}

	@RegisterStatement()
	print(): Statement {
		let msg = parseExpression(this.tokens,VariableTypes.string);
		return e=>{
			e.write("say " + e.valueOf(msg));
		}
	}

	@RegisterStatement({inclusive: true})
	selector(): Statement {
		let selector = selectors.parseSelector(this.tokens);
		if (!selector) return undefined;
		let suggestFuncs: Token;
		if (this.tokens.isNext('.')) {
			suggestFuncs = this.tokens.peek()
		}
		let cmd = selectors.parseSelectorCommand(this.tokens,selector.type);
		if (!cmd) {
			return e=>{}
		}
		return e=>{
			if (suggestFuncs) {
				e.suggestAt(suggestFuncs.range,...e.functions.map(f=>({value: f.name, type: CompletionItemKind.Function, snippet: f.name + '($0)'})))
			}
			return cmd(selector,e);
		}
	}

	@RegisterStatement()
	storage(): Statement {
		this.tokens.expectValue(':');
		let name = this.tokens.expectType(TokenType.identifier);
		let path: NBTPath;
		if (this.tokens.skip('/')) {
			path = parseNBTPath(this.tokens,false,new NBTPathContext({}));
		} else {
			path = [{ctx: new NBTPathContext({}),label: Lazy.literal({},VariableTypes.nbt),type: PathNodeType.root}];
		}
		let access = parseNBTAccess(this.tokens,true,path[path.length-1].ctx);
		return e=>{
			return access({path, selector: {type: 'storage',value: name.value}},e);
		}
	}

	@RegisterStatement({desc: "Iterates over entities, or through a variable range"})
	for(): Statement {
		if (this.tokens.suggestHere('summon')) {
			this.tokens.skip();
			let s = parseSummon(this.tokens);
			if (this.tokens.expectValue(')')) {
				let p = this.ctx.currentEntity;
				this.ctx.currentEntity = {params: [],target: selectors.SelectorTarget.self,type: s.type}
				let code = this.parser.parseStatement(Scopes.function);
				this.ctx.currentEntity = p;
				return e=>{
					e.ensureObjective('_id');
					e.write('scoreboard players add @e[type=' + s.type + '] _id 1');
					e.write(s.toCommand(e));
					e.write('scoreboard players add @e[type=' + s.type + '] _id 1');
					e.write('execute as @e[type=' + s.type + ',limit=1,scores={_id=1}] at @s ' + e.getCommandWithRun('for',code));
				}
			}
		} else if (this.tokens.skip('(')) {
			let v = this.tokens.expectType(TokenType.identifier);
			let init = makeVariableStatement(this.tokens,v,VariableTypes.int,true,undefined);
			this.tokens.expectValue(',');
			let to = parseExpression(this.tokens,VariableTypes.int);
			let inc = Lazy.literal(1,VariableTypes.int);
			if (this.tokens.skip(',')) {
				inc = parseExpression(this.tokens,VariableTypes.int);
			}
			if (this.tokens.expectValue(')')) {
				let code = this.parser.parseStatement(Scopes.function);
				return e=>{
					let newE = e.recreate();
					init(newE);
					for (; (<number>newE.getVariable(v.value).value) < newE.valueOf(to); newE.setVariableValue(v.value,newE.getVariable(v.value).value + newE.valueOf(inc))) {
						code(newE);
						newE = newE.recreate();
						newE.disableLangFeatures = true;
					}
				}
			}
			return e=>{}
		} else {
			let selector = selectors.parseSelector(this.tokens);
			return this.chainExecute(e=>'as ' + selectors.Selector.toString(selector,e) + ' at @s',selector);
		}
	}

	chainExecute(command: string | ((e: Evaluator)=>string), currentEntity?: selectors.Selector): Statement {
		let p = this.ctx.swapCurrentEntity(currentEntity);
		let code = this.parser.parseStatement(Scopes.function);
		this.ctx.currentEntity = p;
		return e=>{
			let cmd = typeof command == 'function' ? command(e) : command;
			e.write('execute ' + cmd + ' ' + e.getCommandWithRun('execute',code));
		}
	}

	@RegisterStatement({desc: "Executes the following statement with the specified entity selector as the context entity/s"})
	as(): Statement {
		if (this.tokens.skip('(')) {
			if (this.tokens.suggestHere('summon')) {
				this.tokens.skip();
				let s = parseSummon(this.tokens);
				if (this.tokens.expectValue(')')) {
					let p = this.ctx.currentEntity;
					this.ctx.currentEntity = {params: [],target: selectors.SelectorTarget.self,type: s.type}
					let code = this.parser.parseStatement(Scopes.function);
					this.ctx.currentEntity = p;
					return e=>{
						e.ensureObjective('_id');
						e.write('scoreboard players add @e[type=' + s.type + '] _id 1');
						e.write(s.toCommand(e));
						e.write('scoreboard players add @e[type=' + s.type + '] _id 1');
						e.write('execute as @e[type=' + s.type + ',limit=1,scores={_id=1}] ' + e.getCommandWithRun('for',code));
					}
				}
			}
		} else {
			let selector = selectors.parseSelector(this.tokens);
			if (!selector) return;
			return this.chainExecute((e)=>'as ' + selectors.Selector.toString(selector,e),selector);
		}
	}

	@RegisterStatement({desc: "Executes the following statement at the position of the specified entity/s"})
	at(): Statement {
		let selector = selectors.parseSelector(this.tokens);
		return this.chainExecute((e)=>'at ' + selectors.Selector.toString(selector,e));
	}

	@RegisterStatement({desc: "Aligns execution to the specified axies"})
	align(): Statement {
		let combo = this.tokens.expectType(TokenType.identifier);
		if (!combo.value.match(/^((x((yz?)|(zy?))?)|(y((xz?)|(zx?))?)|(z((xy?)|(yx?))?))$/)) {
			this.tokens.error(combo.range,"Invalid axis combo, expected a combination of only one x, y and/or z.")
		}
		return this.chainExecute('align ' + combo.value);
	}

	@RegisterStatement({desc: "Aligns the execution to the feet/eyes of the entity"})
	anchored(): Statement {
		let anchor = this.tokens.expectType(TokenType.identifier,()=>["feet","eyes"]);
		if (anchor.value != 'feet' && anchor.value != 'eyes') {
			this.tokens.error(anchor.range,"Anchor must be either feet or eyes!");
		}
		return this.chainExecute('anchored ' + anchor.value);
	}

	@RegisterStatement()
	facing(): Statement {
		if (this.tokens.isNext('[')) {
			let pos = parseLocation(this.tokens);
			return this.chainExecute(e=>'facing ' + toStringPos(pos,e));
		}
		let sel = selectors.parseSelector(this.tokens);
		this.tokens.expectValue('.');
		let anchor = this.tokens.expectType(TokenType.identifier,()=>["feet","eyes"]);
		if (anchor.value != 'feet' && anchor.value != 'eyes') {
			this.tokens.error(anchor.range,"Anchor must be either feet or eyes!");
		}
		return this.chainExecute(e=>'facing entity ' + selectors.Selector.toString(sel,e) + ' ' + anchor.value);
	}

	@RegisterStatement()
	positioned(): Statement {
		if (this.tokens.isNext('[')) {
			let pos = parseLocation(this.tokens);
			return this.chainExecute(e=>'positioned ' + toStringPos(pos,e));
		}
		let sel = selectors.parseSelector(this.tokens);
		return this.chainExecute(e=>'positioned as ' + selectors.Selector.toString(sel,e));
	}

	@RegisterStatement()
	rotated(): Statement {
		if (this.tokens.isNext('[')) {
			let rot = parseRotation(this.tokens);
			return this.chainExecute(e=>'rotated ' + toStringRot(rot,e));
		}
		let sel = selectors.parseSelector(this.tokens);
		return this.chainExecute(e=>'rotated as ' + selectors.Selector.toString(sel,e));
	}

	@RegisterStatement()
	in(): Statement {
		const dimensions = ["overworld","the_nether","the_end"];
		let dim = this.tokens.expectType(TokenType.identifier,()=>dimensions);
		if (dimensions.indexOf(dim.value) < 0) {
			this.tokens.warn(dim.range,"Unknown dimension");
		}
		return this.chainExecute('in ' + dim.value);
	}

	@RegisterStatement()
	if(): Statement {
		let cond = parseCondition(this.tokens);
		let code = this.parser.parseStatement(Scopes.function);
		if (!code) return e=>{}
		let hasElse = false;
		let elseCode: Statement = undefined;
		if (this.tokens.skip('else')) {
			hasElse = true;
		} else {
			let pos = this.tokens.pos;
			while (this.tokens.isTypeNext(TokenType.line_end)) {
				this.tokens.skip();
			}
			if (this.tokens.skip('else')) {
				hasElse = true;
			} else {
				this.tokens.pos = pos;
			}
		}
		if (hasElse) {
			elseCode = this.parser.parseStatement(Scopes.function);
		}
		return e=>{
			let temp: TempScore;
			if (elseCode) {
				temp = e.generateTempScore('ranIf');
				e.write(temp.set(0));
				let oldCode = code;
				code = e=>{
					oldCode(e);
					e.write(temp.set(1))
				}
			}
			e.write('execute ' + e.stringify(cond) + ' ' + e.getCommandWithRun('if',code));
			if (elseCode) {
				e.write('execute if score ' + temp.matches(0) + ' ' + e.getCommandWithRun('else',elseCode));
			}
			e.resetTempScore('ranIf');
		}
	}

	@RegisterStatement()
	while(): Statement {
		let cond = parseCondition(this.tokens);
		let code = this.parser.parseStatement(Scopes.function);
		if (!code) return e=>{}
		return e=>{
			let func = e.generateFunction('while');
			e.write('execute ' + e.stringify(cond) + ' run function ' + func.toString());
			let prev = e.target;
			e.target = func;
			code(e);
			e.write('execute ' + e.stringify(cond) + ' run function ' + func.toString());
			e.target = prev;
		}
	}

	@RegisterStatement()
	block(): Statement {
		let pos = parseLocation(this.tokens);
		if (this.tokens.skip('=')) {
			let block = Parsers.block.parse(this.tokens,{nbt: true, tag: false});
			return e=>{
				e.write('setblock ' + toStringPos(pos,e) + ' ' + toStringBlock(block(e,undefined),e));
			}
		} else if (this.tokens.skip('/')) {
			let path = parseNBTPath(this.tokens,false,Registry.tile_entities.createPathContext().strict(false));
			let access = parseNBTAccess(this.tokens,true,path[path.length-1].ctx);
			return e=>{
				return access({path, selector: {type: 'block', value: toStringPos(pos,e)}},e)
			}
		} else if (this.tokens.skip('.')) {
			let cmd = getBlockMembers().parse(this.tokens,true);
			return e=>{
				if (cmd) {
					e.write(cmd.res(toStringPos(pos,e),e));
				}
			}
		}
	}

	@RegisterStatement()
	summon(): Statement {
		let data = parseSummon(this.tokens);
		return e=>{
			e.write(data.toCommand(e));
		}
	}

	@MethodStatement(
		"Clone a region of blocks from one position to another",
		()=>[
			{key: "begin",type: VariableTypes.location,desc: "The start position"},
			{key: "end",type: VariableTypes.location,desc: "The end position"},
			{key: "destination",type: VariableTypes.location,desc: "The lower-north-west destination position"},
			{key: "mask",optional: true, type: ValueTypeObject.custom('CloneMask',parseCloneMask),defaultValue: {type: 'replace'},desc: "The mask mode: replace = copy all blocks, masked = copy only non-air blocks, filtered = copy only blocks matching a following block type"},
			{key: "mode",optional: true, type: Parsers.enum.configured({values: ["normal","force","move"]}),defaultValue:'normal',desc: "The clone mode: normal = default - cannot overlap source and destination, force = source and destination areas can overlap, move = clone the region and set all cloned blocks to air at the source position."}
		]
	)
	clone(e: Evaluator, begin: Location, end: Location, dest: Location, mask: CloneMask, mode: string): void {
		e.write('clone ' + chainSpaced(e,toStringPos(begin,e),toStringPos(end,e),toStringPos(dest,e),mask.type,toStringBlock(mask.block,e),mode));
	}

	@FieldStatement(
		"Set or get the default gamemode of the server",
		()=>({type: Parsers.enum.configured({values: ["survival","creative","adventure","spectator"]})})
	)
	defaultgamemode(e: Evaluator, gamemode: string) {
		if (gamemode) {
			e.write('defaultgamemode ' + gamemode);
		} else {
			e.write('defaultgamemode');
		}
	}

	@FieldStatement(
		"Set or get the difficulty of the world",
		()=>({type: Parsers.enum.configured({values: ["peaceful","easy","normal","hard"]})})
	)
	difficulty(e: Evaluator, difficulty: string) {
		if (difficulty) {
			e.write('difficulty ' + difficulty)
		} else {
			e.write('difficulty');
		}
	}

	@RegisterStatement()
	delete(): Statement {
		let access = parseFullNBTAccess(this.tokens);
		return e=>{
			let a = e.valueOf(access);
			e.write('data remove ' + toStringNBTAccess(a,e))
		}
	}

	@MethodStatement("Spawns a particle effect",()=>[
		{key: 'type', type: ValueTypeObject.custom('ParticleType',parseParticleType)},
		{key: 'pos', type: VariableTypes.location},
		{key: 'deltaX', type: VariableTypes.double},
		{key: 'deltaY', type: VariableTypes.double},
		{key: 'deltaZ', type: VariableTypes.double},
		{key: 'speed', type: VariableTypes.double},
		{key: 'count', type: VariableTypes.int},
		{key: 'forceMode', type: Parsers.enum.configured({values: ['force','normal']})},
		{key: 'viewers', type: VariableTypes.selector}
	])
	particle(e: Evaluator, type: ParticleInstance, pos: Location, dx: number, dy: number, dz: number, speed: number, count: number, fm: string, viewers: selectors.Selector) {
		if (type.type.noSpeed && speed > 0 && count > 0) {
			e.warn(type.labelRange,"This particle type does not support a speed value")
		}		
		e.write('particle ' + chainSpaced(e,type.label,toStringPos(pos,e),dx,dy,dz,speed,count,fm,viewers))
	}

	@RegisterStatement({inclusive: true})
	runFunc(): Statement {
		if (!this.tokens.isTypeNext(TokenType.identifier)) return;
		let name = this.tokens.expectType(TokenType.identifier);
		if (this.tokens.skip('(') && this.tokens.skip(')')) { // todo: add params
			return e=>{
				//e.suggestAt(name.range,...e.functions.map(f=>({value: f.name, type: CompletionItemKind.Function, snippet: f.name + '($0)'})))
				let func = e.requireFunction(name);
				if (func) {
					e.write('function ' + func.toString());
				}
			}
		}
	}
}

function parseCloneMask(t: TokenIterator): Lazy<CloneMask> {
	let mask = t.expectValue("replace","masked","filtered");
	if (!mask || mask != 'filtered') return Lazy.untyped(()=>({type: mask}));
	let block = Parsers.block.parse(t,{tag: true, nbt: true});
	if (!block) return;
	return Lazy.untyped((e)=>({type: 'filtered',block: e.valueOf(block)}));
}

interface CloneMask {
	type: string,
	block?: Block
}


interface SummonData {
	type: string
	loc: Location
	nbt: Lazy<any>
	toCommand: (e: Evaluator)=>string
}

function parseSummon(t: TokenIterator): SummonData {
	let id = t.expectType(TokenType.identifier,()=>Registry.entities.keys());
	if (!id.value) {
		t.errorNext("Expected entity ID");
		return
	}
	let entity = Registry.entities.get(id.value);
	if (!entity) {
		t.error(id.range,"Unknown entity ID " + id.value);
	}
	
	let nbt;
	if (t.isNext('{')) {
		nbt = parseNBT(t,Registry.entities.createContext(id.value,true)); 
	}
	let loc = parseLocation(t);
	return {type: id.value,loc,nbt, toCommand: (e)=>'summon ' + id.value + ' ' + toStringPos(loc,e) + (nbt ? ' ' + e.stringify(nbt) : '')}
}

type ContainerCommand = (target: string, e: Evaluator)=>string

let _containerMembers: MemberGroup<BaseMemberEntry<ContainerCommand>,ContainerCommand>;

function getContainerMembers() {
	if (_containerMembers) return _containerMembers;
	class ContainerMembers extends MemberGroup<BaseMemberEntry<ContainerCommand>,ContainerCommand> {
		init(): BaseMemberEntry<ContainerCommand>[] {
			return [
				{
					name: 'replaceWithLoot',
					params: [
						{
							key: 'source',
							type: ValueTypeObject.custom('LootSource',parseLootSource)
						},
						{
							key: 'count',
							desc: 'The number of slots after the specified slot to put loot in',
							type: VariableTypes.int,
							optional: true
						}
					],
					desc: 'Replaces the slot (or slots) in the container with loot',
					resolve: params=>(target,e)=>'loot replace ' + target + (params.count ? ' ' + e.stringify(params.count) + ' ' : ' ') + params.source(e)
				},
				{
					name: 'replace',
					params: [
						{
							key: 'item',
							type: Parsers.item.configured({nbt: true,tag: false, count: true})
						}
					],
					desc: 'Replaces the item in this slot with the specified item',
					resolve: item=>(target,e)=>'replaceitem ' + target + ' ' + toStringItem(item,e)
				}
			]
		}
	}
	return _containerMembers = new ContainerMembers();
}

type BlockCommand = (pos: string, e: Evaluator)=>string;

let _blockMembers: MemberGroup<BaseMemberEntry<BlockCommand>,BlockCommand>;

function getBlockMembers() {
	if (_blockMembers) return _blockMembers;
	class BlockMembers extends MemberGroup<BaseMemberEntry<BlockCommand>,BlockCommand> {
		init(): BaseMemberEntry<BlockCommand>[] {
			
			return [
				{
					name: 'spawnLoot',
					desc: 'Spawns the specified loot source as item entities at this location',
					params: [
						{
							key: 'source',
							type: ValueTypeObject.custom('LootSource',parseLootSource)
						}
					],
					resolve: src=>(pos,e)=>'loot spawn ' + pos + ' ' + src(e)
				},
				{
					name: 'insertLoot',
					desc: 'Insert the specified loot to a container at this location',
					params: [
						{
							key: 'source',
							type: ValueTypeObject.custom('LootSource',parseLootSource)
						}
					],
					resolve: src=>(pos,e)=>'loot insert ' + pos + ' ' + src(e)
				},
				{
					name: 'container',
					desc: 'Accesses the container of this block, in the specified slot index',
					type: ValueTypeObject.custom('Container',t=>{
						if (t.expectValue('[')) {
							let index = parseExpression(t,VariableTypes.int)
							t.expectValue(']')
							if (t.skip('.')) {
								let cmd = getContainerMembers().parse(t,true);
								return {index, cmd}
							}
						}
					}),
					noEqualSign: true,
					resolve: params=>(pos,e)=>params.cmd('block ' + pos + ' container.' + e.stringify(params.index))
				}
			]
		}
		getSignatureString(member: BaseMemberEntry<BlockCommand>): string {
			return 'block[<pos>].' + toStringMemberSignature(member)
		}
		
	}
	return _blockMembers = new BlockMembers();
}

