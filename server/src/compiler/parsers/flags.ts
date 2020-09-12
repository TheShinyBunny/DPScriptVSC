import { ValueParser, Parsers } from './parsers';
import { TokenIterator, TokenType } from '../tokenizer';
import { Evaluator } from '../parser';


interface Options {
	flags: {[value: number]: string}
}

interface Flag {
	key: number
	value: string
}

class SingleFlagParser extends ValueParser<Flag,Flag[]> {
	id: string = "flag"
	parse(t: TokenIterator, ctx: Flag[]): Flag {
		let v = t.expectType(TokenType.identifier,()=>ctx.map(f=>f.value));
		let i = ctx.findIndex(fl=>fl.value == v.value);
		if (i < 0) {
			t.error(v.range,"Unknown flag '" + v.value + "'");
			return {key: 0,value:""}
		}
		return ctx.splice(i,1)[0];
	}
	toString(value: Flag, e: Evaluator, data: any): string {
		return value.value;
	}
	
}

const SingleParser = new SingleFlagParser();

export class FlagsParser extends ValueParser<number,Options> {
	id: string = "flags"
	parse(t: TokenIterator, ctx: Options): number {
		let flags: Flag[] = Object.keys(ctx.flags).map(k=>({key: Number(k), value: ctx.flags[k]}));
		if (t.skip('all')) {
			return flags.reduce((a,f)=>a + f.key,0);
		} else {
			let flagList = Parsers.list.parse<Flag,Flag[]>(t,{
				open: '[',
				close: ']',
				item: SingleParser,
				context: flags
			});
			return flagList.reduce((a,c)=>a + (<Flag>c).key,0);
		}
	}
	toString(value: number, e: Evaluator, data: Options): string {
		return value + ""
	}
	
}

