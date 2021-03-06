import { compileScript, DPScript } from './compiler';
import { FileUtil } from './files';
import { Token } from './tokenizer';
import { Diagnostic, Hover, MarkedString, MarkupContent, Position, Range } from 'vscode-languageserver';
import { ResourceLocation } from './utils';
import { Suggestion } from './parser';
import { rangeContains } from '../server';
import { URI, uriToFsPath } from 'vscode-uri';
import * as fs from 'fs'
import * as path from 'path'
import * as fsExtra from 'fs-extra'

export class Datapack {
	
	
	meta: PackMCMeta = {description: "A DPScript generated Datapack",version: 6}
	private minecraft: DPScript
	files: DPScriptFile[] = []

	constructor(public uri: string, public name: string) {

	}

	getMinecraft(): DPScript {
		if (!this.minecraft) {
			this.minecraft = new DPScript('minecraft',undefined);
		}
		return this.minecraft;
	}

	generate() {
		let dir = uriToFsPath(URI.parse(this.uri),false)
		let main = FileUtil.subDir(dir,'generated/' + this.name)
		fsExtra.emptyDirSync(main)
		let meta = path.resolve(main,'pack.mcmeta')
		fs.writeFileSync(meta,JSON.stringify({pack: {pack_format: this.meta.version,description: this.meta.description}},undefined,4))
		let data = FileUtil.subDir(main,'data')
		let builder = new DatapackBuilder(this)
		for (let f of this.files) {
			if (!f.ast) {
				f.ast = f.compile()
			}
			console.log('generating script',f.uri)
			f.ast.generate(builder)
		}
		
		for (let e of builder.entries) {
			console.log('writing entry',e.directory,e.id.path)
			let ns = FileUtil.subDir(data,e.id.namespace)
			let dir = FileUtil.subDir(ns,e.directory)
			let content = e.generate()
			if (e.id.path.includes('/')) {
				let li = e.id.path.lastIndexOf('/')
				let subp = FileUtil.subDir(dir,e.id.path.substring(0,li))
				fs.writeFileSync(path.resolve(subp,e.id.path.substring(li+1) + '.' + e.extension),content)
			} else {
				fs.writeFileSync(path.resolve(dir,e.id.path + '.' + e.extension),content)
			}
		}
	}

}

export interface PackMCMeta {
	version: number
	description: string
	logo?: string
}

export class DatapackBuilder {
	
	entries: DatapackEntry[] = []
	objectives: string[] = []

	constructor(public project: Datapack) {

	}

	getTag(id: string, type: string, replace: boolean = false): Tag {
		let loc = ResourceLocation.from(id)
		let entry = this.findEntry<Tag>(loc,d=>d instanceof Tag)
		if (!entry) {
			entry = new Tag(loc.namespace,type,loc.path,replace)
			this.entries.push(entry)
		}
		return entry
	}

	findEntry<T extends DatapackEntry>(id: ResourceLocation,filter: (e: T)=>boolean): T {
		for (let e of this.entries) {
			if (e.id.equals(id) && filter(e as T)) {
				return e as T;
			}
		}
	}
}

export interface DatapackEntry {
	directory: string
	extension: string
	id: ResourceLocation
	generate: ()=>string
}

export class DPScriptFile {

	diagnostics: Diagnostic[] = []
	exports: Exportable[] = []
	cursorPos: Position
	suggestions: Suggestion[] = []
	hovers: Hover[] = []
	ast: DPScript

	constructor(public uri: string, public text: string) {

	}

	get name(): string {
		return FileUtil.getNameUri(this.uri,false);
	}

	compile(): DPScript {
		try {
			return compileScript(this);
		} catch (e) {
			console.log('An error occurred while compiling ' + this.uri,e)
		}
	}

	export(exp: Exportable) {
		this.exports.push(exp);
	}

	addSuggestions(range: Range, ...suggestions: Suggestion[]) {
		if (this.cursorPos && rangeContains(range,this.cursorPos)) {
			this.suggestions.push(...suggestions);
		}
	}

	setHover(range: Range, hover: MarkupContent | MarkedString | MarkedString[]) {
		this.hovers.push({range,contents: hover})
	}
}

export class MCFunction implements DatapackEntry {
	
	directory = 'functions'
	extension = 'mcfunction'
	commands: string[] = []
	id = new ResourceLocation(this.script.namespace,this.name)
	
	constructor(public script: DPScript, public name: string) {
		
	}
	
	generate(): string {
		return this.commands.join('\n')
	}
}

export class Tag implements DatapackEntry {

	entries: ResourceLocation[] = []
	directory = 'tags/' + this.type
	extension = 'json'
	id = new ResourceLocation(this.namespace,this.name)

	constructor(private namespace: string, public type: string, public name: string, public replace: boolean = false) {

	}
	
	generate(): string {
		let json = {
			values: this.entries.map(e=>e.toString()),
			replace: this.replace
		}
		return JSON.stringify(json,undefined,4);
	}

	add(entry: ResourceLocation) {
		this.entries.push(entry)
	}
}

export interface Exportable {
	name: Token
	type: ExportableType
}

export enum ExportableType {
	function,
	predicate,
	tag,
	objective,
	global
}