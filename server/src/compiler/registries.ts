
import * as entityReg from './registries/entities.json';
import * as itemReg from './registries/items.json';
import * as tileEntityReg from './registries/tile_entities.json';
import * as blockReg from './registries/blocks.json';
import { resolveNBTRegistry, NBTRegistry } from './nbt';
import { isArray } from 'util';

export interface Registry<T> {
	get(id: string): T
	keys(): string[]
	values(): T[]
	entries(): {key: string, value: T}[]
}

export class BasicRegistry<T> implements Registry<T> {
	constructor(private items: {[id: string]: T}) {}
	entries(): { key: string; value: T; }[] {
		return this.keys().map(k=>({key: k, value: this.get(k)}))
	}

	get(id: string): T {
		return this.items[id];
	}
	keys(): string[] {
		return Object.keys(this.items)
	}
	values(): T[] {
		return this.keys().map(k=>this.get(k));
	}
	
}

export namespace Registry {

	export function getNBTRegistry(name: string): NBTRegistry {
		if (['items','entities','tile_entities'].indexOf(name) >= 0) {
			return Registry[name];
		}
	}

	export function getKeys(name: string): string[] {
		let v = Registry[name];
		if (typeof v != 'function') {
			if (isArray(v)) return v;
			return (<Registry<any>>v).keys()
		}
	} 

	export const items = resolveNBTRegistry('item',itemReg);
	export const entities = resolveNBTRegistry('entity',entityReg);
	export const tile_entities = resolveNBTRegistry('tile_entity',tileEntityReg);

	

	export const potions = [
		"empty",
		"water",
		"mundane",
		"thick",
		"awkward",
		"night_vision",
		"long_night_vision",
		"invisibility",
		"long_invisibility",
		"leaping",
		"strong_leaping",
		"long_leaping",
		"fire_resistance",
		"long_fire_resistance",
		"swiftness",
		"strong_swiftness",
		"long_swiftness",
		"slowness",
		"strong_slowness",
		"long_slowness",
		"water_breathing",
		"long_water_breathing",
		"healing",
		"strong_healing",
		"harming",
		"strong_harming",
		"poison",
		"strong_poison",
		"long_poison",
		"regeneration",
		"strong_regeneration",
		"long_regeneration",
		"strength",
		"strong_strength",
		"long_strength",
		"weakness",
		"long_weakness",
		"luck",
		"turtle_master",
		"strong_turtle_master",
		"long_turtle_master",
		"slow_falling",
		"long_slow_falling"
	]

	export const biomes = ["badlands", "badlands_plateau", "beach", "birch_forest", "birch_forest_hills", "cold_ocean", "dark_forest", "dark_forest_hills", "deep_cold_ocean", "deep_frozen_ocean", "deep_lukewarm_ocean", "deep_ocean", "deep_warm_ocean", "desert", "desert_hills", "desert_lakes", "end_barrens", "end_highlands", "end_midlands", "eroded_badlands", "flower_forest", "forest", "frozen_ocean", "frozen_river", "giant_spruce_taiga", "giant_spruce_taiga_hills", "giant_tree_taiga", "giant_tree_taiga_hills", "gravelly_mountains", "ice_spikes", "jungle", "jungle_edge", "jungle_hills", "lukewarm_ocean", "modified_badlands_plateau", "modified_gravelly_mountains", "modified_jungle", "modified_jungle_edge", "modified_wooded_badlands_plateau", "mountain_edge", "mountains", "mushroom_field_shore", "mushroom_fields", "nether_wastes", "crimson_forest", "warped_forest", "soul_sand_valley", "basalt_deltas", "ocean", "plains", "river", "savanna", "savanna_plateau", "shattered_savanna", "shattered_savanna_plateau", "small_end_islands", "snowy_beach", "snowy_mountains", "snowy_taiga", "snowy_taiga_hills", "snowy_taiga_mountains", "snowy_tundra", "stone_shore", "sunflower_plains", "swamp", "swamp_hills", "taiga", "taiga_hills", "taiga_mountains", "tall_birch_forest", "tall_birch_hills", "the_end", "the_void", "warm_ocean", "wooded_badlands_plateau", "wooded_hills", "wooded_mountains"]

	export const blocks = blockReg;

	export const fluids = ["empty","flowing_water","water","flowing_lava","lava"]

	export const structures = ["buried_treasure", "desert_pyramid", "endcity", "fortress", "igloo", "jungle_pyramid", "mansion", "mineshaft", "monument", "ocean_ruin", "pillager_outpost", "shipwreck", "stronghold", "swamp_hut", "village"]

	export const enchantments = new BasicRegistry<number>({
		aqua_affinity: 1,
		bane_of_arthropods: 5,
		blast_protection: 4,
		channeling: 1,
		binding_curse: 1,
		vanishing_curse: 1,
		depth_strider: 3,
		efficiency: 5,
		feather_falling: 4,
		fire_aspect: 2,
		fire_protection: 4,
		flame: 1,
		fortune: 3,
		frost_walker: 2,
		impaling: 5,
		infinity: 1,
		knockback: 2,
		looting: 3,
		loyalty: 3,
		luck_of_the_sea: 3,
		lure: 3,
		mending: 1,
		multishot: 1,
		piercing: 4,
		power: 5,
		projectile_protection: 4,
		protection: 4,
		punch: 2,
		quick_charge: 3,
		respiration: 3,
		riptide: 3,
		sharpness: 5,
		silk_touch: 1,
		smite: 5,
		soul_speed: 3,
		sweeping: 3,
		thorns: 3,
		unbreaking: 3
	})
}