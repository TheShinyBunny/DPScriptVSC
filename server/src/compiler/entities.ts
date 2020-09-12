import { ClassDefinition, Property, ParameterList } from './oop'
import { Registry } from './registries'
import { EOF, INVALID_POS, TokenType, Tokens } from './tokenizer'
import { CompilationContext, DPScript } from './compiler'
import { Files } from '.'
import { toTitleCase, VariableType, VariableTypes } from './util'
import { CompoundItem, DataProperty } from './data_structs'
import { Parsers, ValueParser } from './parsers/parsers'
import { Lazy } from './parser'


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

export function createEntityClasses(file: DPScript): ClassDefinition[] {
	let cls: ClassDefinition[] = [];
	let dummyCtx = new CompilationContext(Files.dir(''),file.editor,file);
	for (let e of Registry.entities.values()) {
		let c = new ClassDefinition({range: INVALID_POS,type: TokenType.identifier,value: toTitleCase(e.key)},dummyCtx);
		c.ctor = new ParameterList([]);
		c.abstract = e.abstract;
		c.entity = e
		for (let ext of e.extends) {
			if (ext.mixin) {
				addNBTProps(c,ext.allProperties());
			} else {
				c.extends = {type: TokenType.identifier, value: toTitleCase(ext.key), range: INVALID_POS}
			}
		}
		if (e.extends.length == 0) {
			addNBTProps(c,Registry.entities.base.allProperties());
		}
		addNBTProps(c,e.tags);
		cls.push(c);
	}
	return cls;
}

function addNBTProps(cls: ClassDefinition, tags: CompoundItem<DataProperty>) {
	for (let k of Object.keys(tags)) {
		let p = createNBTProperty(cls,k,tags[k]);
		if (!cls.properties.find(pr=>pr.name == p.name)) {
			cls.properties.push(p);
		}
	}
}

function createNBTProperty(cls: ClassDefinition, key: string, prop: DataProperty): Property {
	let parser: ValueParser<any> = Parsers[prop.type];
	let type: VariableType<any>;
	if (parser) {
		type = {
			name: parser.getLabel(prop.context || {}),
			defaultValue: undefined,
			isPrimitive: false,
			stringify: (v,e)=>parser.toString(v,e,{})
		}
		type.parser = (t)=>{
			let v = parser.parse(t,prop.context || {});
			return e=>{
				return {value: e.valueOf(v),type};
			}
		};
	} else {
		console.log('unknown parser ' + prop.type)
		type = VariableTypes.any
	}
	return {
		containingClass: cls,
		name: key,
		type: {range: INVALID_POS,base: type},
		declaration: {name: INVALID_POS,uri: ""},
		desc: prop.desc
	}
}