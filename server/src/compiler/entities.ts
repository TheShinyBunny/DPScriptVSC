import { VariableTypes, readRomanNumber, parseIdentifierOrVariable, parseDuration } from './util';
import { TokenIterator, TokenType, Token, Tokens } from './tokenizer';
import { Lazy, parseSingleValue } from './parser';

export const entityEffects = [
	"speed",
	"slowness",
	"haste",
	"mining_fatigue",
	"strength",
	"instant_health",
	"instant_damage",
	"jump_boost",
	"nausea",
	"regeneration",
	"resistance",
	"fire_resistance",
	"water_breathing",
	"invisibility",
	"blindness",
	"night_vision",
	"hunger",
	"weakness",
	"poison",
	"wither",
	"health_boost",
	"absorption",
	"saturation",
	"glowing",
	"levitation",
	"luck",
	"bad_luck",
	"slow_falling",
	"conduit_power",
	"dolphins_grace",
	"bad_omen",
	"hero_of_the_village"
]

export interface TieredEffect {
	id: string
	tier?: number
}

export function parseTieredEffect(t: TokenIterator): Lazy<TieredEffect> {
	t.suggestHere(...entityEffects);
	let effectId = parseIdentifierOrVariable(t);
	if (!effectId) return;
	let tier = undefined;
	if (!t.isNext(',',')',']','for','hide')) {
		tier = parseRomanOrInt(t);
	}
	return e=>{
		let effect = e.valueOf(effectId.value,'speed');
		if (entityEffects.indexOf(effect) < 0) {
			e.error(effectId.range,"Unknown effect ID " + effect);
		}
		let t = e.valueOf(tier);
		return {value: {id: effect, tier: t},type: VariableTypes.tieredEffect}
	};
}

export interface Effect {
	id: TieredEffect
	duration?: number
	hide?: boolean
}

export function parseEffect(t: TokenIterator): Lazy<Effect> {
	let id = parseTieredEffect(t);
	if (!id) return
	t.suggestHere('for','hide');
	let duration: Lazy<number> = undefined;
	let hide = false;
	if (t.skip('for')) {
		duration = parseDuration(t);
	}
	t.suggestHere('hide');
	if (t.skip('hide')) {
		hide = true;
	}
	return e=>{
		let effect: Effect = {
			id: e.valueOf(id),
			duration: e.valueOf(duration),
			hide: hide
		}
		return {value: effect, type: VariableTypes.effect}
	}
}

function parseRomanOrInt(t: TokenIterator) {
	if (t.isTypeNext(TokenType.identifier)) {
		let tier = readRomanNumber(t.next().value);
		if (tier) {
			return Lazy.literal(tier - 1,VariableTypes.integer);
		}
		t.error(t.lastPos,"Invalid roman number");
		return undefined;
	}
	return parseSingleValue(t,VariableTypes.integer);
}

const enchantments: {[id: string]: number} = {
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
}

export function parseEnchantment(t: TokenIterator, checkTier?: boolean): Lazy<TieredEnchantment> {
	t.suggestHere(...Object.keys(enchantments).map(k=>({value: k, detail: "Max Level: " + enchantments[k]})));
	let id = parseIdentifierOrVariable(t);
	let trange = t.startRange();
	let tier = parseRomanOrInt(t);
	t.endRange(trange);
	return e=>{
		let idv = e.valueOf(id.value,'protection');
		if (idv) {
			let max = enchantments[idv];
			let tv = e.valueOf(tier);
			if (max === undefined) {
				e.error(id.range,"Unknown enchantment '" + idv + "'");
			} else if (checkTier && tv > max) {
				e.warn(trange,"The maximum level of " + idv + " is " + max);
			}
			return {value: {id: idv, lvl: tv},type: VariableTypes.enchantment};
		}
	}
}

export interface TieredEnchantment {
	id: string
	lvl?: number
}

export const mobAttributes = [
	"max_health",
	"follow_range",
	"knockback_resistance",
	"movement_speed",
	"attack_damage",
	"armor",
	"armor_toughness",
	"attack_knockback"
]

export const playerAttributes = [
	"attack_speed",
	"luck"
]

export const horseAttributes = [
	"jump_strength"
]

export const parrotAttributes = [
	"flying_speed"
]

export const zombieAttributes = [
	"spawn_reinforcements"
]

export const allAttributes = [
	...mobAttributes,
	...playerAttributes,
	...horseAttributes,
	...parrotAttributes,
	...zombieAttributes
]

export function getVanillaAttributeId(attr: string): string {
	if (horseAttributes.indexOf(attr) >= 0) return 'horse.' + attr;
	if (zombieAttributes.indexOf(attr) >= 0) return 'zombie.' + attr;
	return 'generic.' + attr;
}

export const entityEquipmentSlots = {
	offhand: 'weapon.offhand',
	mainhand: 'weapon.mainhand',
	chest: 'armor.chest',
	head: 'armor.head',
	legs: 'armor.legs',
	feet: 'armor.feet',
	horse_armor: 'horse.armor',
	saddle: 'horse.saddle',
	donkey_chest: 'horse.chest'
}