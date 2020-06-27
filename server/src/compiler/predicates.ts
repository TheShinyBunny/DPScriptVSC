import { ValueTypeObject, VariableTypes, Block, parseRangeComparison, parseMethod, MethodParameter, getSignatureFromParam } from './util';
import { Evaluator, Lazy } from './parser';
import { JsonProperty, praseJson, JsonContext } from './json_text';
import { entityEffects, entityEquipmentSlots } from './entities';
import { TokenType, TokenIterator } from './tokenizer';
import { Registry } from './registries';
import { DatapackItem, ResourceLocation } from '.';
import { isArray } from 'util';

interface PredicateProperty extends MethodParameter {
	realKey?: string
	toJson?: (v: any, e: Evaluator, currentData: any)=>any
	mergeResult?: boolean
}

interface PredicateType {
	realKey?: string
	params: PredicateProperty[]
}

let _predicateTypes: {[id: string]: PredicateType};

function distancePredicate() {
	return createJsonParser('Distance',[
		{
			key: "absolute",
			type: VariableTypes.range
		},
		{
			key: "horizontal",
			type: VariableTypes.range
		},
		{
			key: "x",
			type: VariableTypes.range
		},
		{
			key: "y",
			type: VariableTypes.range
		},
		{
			key: "z",
			type: VariableTypes.range
		}
	])
}

function enchantmentsPredicate() {
	return ValueTypeObject.listOf(createJsonParser('Enchantment',[
		{
			key: "id",
			path: ["enchantment"],
			type: ValueTypeObject.token(TokenType.identifier,...Registry.enchantments.keys()).withCustomLabel('EnchantmentId')
		},
		{
			key: "levels",
			type: VariableTypes.range
		}
	]))
}

function locationPredicate() {
	return createJsonParser('LocationPredicate',[
		{
			key: "biome",
			type: ValueTypeObject.token(TokenType.identifier,...Registry.biomes).withCustomLabel('BiomeId')
		},
		{
			key: "block",
			type: createJsonParser('BlockPredicate',[
				{
					key: "type",
					path: ["block"],
					type: ValueTypeObject.token(TokenType.identifier,...Object.keys(Registry.blocks)).withCustomLabel('BlockId')
				},
				{
					key: "tag",
					type: VariableTypes.string
				},
				{
					key: "nbt",
					type: VariableTypes.string
				},
				{
					key: "state",
					type: VariableTypes.nbt
				}
			])
		},
		{
			key: "dimension",
			type: ValueTypeObject.token(TokenType.identifier,'overworld','the_nether','the_end')
		},
		{
			key: "feature",
			type: ValueTypeObject.token(TokenType.identifier,...Registry.structures).withCustomLabel('StructureId')
		},
		{
			key: "fluid",
			type: createJsonParser('FluidPredicate',[
				{
					key: "fluid",
					type: ValueTypeObject.token(TokenType.identifier,...Registry.fluids).withCustomLabel('FluidId')
				},
				{
					key: "tag",
					type: VariableTypes.string
				},
				{
					key: "nbt",
					type: VariableTypes.string
				},
				{
					key: "state",
					type: VariableTypes.nbt
				}
			])
		},
		{
			key: "light",
			path: ["light","light"],
			type: VariableTypes.range
		},
		{
			key: "x",
			path: ["position","x"],
			type: VariableTypes.range
		},
		{
			key: "y",
			path: ["position","y"],
			type: VariableTypes.range
		},
		{
			key: "z",
			path: ["position","z"],
			type: VariableTypes.range
		},
		{
			key: "smokey",
			type: VariableTypes.boolean
		}
	])
}

function itemPredicate() {
	return createJsonParser('ItemPredicate',[
		{
			key: "count",
			type: VariableTypes.range
		},
		{
			key: "durability",
			type: VariableTypes.range
		},
		{
			key: "enchantments",
			type: enchantmentsPredicate()
		},
		{
			key: "stored_enchantments",
			type: ValueTypeObject.listOf(createJsonParser('Enchantment',[
				{
					key: "id",
					path: ["enchantment"],
					type: ValueTypeObject.token(TokenType.identifier,...Registry.enchantments.keys()).withCustomLabel('EnchantmentId')
				},
				{
					key: "levels",
					type: VariableTypes.range
				}
			]))
		},
		{
			key: "id",
			path: ["item"],
			type: ValueTypeObject.token(TokenType.identifier,...Registry.items.keys()).withCustomLabel('ItemId')
		},
		{
			key: "nbt",
			type: VariableTypes.string
		},
		{
			key: "potion",
			type: ValueTypeObject.token(TokenType.identifier,...Registry.potions).withCustomLabel('PotionId')
		},
		{
			key: "tag",
			type: VariableTypes.string
		}
	])
}

function entityPredicate() {
	return createJsonParser('EntityPredicate',[
		{
			key: "distance",
			type: distancePredicate()
		},
		{
			key: "effects",
			type: createJsonParser('EffectListPredicate',entityEffects.map(e=>({
				key: e,
				type: createJsonParser('Effect',[
					{
						key: "amplifier",
						type: VariableTypes.range
					},
					{
						key: "duration",
						type: VariableTypes.range
					}
				])
			})))
		},
		{
			key: "equipment",
			type: createJsonParser('Equipment',Object.keys(entityEquipmentSlots).map(s=>({
				key: s,
				type: itemPredicate()
			})))
		},
		{
			key: "on_fire",
			path: ["flags","is_on_fire"],
			type: VariableTypes.boolean
		},
		{
			key: "sneaking",
			path: ["flags","is_sneaking"],
			type: VariableTypes.boolean
		},
		{
			key: "sprinting",
			path: ["flags","is_sprinting"],
			type: VariableTypes.boolean
		},
		{
			key: "swimming",
			path: ["flags","is_swimming"],
			type: VariableTypes.boolean
		},
		{
			key: "baby",
			path: ["flags","is_baby"],
			type: VariableTypes.boolean
		},
		{
			key: "location",
			type: locationPredicate()
		},
		{
			key: "nbt",
			type: VariableTypes.string
		},
		{
			key: "player",
			type: createJsonParser('PlayerProperties',[
				{
					key: "advancements",
					type: VariableTypes.nbt // TODO: change
				},
				{
					key: "gamemode",
					type: ValueTypeObject.token(TokenType.identifier, 'survival','creative','adventure','spectator').withCustomLabel('GameMode')
				},
				{
					key: "level",
					type: VariableTypes.range
				},
				{
					key: "stats",
					type: ValueTypeObject.listOf(createJsonParser('Statistic',[
						{
							key: "type",
							type: VariableTypes.string
						},
						{
							key: "stat",
							type: VariableTypes.string
						},
						{
							key: "value",
							type: VariableTypes.range
						}
					]))
				}
			])
		},
		{
			key: "team",
			type: VariableTypes.team
		},
		{
			key: "type",
			type: ValueTypeObject.token(TokenType.identifier,...Registry.entities.keys()).withCustomLabel('EntityType')
		}
	])
}

function damageTypePredicate() {
	return createJsonParser('DamageType',[
		{
			key: "bypasses_armor",
			type: VariableTypes.boolean
		},
		{
			key: "bypasses_invulnerability",
			type: VariableTypes.boolean
		},
		{
			key: "bypasses_magic",
			type: VariableTypes.boolean
		},
		{
			key: "direct_entity",
			type: entityPredicate()
		},
		{
			key: "explosion",
			path: ["is_explosion"],
			type: VariableTypes.boolean
		},
		{
			key: "fire",
			path: ["is_fire"],
			type: VariableTypes.boolean
		},
		{
			key: "magic",
			path: ["is_magic"],
			type: VariableTypes.boolean
		},
		{
			key: "projectile",
			path: ["is_projectile"],
			type: VariableTypes.boolean
		},
		{
			key: "lightning",
			path: ["is_lightning"],
			type: VariableTypes.boolean
		},
		{
			key: "source_entity",
			type: entityPredicate()
		}
	])
}

function getPredicateTypes(): {[id: string]: PredicateType} {
	if (_predicateTypes) return _predicateTypes;
	return _predicateTypes = {
		block_state: {
			realKey: "block_state_property",
			params: [
				{
					key: "state",
					type: VariableTypes.blockstate,
					toJson: (b: Block)=>({block: b.id, properties: b.state}),
					mergeResult: true
				}
			]
		},
		damage_source: {
			realKey: "damage_source_properties",
			params: [
				{
					key: "predicate",
					type: damageTypePredicate()
				}
			]
		},
		entity_properties: {
			params: [
				{
					key: "entity",
					type: ValueTypeObject.token(TokenType.identifier,'this','killer','killer_player')
				},
				{
					key: "predicate",
					type: entityPredicate()
				}
			]
		},
		scores: {
			realKey: "entity_scores",
			params: [
				{
					key: "entity",
					type: ValueTypeObject.token(TokenType.identifier,'this','killer','killer_player')
				},
				{
					key: "scores",
					type: ValueTypeObject.listOf(ValueTypeObject.custom('ScoreCheck',t=>{
						let obj = t.expectVariable(VariableTypes.objective);
						let comp = parseRangeComparison(t,VariableTypes.integer);
						return {score: obj, value: comp}
					})),
					toJson: (v,e)=>{
						let res = {};
						for (let s of v) {
							res[s.score] = e.valueOf(s.value)
						}
					}
				}
			]
		},
		killed_by_player: {
			params: [
				{
					key: "inverted",
					type: VariableTypes.boolean
				}
			]
		},
		location: {
			realKey: "location_check",
			params: [
				{
					key: "predicate",
					type: locationPredicate()
				},
				{
					key: "offsetX",
					type: VariableTypes.integer
				},
				{
					key: "offsetY",
					type: VariableTypes.integer
				},
				{
					key: "offsetZ",
					type: VariableTypes.integer
				}
			]
		},
		tool: {
			realKey: "match_tool",
			params: [
				{
					key: "predicate",
					type: itemPredicate()
				}
			]
		},
		random: {
			realKey: "random_chance",
			params: [
				{
					key: "chance",
					type: VariableTypes.double
				}
			]
		},
		random_with_looting: {
			realKey: "random_chance_with_looting",
			params: [
				{
					key: "chance",
					type: VariableTypes.double
				},
				{
					key: "looting_multiplier",
					type: VariableTypes.double
				}
			]
		},
		chance_table: {
			realKey: "table_bonus",
			params: [
				{
					key: "enchantment",
					type: ValueTypeObject.token(TokenType.identifier,...Registry.enchantments.keys()).withCustomLabel('EnchantmentId')
				},
				{
					key: "chances",
					type: ValueTypeObject.listOf(VariableTypes.double)
				}
			]
		},
		time: {
			realKey: "time_check",
			params: [
				{
					key: "value",
					type: VariableTypes.range
				},
				{
					key: "period",
					type: VariableTypes.integer
				}
			]
		},
		enchantments: {
			realKey: "tool_enchantments",
			params: [
				{
					key: "enchantments",
					type: enchantmentsPredicate()
				}
			]
		},
		weather: {
			realKey: "weather_check",
			params: [
				{
					key: "checks",
					type: createJsonParser('WeatherProps',[
						{
							key: "raining",
							type: VariableTypes.boolean
						},
						{
							key: "thundering",
							type: VariableTypes.boolean
						}
					]),
					mergeResult: true
				}
			]
		}
	}
}

function createJsonParser(label: string, props: JsonProperty[]): ValueTypeObject {
	return ValueTypeObject.custom(label,t=>{
		return praseJson(t,new JsonContext(props))
	})
}

export function parsePredicateNode(t: TokenIterator): Lazy<Predicate> {
	let id = t.expectType(TokenType.identifier,()=>Object.keys(getPredicateTypes()));
	let pred = getPredicateTypes()[id.value];
	if (pred && t.expectValue('(')) {
		let signatureHelp = t.ctx.editor.createSignatureHelp(id.value,[{desc: "",params: pred.params.map(getSignatureFromParam)}])
		let res = parseMethod(t,pred.params,signatureHelp);
		t.expectValue(')');
		return e=>{
			let finalRes = {};
			if (pred.params.length == 1) {
				putPredicateParam(finalRes,pred.params[0],res,e);
			} else {
				for (let p of pred.params) {
					let v = res[p.key];
					if (v !== undefined) {
						putPredicateParam(finalRes,p,v,e);
					}
				}
			}
			return {value: {id: pred.realKey || id.value, data: finalRes}, type: VariableTypes.predicate};
		}
	}
}

function putPredicateParam(data: any, param: PredicateProperty, value: any, e: Evaluator) {
	let v = e.valueOf(value);
	if (param.toJson) {
		v = param.toJson(v,e,data);
	}
	if (param.mergeResult) {
		for (let k in v) {
			data[k] = v[k];
		}
	} else {
		data[param.realKey || param.key] = v;
	}
}

export function flattenPredicate(pred: Predicate) {
	if (isArray(pred)) return pred;
	return {condition: pred, ...pred.data}
}

export type Predicate = Predicate[] | {id: string, data: any}

export class PredicateItem extends DatapackItem {

	constructor(private data: Predicate, loc: ResourceLocation) {
		super(loc)
	}

	save(dir: string): void {

	}
	dirName: string = 'predicates'

}