import { ValueParser, Parsers } from './parsers';
import { TokenIterator } from '../tokenizer';
import { Registry } from '../registries';
import { parseIdentifierOrVariable, parseRomanOrInt } from '../util';
import { Lazy, UntypedLazy } from '../parser';
import { LazyCompoundEntry } from '../data_structs'
import { NBTPathContext } from '../nbt';

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
		console.log('parsing effect ' + effectId.literal + ' with ctx',ctx);
		let tier: Lazy<number> = undefined;
		let duration: LazyCompoundEntry<number> = undefined;
		let hide = false;
		if (ctx.tier) {
			if (!t.isNext(',',')',']','for','hide')) {
				tier = parseRomanOrInt(t);
			}
		}
		if (ctx.full) {
			t.suggestHere('for','hide');
			if (t.skip('for')) {
				duration = Parsers.duration.parse(t)
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
		if (value.has_tier || value.full) {
			if (value.full) {
				return {Id: Registry.effects.indexOf(value.id), Amplifier: value.tier || 0, Duration: value.duration, ShowParticles: !value.hide}
			}
			return value;
		}
		return value.id;
	}

	getLabel(data: {tier?: boolean; full?: boolean}) {
		return data.tier ? 'tiered_effect' : data.full ? 'effect' : 'effect_id'
	}

	toString(value: Effect) {
		return value.id
	}

	createPathContext(data: any): NBTPathContext {
		if (data.full) {
			return new NBTPathContext({
				Id: {
					type: "int"
				},
				Duration: {
					type: "int"
				},
				Amplifier: {
					type: "int"
				},
				ShowParticles: {
					type: "bool"
				}
			})
		}
		return super.createPathContext(data);
	}
	
}