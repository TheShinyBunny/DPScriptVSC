import { ValueParser, Parsers } from './parsers';
import { TokenIterator, TokenType, Token } from '../tokenizer';
import { LazyCompoundEntry } from '../data_structs';
import { Evaluator } from '../parser';
import { Range } from 'vscode-languageserver';
import { NBTPathContext } from '../nbt';


export class UUIDParser extends ValueParser<UUID> {
	id: string = 'UUID';
	parse(t: TokenIterator, ctx: any): UUID | LazyCompoundEntry<UUID> {
		/* if (t.isNext('[')) {
			let arr = Parsers.list.parse(t,{item: Parsers.int,count: 4});
			return e=>{
				let evalarr = arr.map(v=>e.valueOf(v));
				return new UUID()
			}
		} */
		let v = t.expectType(TokenType.string);
		let uuid = parseUUID(v,(r,msg)=>t.error(r,msg));
		let res = new UUID(["0","0","0","0","0"]);
		if (uuid) {
			res = uuid
		}
		return res;
	}
	toString(value: UUID, e: Evaluator, data: any): string {
		return value.toString()
	}
	
	toCompoundData(value: UUID) {
		return value.toIntArray()
	}

	createPathContext() {
		return new NBTPathContext({}).list(new NBTPathContext({}).end())
	}
}

export class UUID {

	constructor(public components: string[]) {

	}

	toString(): string {
		return this.components.join('-');
	}
	
	toIntArray(): number[] {
		return [
			parseInt(this.components[0],16),
			(parseInt(this.components[1],16) << 16) | parseInt(this.components[2],16),
			parseInt(this.components[3],16) << 16,
			parseInt(this.components[4],16)
		];
	}
}

export function parseUUID(value: Token, err: (range: Range, str: string)=>any): UUID {
	let str = value.value;
	let components = str.split('-');
	if (components.length != 5) {
		return err(value.range,"UUID must have 5 segments separated by dashes (-)");
	}
	let nextIndex = 0;
	let hasError = false;
	console.log('full range: ',value.range);
	for (let c of components) {
		let range = subRange(value.range,nextIndex,str.indexOf('-',nextIndex));
		console.log('segment range: ',range);
		nextIndex += c.length + 1;
		if (c == '') return err(range,"Invalid empty UUID segment");
		let re = /[^a-fA-F0-9]/g;
		let match: RegExpExecArray
		
		while ((match = re.exec(c)) != null) {
			hasError = true;
			let r = subRange(range,match.index,match.index + 1);
			console.log('char range: ',r);
			err(r,"Invalid character in UUID. Must be a hexadecimal digit (0-F)");
		}
		
	}
	if (hasError) return;
	return new UUID(components);
}

function subRange(range: Range, start: number, end: number): Range {
	return {start: {line: range.start.line,character: range.start.character + start},end: {line: range.end.line,character: range.start.character + end}};
}