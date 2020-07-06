import { ResourceLocation } from '.';
import { ValueTypeObject } from './util';

export type Frame = 'task' | 'goal' | 'challenge'

export interface AdvancementDisplay {
	title: any
	icon: {item: string, nbt: string}
	frame?: Frame
	background?: string
	show_toast?: boolean
	announce_to_chat?: boolean
	hidden?: boolean
}

export interface Rewards {
	function: ResourceLocation
	recipes: ResourceLocation[]
	loot: ResourceLocation[]
	experience: number
}

export class Advancement {
	display: AdvancementDisplay
	parent: ResourceLocation
	criteria: Criterion[]
	rewards: Rewards	

	constructor(public id: ResourceLocation) {

	}
}

export class Criterion {
	
	constructor(id: string, trigger: Trigger, conditions: any) {

	}
}

export interface ConditionEntry {
	key: string
	realKey?: string
	type: ValueTypeObject
}

export interface Trigger {
	realId?: string
	conditions: ConditionEntry[]
}