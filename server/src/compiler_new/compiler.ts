
import { Parser } from './parser';
import { DatapackBuilder, DPScriptFile, MCFunction } from './project';
import { Token, Tokenizer } from './tokenizer';
import { currentProject } from '../server'
import { GlobalStatement } from './ast';
import { ProcessContext } from './process';
import { GenContext } from './generate';
import { ResourceLocation } from './utils';

export class DPScript {
	
	
	partOf: string
	global: GlobalStatement[] = []

	constructor(public name: string, public uri: string) {

	}

	get namespace(): string {
		return this.partOf || this.name
	}

	process(p: ProcessContext) {
		console.log('Processing script ',this.name)
		try {
			for (let g of this.global) {
				g.process(p)
			}
		} catch (e) {
			console.log('An error occurred while processing ' + this.uri,e)
		}
	}

	generate(builder: DatapackBuilder) {
		let ctx = new GenContext(this,builder)
		for (let g of this.global) {
			g.generate(ctx)
		}
		let loadFunc: MCFunction = builder.findEntry(ResourceLocation.from('init'),e=>e instanceof MCFunction)
		if (!loadFunc) {
			loadFunc = new MCFunction(this,'init')
			builder.entries.push(loadFunc)
			ctx.builder.getTag('minecraft:load','functions').add(loadFunc.id)
		}
		loadFunc.commands.push(...ctx.loadCommands)
	}
}

export function compileScript(file: DPScriptFile): DPScript {
	let tokenizer = new Tokenizer(file.text);
	let parser = new Parser(tokenizer,file,currentProject);
	return parser.parseFile();
}

