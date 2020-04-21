import { VariableTypes, readRomanNumber, parseIdentifierOrVariable, parseDuration } from './util';
import { TokenIterator, TokenType, Token, Tokens } from './tokenizer';
import { Lazy, parseExpression, parseSingleValue } from './parser';

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
	let effectRange = {...t.nextPos};
	let effectId: Lazy<string> | Token = parseIdentifierOrVariable(t,VariableTypes.string);
	if (!effectId) return;
	let finalEffectId: Lazy<string> = Tokens.lazify(effectId);
	t.endRange(effectRange);
	let tier = undefined;
	if (!t.isNext(',',')')) {
		tier = parseEffectTier(t);
	}
	return e=>{
		let effect = e.valueOf(finalEffectId);
		if (entityEffects.indexOf(effect) < 0) {
			e.error(effectRange,"Unknown effect ID " + effect);
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
		duration = parseDuration(t,true);
		t.suggestHere('hide');
	}
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

function parseEffectTier(t: TokenIterator) {
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