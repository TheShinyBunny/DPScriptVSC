import { Expression, RangeExpression, MemberUsageExpression, AST, MemberUsageStatement, EntityScoreExpression, ValueExpression } from '../ast';
import { Parser, Suggestion } from '../parser';
import { Token, TokenType } from '../tokenizer';
import { Field, forEachEntry, getMemberSuggestions, InvokeParams, MemberContainer, MemberUsage, Method, Parameter, parseFieldUsage, parseMemberUsage, parseMethodCall, ResourceLocation } from '../utils';
import { RegistryNBTContext, NBTContext } from './nbt';
import { NumberRange } from './range';
import { Value, ValueType, ValueTypes } from './types';
import * as selectorMembers from '../data/selector_members.json'
import { GenContext } from '../generate';
import { parseScoreModification } from './score';
import { Range } from 'vscode-languageserver-textdocument';

export class SelectorType extends ValueType<Selector> {
	getDetail(ctx: any, key: string): string {
		return 'Selector'
	}
	parse(p: Parser): Selector {
		let start = p.token.range.start
		let target: string
		let type: ResourceLocation
		if (p.isNext('self')) {
			p.nextToken()
			target = 's'
			type = p.contextSelfType
		} else if (p.isNext('@') && p.peek(1).type == TokenType.identifier) {
			p.nextToken()
			let t = p.parseResourceLocation()
			if (t.matches('a') || t.matches('players')) {
				target = 'a'
				type = ResourceLocation.from('player')
			} else if (t.matches('r') || t.matches('random')) {
				target = 'r'
				type = ResourceLocation.from('player')
			} else if (t.matches('p')) {
				target = 'p'
				type = ResourceLocation.from('player')
			} else {
				target = 'e'
				type = t
			}
		} else {
			return
		}
		let sel = new Selector(target,type)
		if (p.isNext('[')) {
			p.nextToken()
			let possible: SelectorParam[] = [...getParams()]
			p.suggestHere(...possible.map(p=>(<Suggestion>{value: p.key, detail: p.parser instanceof ValueType ? p.parser.getDetail({},p.key) : undefined,desc: p.desc})))
			while (p.hasNext() && !p.isNext(']')) {
				if (p.isTypeNext(TokenType.identifier)) {
					let k = p.nextToken()
					let pid = possible.findIndex(p=>p.key == k.value)
					if (pid >= 0) {
						let param = possible[pid]
						if (param.parser instanceof ValueType) {
							if (p.expectValue('=')) {
								let res = param.parser.parse(p,{})
								if (res) {
									sel.add(k,{type: param.parser,value: res})
								} else {
									p.error(p.token.range,"Expected " + param.parser.getDetail({},k.value))
								}
								if (!param.multiple) {
									possible.splice(pid,1)
								}
							}
						} else {
							let res = param.parser(p,sel,k)
							if (res) {
								if (typeof res == 'boolean') {
									possible.splice(pid,1)
								} else {
									let fb = res.forbidden;
									possible = possible.filter(p=>fb.indexOf(p.key) < 0)
								}
							}
						}
					} else {
						parseScoreParam(p,sel,k)
					}
				} else if (p.isTypeNext(TokenType.integer)) {
					let lim = p.nextToken()
					sel.add(lim.withValue('limit'),{value: Number(lim),type: ValueTypes.int})
				}
				if (p.isNext(',')) {
					p.nextToken()
					p.suggestHere(...possible.map(p=>(<Suggestion>{value: p.key, detail: p.parser instanceof ValueType ? p.parser.getDetail({},p.key) : undefined,desc: p.desc})))
				}
			}
			p.expectValue(']')
		}
		sel.range = {start, end: p.prevToken.range.end}
		return sel
	}

	parseAccess(p: Parser, sel: Selector, ctx: any, canModify: boolean) {
		if (p.isNext('.')) {
			p.nextToken();
			let m = parseSelectorMember(p,sel,canModify);
			if (m) {
				return m
			}
		} else if (p.isNext('/')) {
			let path = ValueTypes.nbtPath.parse(p,{ctx: new RegistryNBTContext('entity',sel.type)});
			if (canModify) {
				// data merge / modify / remove
			}
			return new ValueExpression(ValueTypes.nbtAccess,{type: 'entity',selector: this.of(sel),path});
		}
	}

	toString(value: Selector, ctx: any, gen: GenContext) {
		let str = '@' + value.target;
		let entries: string[] = []
		if (value.type) {
			if (value.target != 'p' && value.target != 'a') {
				entries.push('type=' + value.type.toString())
			}
		}
		for (let e of value.params) {
			entries.push(e.key.value + '=' + e.value.type.toString(e.value.value,{},gen))
		}
		if (value.scores.length > 0) {
			let ss = '{' + value.scores.map(s=>s.objective.value + s.range.generate(gen).value.toString()) + '}'
			entries.push('scores=' + ss);
		}
		if (entries.length > 0) {
			str += '[' + entries.join(',') + ']'
		}
		return str;
	}

}

export class Selector {

	params: SelectorEntry[] = []
	scores: SelectorScoreEntry[] = []
	range: Range

	constructor(public target: string, public type?: ResourceLocation) {

	}

	get(key: string) {
		return this.params.find(p=>p.key.value == key)
	}

	add(key: Token, value: Value<any>) {
		this.params.push({key,value})
	}

	addString(key: Token, value: string) {
		this.add(key,ValueTypes.string.of(value))
	}

	addScore(obj: Token, range: RangeExpression) {
		this.scores.push({objective: obj,range})
	}

	allowsMultiple() {
		if (this.target == 's' || this.target == 'p') return false
		let lim = this.get('limit')
		if (lim && lim.value.value == 1) {
			return false
		}
		return true
	}
}

interface SelectorParam {
	key: string
	desc?: string
	parser: ValueType<any> | ((p: Parser, sel: Selector, k: Token)=>boolean | {forbidden: string[]} | void)
	multiple?: boolean
	playerOnly?: boolean
}

export interface SelectorEntry {
	key: Token
	value: Value<any>
}

export interface SelectorScoreEntry {
	objective: Token
	range: RangeExpression
}

let params: SelectorParam[]

function getParams(): SelectorParam[] {
	if (params) return params
	return params = [
		{
			key: "tag",
			parser: ValueTypes.string,
			multiple: true
		},
		{
			key: "gamemode",
			parser: ValueTypes.enumValue.configured({values: ['survival','creative','adventure','spectator']}),
			playerOnly: true
		},
		{
			key: "nearest",
			parser: (p,sel,k)=>{
				sel.addString(k.withValue('sort'),'nearest')
				return {forbidden: ['furthest','random']}
			}
		},
		{
			key: "furthest",
			parser: (p,sel,k)=>{
				sel.addString(k.withValue('sort'),'furthest')
				return {forbidden: ['nearest','random']}
			}
		},
		{
			key: "random",
			parser: (p,sel,k)=>{
				sel.addString(k.withValue('sort'),'nearest')
				return {forbidden: ['nearest','furthest']}
			}
		},
		{
			key: 'nbt',
			parser: (p,sel,k)=>{
				if (p.expectValue('/')) {
					let path = ValueTypes.nbtPath.parse(p,{ctx: new RegistryNBTContext('entity',sel.type)})
				}
			}
		}
	]
}

function parseRangeParam(p: Parser, sel: Selector): RangeExpression {
	if (p.isTypeNext(TokenType.operator)) {
		let op = p.nextToken()
		let val = p.parseExpression(ValueTypes.int)
		switch (op.value) {
			case '>':
				return new RangeExpression(val,undefined,true)
			case '>=':
				return new RangeExpression(val,undefined)
			case '<':
				return new RangeExpression(undefined,val,false,true)
			case '<=':
				return new RangeExpression(undefined,val,false,false)
			case '=':
			case '==':
				return new RangeExpression(val,val)
		}
	}
}

function parseScoreParam(p: Parser, sel: Selector, k: Token) {
	let r = parseRangeParam(p,sel)
	if (r) {
		sel.addScore(k,r)
	}
}

/* let members: SelectorMember[] = [
	{
		name: "kill",
		params: [],
		desc: "Kills the selected entities",
		command: 'kill @selector'
	},
	{
		name: "clear",
		desc: "Clears the player's inventory from all, or a specific type of items",
		params: [
			{
				name: "item",
				optional: true,
				type: ValueTypes.item.configured({tag: true}),
				desc: "An optional item predicate to clear"
			},
			{
				name: "count",
				optional: true,
				type: ValueTypes.int,
				desc: "An optional number of items to clear. When 0, will not clear any items but only return the count of those items in the inventory"
			}
		],
		command: 'clear @selector [item] [count]',
		playerOnly: true
	},
	{
		name: "gamemode",
		desc: "Gets or sets the player's game mode",
		type: ValueTypes.enumValue.configured({values: ["survival","creative","adventure","spectator"]}),
		command: "gamemode @selector [value]",
		hasResult: true,
		playerOnly: true
	},
	{
		name: "equip",
		desc: "Equips the specified item to a slot in the entity's equipment",
		params: [
			{
				name: "slot",
				type: ValueTypes.enumValue.configured({values: 'equipment_slots'}),
				desc: "The slot to place the item in"
			}
		],
		command: "replaceitem entity @selector <slot> <item>"
	}
]  */

export interface SelectorMethod extends Method {
	playerOnly?: boolean
}

export interface SelectorMemberUsage {
	command: string
	playerOnly?: boolean
	params: InvokeParams
}

export function validateMembers() {
	forEachEntry(selectorMembers.methods,(k,m)=>{
		for (let p of m.params) {
			if (p.type) {
				if (!ValueType.get(p.type)) {
					// error
				}
			}
		}
	})
	forEachEntry(selectorMembers.fields,(k,f)=>{
		
	})
}

export function parseSelectorMember(p: Parser, sel: Selector, canModify: boolean): AST<any> {
	p.suggestHere(...getMemberSuggestions(selectorMembers))
	if (p.isTypeNext(TokenType.identifier)) {
		console.log('parsing selector member:',p.token)
		let token = p.nextToken()
		let res = parseMemberUsage(p,token,selectorMembers as MemberContainer,canModify);
		if (!res) return
		if (res.success) {
			return new MemberUsageStatement(ValueTypes.selector.of(sel),res,'@selector')
		}
		if (p.isNext('(')) {
			// function call
		}
		if (p.getVariableType(token) != ValueTypes.objective) { // or trigger
			p.error(token.range,"Unknown objective '" + token.value + "'")
		}
		let expr = new EntityScoreExpression(sel,token);
		if (canModify) {
			return parseScoreModification(p,expr);
		}
		if (sel.allowsMultiple()) {
			p.error(sel.range,"This selector can select multiple entities")
		}
		return expr
	}
	
}
