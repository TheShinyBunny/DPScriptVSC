import { TokenIterator } from './tokenizer';
import { Lazy, parseExpression } from './parser';
import { NBT } from './nbt';
import { VariableType, VariableTypes } from './util';

export interface EntityClass {
	id: string,
	tags?: EntityTag[],
	children?: EntityClass[],
	abstract?: boolean;
}

export interface EntityTag {
	key: string,
	desc: string,
	type?: VariableType<any>,
	aliases?: string[],
	useKeyAsAlias?: boolean,
	parser?: (t: TokenIterator)=>Lazy<any>,
	applyToNBT?: (value: Lazy<any>,nbt: NBT)=>void
}

export namespace EntityTag {
	export function string(key: string, desc: string, ...aliases: string[]): EntityTag {
		return {
			key, aliases, desc,
			parser: t=>parseExpression(t,VariableTypes.string)
		}
	}

	export function bool(key: string, desc: string, ...aliases: string[]): EntityTag {
		return {
			key, aliases, desc,
			parser: t=>parseExpression(t,VariableTypes.boolean)
		}
	}

	export function invertedBool(key: string, desc: string, ...aliases: string[]): EntityTag {
		return {
			key, aliases, desc,
			parser: t=>{
				let v = parseExpression(t,VariableTypes.boolean);
				return e=>{
					return {value: !e.valueOf(v),type: VariableTypes.boolean};
				}
			},
			useKeyAsAlias: false
		}
	}
}

export const entityTree: EntityClass = {
	id: "entity",
	abstract: true,
	tags: [
		{
			key: "Invulnerable",
			desc: "When true, prevents this entity from dying in any form (excluding /kill-ing)",
			aliases: ["invincible"],
			type: VariableTypes.boolean
		},
		EntityTag.invertedBool("NoGravity","When false, disables the gravity of the entity","gravity")
	],
	children: [
		{
			id: "living_entity",
			abstract: true,
			tags: [],
			children: [
				{
					id: "mob",
					abstract: true,
					tags: [],
					children: [
						{
							id: "zombie_base",
							abstract: true,
							tags: [],
							children: [
								{
									id: "zombie",
									tags: [EntityTag.bool("IsBaby","When true, the zombie will be a baby zombie","baby","child","IsChild")]
								}
							]
						},
						{
							id: "creeper"
						},
						{
							id: "enderman"
						},
						{
							id: "slime"
						}
					]
				}
			]
		}
	]
}

export interface EntityType {
	id: string
	tags: EntityTag[]
}

function getEntitiesRecursive(entity: EntityClass, tags: EntityTag[]) {
	let arr: EntityType[] = [];
	let allTags = [...tags];
	if (entity.tags) {
		allTags.push(...entity.tags);
	}
	if (!entity.abstract) {
		arr.push({id: entity.id,tags: allTags});
	}
	if (entity.children) {
		for (let c of entity.children) {
			arr.push(...getEntitiesRecursive(c,allTags));
		}
	}
	return arr;
}

export const entities: EntityType[] = getEntitiesRecursive(entityTree,[]);