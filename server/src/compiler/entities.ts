import { VariableTypes, readRomanNumber, parseIdentifierOrVariable, parseDuration } from './util';
import { TokenIterator, TokenType, Token, Tokens } from './tokenizer';
import { Lazy, parseSingleValue } from './parser';
import { Registry } from './registries';


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
}

export const allEquipmentSlots = {
	...entityEquipmentSlots,
	horse_armor: 'horse.armor',
	saddle: 'horse.saddle',
	donkey_chest: 'horse.chest'
}