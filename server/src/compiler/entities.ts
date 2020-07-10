

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