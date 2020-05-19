import { Scope, ScopeType, RegisterStatement, Statement, parseExpression, getLazyVariable, parseCondition, TempScore, RegisteredStatement, Evaluator, Lazy } from '../parser';
import { VariableTypes, parseLocation, toStringPos, parseBlock, Location, MethodParameter, Block, parseMethod, getSignatureFromParams, parseIdentifierOrIndex, VariableType, ValueTypeObject, parseValueTypeObject } from '../util';
import * as selectors from '../selector';
import { TokenType, TokenIterator } from '../tokenizer';
import { CompletionItemKind } from 'vscode-languageserver';
import { nbtRegistries, parseNBT, createNBTContext, parseNBTPath, NBTPathContext, parseNBTAccess, NBTPath, PathNodeType } from '../nbt';
import { isArray } from 'util';


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
			if (instance.tokens.expectValue('(')) {
				let params = paramGetter();
				let res = parseMethod(instance.tokens,getSignatureFromParams(params),params,descriptor.value.name,desc);
				if (!res) return e=>{};
				instance.tokens.expectValue(')');
				return e=>{
					let args = new Array(1 + (isArray(params) ? params.length : 1));
					args[0] = e;
					if (Lazy.is(res)) {
						args[1] = e.valueOf(res);
					} else if (typeof res == 'object') {
						for (let k of Object.keys(res)) {
							let i = params.findIndex((p,i)=>(p.key || i) == k) + 1;
							args[i] = e.valueOf(res[k]);
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
	values?: string[],
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
				let res = parseValueTypeObject(instance.tokens,type.type,type.values,false)
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
	codeBlock(scope: ScopeType): Statement {
		if (!this.tokens.isNext('{')) return undefined;
		return this.parser.parseBlock(scope);
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
		let cmd = selectors.parseSelectorCommand(this.tokens,false,selector.type);
		if (!cmd) {
			return e=>{}
		}
		return e=>{
			return cmd(selector,e);
		}
	}

	@RegisterStatement()
	storage(): Statement {
		this.tokens.expectValue(':');
		let name = this.tokens.expectType(TokenType.identifier);
		let path: NBTPath;
		if (this.tokens.skip('/')) {
			path = parseNBTPath(this.tokens,false,new NBTPathContext([]));
		} else {
			path = [{ctx: new NBTPathContext([]),label: Lazy.literal({},VariableTypes.nbt),type: PathNodeType.root}];
		}
		let access = parseNBTAccess(this.tokens,path);
		return e=>{
			return access({type: 'storage',value: name.value},e);
		}
	}

	@RegisterStatement({inclusive: true})
	runFunc(): Statement {
		if (!this.tokens.isTypeNext(TokenType.identifier)) return;
		let name = this.tokens.expectType(TokenType.identifier);
		if (this.tokens.skip('(') && this.tokens.skip(')')) { // todo: add params
			return e=>{
				let func = e.requireFunction(name);
				if (func) {
					e.write('function ' + func.toString());
				}
			}
		}
	}

	@RegisterStatement({inclusive: true})
	varUsage(): Statement {
		this.tokens.suggestHere(...this.ctx.getAllVariables().map(v=>({value: v.name, detail: v.type.name, type: CompletionItemKind.Variable})));
		if (!this.tokens.isTypeNext(TokenType.identifier)) return;
		let name = this.tokens.expectType(TokenType.identifier);
		if (this.ctx.hasVariable(name.value)) {
			let type = this.ctx.getVariableType(name.value);
			if (type.usageParser) {
				return type.usageParser(this.tokens,getLazyVariable(name),name.value);
			} else {
				this.tokens.error(name.range,"This variable cannot be used as a statement")
			}
		}
	}

	@RegisterStatement({desc: "Iterates over entities, an array or through a range"})
	for(): Statement {
		if (this.tokens.skip('(')) {
			if (this.tokens.suggestHere('summon')) {
				this.tokens.skip();
				let s = parseSummon(this.tokens);
				if (this.tokens.expectValue(')')) {
					let p = this.ctx.currentEntity;
					this.ctx.currentEntity = {params: [],target: selectors.SelectorTarget.self,type: s.type}
					let code = this.parser.parseStatement('function');
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
			return this.chainExecute(e=>'execute as ' + selectors.Selector.toString(selector,e) + ' at @s',selector);
		}
	}

	chainExecute(command: string | ((e: Evaluator)=>string), currentEntity?: selectors.Selector): Statement {
		let p = this.ctx.swapCurrentEntity(currentEntity);
		let code = this.parser.parseStatement('function');
		this.ctx.currentEntity = p;
		return e=>{
			let cmd = typeof command == 'function' ? command(e) : command;
			e.write('execute ' + cmd + ' ' + e.getCommandWithRun('execute',code));
		}
	}

	@RegisterStatement({desc: "Executes the following statement with the specified entity selector as the context entity/s"})
	as(): Statement {
		let selector = selectors.parseSelector(this.tokens);
		return this.chainExecute((e)=>'as ' + selectors.Selector.toString(selector,e),selector);
	}

	@RegisterStatement({desc: "Executes the following statement at the position of the specified entity/s"})
	at(): Statement {
		let selector = selectors.parseSelector(this.tokens);
		return this.chainExecute((e)=>'at ' + selectors.Selector.toString(selector,e));
	}

	@RegisterStatement({desc: "Aligns execution to the specified axies"})
	align(): Statement {
		let combo = this.tokens.expectType(TokenType.identifier);
		let hasError = false;
		if (combo.value.match(/x/i).length > 1) {
			this.tokens.error(combo.range,"Axis combo contains multiple X");
			hasError = true;
		}
		if (combo.value.match(/y/i).length > 1) {
			this.tokens.error(combo.range,"Axis combo contains multiple Y");
			hasError = true;
		}
		if (combo.value.match(/z/i).length > 1) {
			this.tokens.error(combo.range,"Axis combo contains multiple Z");
			hasError = true;
		}
		if (!hasError && combo.value.match(/^[xyz]{1,3}$/i).length == 0) {
			this.tokens.error(combo.range,"Invalid axis combo, expected a combination of only x, y and z.")
		}
		return this.chainExecute('align ' + combo.value);
	}

	@RegisterStatement({desc: "Alignes the execution to the feet/eyes of the entity"})
	anchored(): Statement {
		let anchor = this.tokens.expectType(TokenType.identifier,()=>["feet","eyes"]);
		if (anchor.value != 'feet' && anchor.value != 'eyes') {
			this.tokens.error(anchor.range,"Anchor must be either feet or eyes!");
		}
		return this.chainExecute('anchored ' + anchor.value);
	}

	@RegisterStatement()
	if(): Statement {
		let cond = parseCondition(this.tokens);
		let code = this.parser.parseStatement('function');
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
			elseCode = this.parser.parseStatement('function');
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
				e.write('execute if ' + temp.matches(0) + ' ' + e.getCommandWithRun('else',elseCode));
			}
			e.resetTempScore('ranIf');
		}
	}

	@RegisterStatement()
	while(): Statement {
		let cond = parseCondition(this.tokens);
		let code = this.parser.parseStatement('function');
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
			let block = parseBlock(this.tokens,true,false);
			return e=>{
				e.write('setblock ' + toStringPos(pos,e) + ' ' + e.stringify(block));
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
			{key: "mask",optional: true, type: parseCloneMask,defaultValue: {type: 'replace'},desc: "The mask mode: replace = copy all blocks, masked = copy only non-air blocks, filtered = copy only blocks matching a following block type"},
			{key: "mode",optional: true, type: TokenType.identifier,defaultValue:'normal', values: ["normal","force","move"],desc: "The clone mode: normal = default - cannot overlap source and destination, force = source and destination areas can overlap, move = clone the region and set all cloned blocks to air at the source position."}
		]
	)
	clone(e: Evaluator, begin: Location, end: Location, dest: Location, mask: CloneMask, mode: string): void {
		e.write('clone ' + toStringPos(begin,e) + ' ' + toStringPos(end,e) + ' ' + toStringPos(dest,e) + ' ' + mask.type + (mask.block ? ' ' + mask.block.stringify(e) : '') + ' ' + mode);
	}

	@FieldStatement(
		"Set or get the default gamemode of the server",
		()=>({type: TokenType.identifier, values: ["survival","creative","adventure","spectator"]})
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
		()=>({type: TokenType.identifier, values: ["peaceful","easy","normal","hard"]})
	)
	difficulty(e: Evaluator, difficulty: string) {
		if (difficulty) {
			e.write('difficulty ' + difficulty)
		} else {
			e.write('difficulty');
		}
	}
}

function parseCloneMask(t: TokenIterator): Lazy<CloneMask> {
	let mask = t.expectValue("replace","masked","filtered");
	if (!mask || mask != 'filtered') return Lazy.untyped(()=>({type: mask}));
	let block = parseBlock(t,true,true);
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
	let id = t.expectType(TokenType.identifier,()=>Object.keys(nbtRegistries.entities.entries));
	if (!id.value) {
		t.errorNext("Expected entity ID");
		return
	}
	let entity = nbtRegistries.entities.entries[id.value];
	if (!entity) {
		t.error(id.range,"Unknown entity ID " + id.value);
		entity = nbtRegistries.entities.base;
	}
	let loc = parseLocation(t);
	let nbt;
	if (t.isNext('{')) {
		nbt = parseNBT(t,createNBTContext(nbtRegistries.entities,id.value,true)); 
	}
	return {type: id.value,loc,nbt, toCommand: (e)=>'summon ' + id.value + ' ' + toStringPos(loc,e) + (nbt ? ' ' + e.stringify(nbt) : '')}
}