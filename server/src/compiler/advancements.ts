import { ResourceLocation, MCFunction, DatapackItem, Files } from '.';
import { ValueTypeObject, VariableTypes, VariableType } from './util';
import { TokenIterator, TokenType } from './tokenizer';
import { SemanticType } from '../server';
import { Scope, RegisterStatement, Lazy, Statement, Evaluator, MainScopes, parseExpression } from './parser';
import { praseJson, JsonContext, JsonTextType } from './json_text';
import { isArray } from 'util';

export type Frame = 'task' | 'goal' | 'challenge';

export interface AdvancementDisplay {
	title?: any
	description?: any
	icon?: {item: string, nbt: string}
	frame?: Frame
	background?: string
	show_toast?: boolean
	announce_to_chat?: boolean
	hidden?: boolean
}

export interface Rewards {
	function?: string
	recipes?: string[]
	loot?: string[]
	experience?: number
}

export class Advancement extends DatapackItem {
	display: AdvancementDisplay
	parent: ResourceLocation
	criteria: Criterion[] = []
	rewards: Rewards = {}

	constructor(id: ResourceLocation, public root = false) {
		super(id);
		id.ns.add(this);
	}
	save(dir: Files.Directory): void {
		let f = this.loc.createFile(dir,'json');
		let crit = {};
		let needsReq = false;
		let req: string[][] = [];
		for (let c of this.criteria) {
			if (isArray(c)) {
				needsReq = true;
				let or = []
				for (let c2 of c) {
					crit[c2.id] = {trigger: c2.trigger.realId || c2.trigger.id,conditions: c2.conditions}
					or.push(c2.id);
				}
				req.push(or);
			} else {
				crit[c.id] = {trigger: c.trigger.realId || c.trigger.id,conditions: c.conditions}
				req.push([c.id]);
			}
		}
		f.write(JSON.stringify({
			display: this.display,
			parent: this.parent ? this.parent.toString() : undefined,
			criteria: crit,
			requirements: needsReq ? req : undefined,
			rewards: this.rewards
		}));
	}
	dirName: string = 'advancements'

	withDisplay(display: AdvancementDisplay) {
		if (!this.display) {
			this.display = {};
		}
		this.display = Object.assign(this.display,display);
	}
}

export type Criterion = CriterionEntry[] | CriterionEntry

export interface CriterionEntry {
	trigger: Trigger
	conditions: any
	id: string
}


export interface ConditionEntry {
	key: string
	realKey?: string
	type: ValueTypeObject
}

export interface Trigger {
	id: string
	realId?: string
	conditions: ConditionEntry[]
}

const advancementCriterionVar: VariableType<CriterionEntry> = {
	name: 'AdvancementCriterion',
	defaultValue: {trigger: undefined,conditions: {},id: ""},
	isPrimitive: true,
	stringify: (c,e)=>c.id + "(" + c.trigger.realId + ")"
}

export function parseAdvancement(t: TokenIterator, canBeTree: boolean = false): Advancement {
	if (canBeTree && t.isTypeNext(TokenType.identifier) && t.suggestHere('tree')) {
		t.ctx.editor.addSemantic(t.nextPos,SemanticType.keyword);
		t.skip();
		return parseTree(t);
	}
	let id = t.expectType(TokenType.identifier);
	return new Advancement(new ResourceLocation(t.ctx.script.namespace,id.value));
}

function parseTree(t: TokenIterator): Advancement {
	let id = t.expectType(TokenType.identifier);
	return new Advancement(new ResourceLocation(t.ctx.script.namespace,id.value + '/root'),true);
}

interface RewardType {
	id: string
	parser: (t: TokenIterator)=>Lazy<any>
	apply: (rewards: Rewards, value: any, err: (msg: string)=>void)=>void
}

const RewardTypes: RewardType[] = [
	{
		id: "function",
		parser: (t)=>{
			let st = MainScopes.global.function();
			return e=>{
				let func: MCFunction = st(e);
				return {value: func.loc.toString(),type: VariableTypes.string}
			}
		},
		apply: (rewards,v,err)=>{
			if (rewards.function) {
				err('Advancement rewards can only have one function!')
			}
			rewards.function = v
		}
	},
	{
		id: "xp",
		parser: (t)=>{
			return parseExpression(t,VariableTypes.integer);
		},
		apply: (rewards,v,err)=>{
			if (rewards.experience !== undefined) {
				err('Advancement rewards can only give xp once!')
			}
			rewards.experience = v;
		}
	}
]

export class AdvancementScope extends Scope {

	constructor(public adv: Advancement) {
		super();
	}

	@RegisterStatement()
	title(): Statement {
		let json = praseJson(this.tokens,JsonContext.of(JsonTextType.title))
		return e=>{
			this.adv.withDisplay({title: e.valueOf(json)})
		}
	}

	@RegisterStatement()
	description(): Statement {
		let json = praseJson(this.tokens,JsonContext.of(JsonTextType.title))
		return e=>{
			this.adv.withDisplay({description: e.valueOf(json)})
		}
	}

	@RegisterStatement()
	reward(): Statement {
		let type = this.tokens.expectId(RewardTypes,'reward type',t=>t.id);
		if (type) {
			let value =  type.value.parser(this.tokens);
			return (e)=>{
				type.value.apply(this.adv.rewards,e.valueOf(value),(msg)=>e.error(type.range,msg));
			}
		}
	}

	@RegisterStatement()
	child(): Statement {
		let a = parseAdvancement(this.tokens,false);
		let block = this.parser.parseBlock(new AdvancementScope(a));
		return e=>{
			block(e);
			a.parent = this.adv.loc;
		}
	}

	@RegisterStatement()
	frame(): Statement {
		let frame: Frame = <Frame>this.tokens.expectValue('task','goal','challenge');
		return e=>{
			this.adv.withDisplay({frame})
		}
	}

	// @RegisterStatement()
	// when(): Statement {
	// 	let trigger = parseExpression(this.tokens,advancementConditionVar)
	// }

}