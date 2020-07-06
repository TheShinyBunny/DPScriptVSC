import { ValueParser, ParsingContext } from './parsers';
import { TokenIterator } from '../tokenizer';
import { Registry } from '../registries';
import { parseIdentifierOrVariable, parseRomanOrInt, VariableTypes, parseDuration } from '../util';
import { Lazy, UntypedLazy } from '../parser';
import { LazyCompoundEntry } from '../data_structs'

export interface Effect {
	id: string
	tier?: number
	duration?: number
	hide?: boolean
	has_tier?: boolean
	full?: boolean
}

export class EffectParser extends ValueParser<Effect,{tier?: boolean, full?: boolean}> {
	id: string = 'effect'
	parse(t: TokenIterator, ctx: { tier?: boolean; full?: boolean}): LazyCompoundEntry<Effect> {
		t.suggestHere(...Registry.effects);
		let effectId = parseIdentifierOrVariable(t);
		if (!effectId) return;
		let tier: Lazy<number> = undefined;
		let duration: Lazy<number> = undefined;
		let hide = false;
		if (ctx.tier) {
			if (!t.isNext(',',')',']','for','hide')) {
				tier = parseRomanOrInt(t);
			}
		}
		if (ctx.full) {
			t.suggestHere('for','hide');
			if (t.skip('for')) {
				duration = parseDuration(t);
			}
			if (duration) {
				t.suggestHere('hide');
			}
			if (t.skip('hide')) {
				hide = true;
			}
		}
		return e=>{
			let idRes = e.valueOf(effectId.value,'speed');
			if (Registry.effects.indexOf(idRes) < 0) {
				e.error(effectId.range,"Unknown effect ID " + idRes);
			}
			return {
				id: idRes,
				duration: e.valueOf(duration),
				hide: hide,
				tier: e.valueOf(tier),
				full: ctx.full,
				has_tier: ctx.tier
			}
		}
	}
	
	toCompoundData(value: Effect) {
		if (value.has_tier) {
			if (value.full) {
				return {Id: Registry.effects.indexOf(value.id), Amplifier: value.tier || 0, Duration: value.duration, ShowParticles: !value.hide}
			}
			return value;
		}
		return value.id;
	}

	toString(value: Effect) {
		return value.id
	}
	
}