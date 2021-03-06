import { NBTPropertyCompound, NBTRegistryType } from '../types/nbt'
import * as items from '../data/items.json'
import * as tileEntities from '../data/tile_entities.json'
import * as globalTemplates from '../data/shared_templates.json'
import { ValueType } from '../types/types'

const registries: {[key: string]: Registry<any>} = {}

export class Registry<T> {
	constructor(public name: string, public entries: {[key: string]: T}) {
		registries[name] = this
	}

	has(id: string) {
		return this.entries[id] !== undefined
	}

	keys() {
		return Object.keys(this.entries)
	}

	register(key: string, value: T) {
		if (this.entries[key]) {
			console.warn('Duplicate registry entry ' + this.name + ":" + key)
		} else {
			this.entries[key] = value
		}
	}
}

export class NBTRegistry extends Registry<NBTPropertyCompound> {

	base: NBTPropertyCompound
	all: NBTPropertyCompound
	constructor(name: string) {
		super(name,{})
	}
}

export namespace Registry {

	export function getKeys(reg: string): string[] {
		let r = registries[reg]
		return r ? r.keys() : []
	}

	export const blocks = new Registry("blocks",{
		stone: {},
		oak_planks: {}
	})

	export const itemTags = new Registry("item_tags",{
		some_tag: {}
	})
	export const items = new NBTRegistry("items")
	export const tileEntities = new NBTRegistry("tile_entities")
	export const entities = new NBTRegistry("entities")

	export function getNBTRegistry(type: NBTRegistryType) {
		if (type == 'item') return items
		if (type == 'tile_entity') return tileEntities
		if (type == 'entity') return entities
	}
}

export function initRegistries() {
	let globals = buildTemplates(globalTemplates.templates,'shared_templates',{})
	buildNBTRegistry(items, Registry.items,globals)
	buildNBTRegistry(tileEntities,Registry.tileEntities,globals)
}

export interface NBTRegistryDefinition {
	base: NBTPropertyCompound
	templates: {
		[key: string]: NBTRegistryEntry
	}
	values: {
		[key: string]: NBTRegistryEntry
	}
}

export interface NBTRegistryEntry {
	include?: string[]
	tags?: NBTPropertyCompound
}

function buildTemplates(templates: {[key: string]: NBTRegistryEntry}, registryName: string, globals: {[key: string]: NBTPropertyCompound}) {
	let validTemplates: {[key: string]: NBTPropertyCompound} = {}
	for (let k in templates) {
		let t = templates[k];
		validTemplates[k] = validateEntry(t,registryName + ".templates:" + k)
	}
	let resolvedTemplates: {[key: string]: NBTPropertyCompound} = {...globals}
	for (let k in templates) {
		let t = templates[k];
		resolveTemplate(validTemplates[k],registryName,k,templates,t.include,validTemplates,resolvedTemplates,[k])
	}
	return resolvedTemplates
}

function buildNBTRegistry(def: NBTRegistryDefinition, registry: NBTRegistry, globals: {[key: string]: NBTPropertyCompound}) {
	let resolvedTemplates = buildTemplates(def.templates,registry.name,globals)
	registry.base = validateEntry({tags: def.base},registry.name + ':base')
	let all: NBTPropertyCompound = {}
	for (let k in def.values) {
		let v = def.values[k]
		let tags: NBTPropertyCompound = {...def.base}
		if (v.include) {
			for (let i of v.include) {
				let temp = resolvedTemplates[i]
				if (temp) {
					tags = {...tags,...temp}
				} else {
					console.warn("Template include reference '" + i + "' not found in " + registry.name + ":" + k)
				}
			}
		}
		tags = combineChecked(tags, 'entry ' + k,validateEntry(v,registry.name + ":" + k))
		registry.register(k,tags)
		all = {...all, ...tags}
	}
	registry.all = all
}

function validateEntry(entry: NBTRegistryEntry, name: string): NBTPropertyCompound {
	let valid: NBTPropertyCompound = {}
	if (entry.tags) {
		for (let k in entry.tags) {
			let p = entry.tags[k]
			let type = ValueType.get(p.type)
			if (!type) {
				console.warn("Unknown property type '" + p.type + "' in " + name + '.' + k)
				continue
			}
			if (p.config) {
				let invalidCtx = type.validateConfig(p.config)
				if (invalidCtx) {
					console.warn("Invalid config for " + p.type + " property in " + name + '.' + k + " =>> " + invalidCtx)
					continue
				}
			}
			valid[k] = p
		}
	}
	return valid
}

function resolveTemplate(template: NBTPropertyCompound, registryName: string, name: string, allTemplates: {[key: string]: NBTRegistryEntry}, include: string[],templates: {[key: string]: NBTPropertyCompound}, resolved: {[key: string]: NBTPropertyCompound}, stack: string[]) {
	let props: NBTPropertyCompound = {...template}
	if (include) {
		for (let i of include) {
			if (stack.indexOf(i) >= 0) {
				console.warn("Recursive include reference in " + registryName + ":" + name + " > " + i)
			}
			if (!resolved[i]) {
				if (templates[i]) {
					resolveTemplate(templates[i],registryName,i,allTemplates,allTemplates[i].include,templates,resolved,[...stack,i])
				} else {
					console.warn("Template include reference '" + i + "' not found in template " + registryName + ":" + name)
					continue
				}
			}
			if (resolved[i]) {
				props = combineChecked(props,'template ' + name,resolved[i])
			}
		}
	}
	resolved[name] = props
}

function combineChecked(first: NBTPropertyCompound, firstName: string, second: NBTPropertyCompound) {
	let res: NBTPropertyCompound = {...first}
	for (let k in second) {
		if (res[k]) {
			console.warn("Duplicate property found: " + firstName + "." + k)
		} else {
			res[k] = second[k]
		}
	}
	return res;
}