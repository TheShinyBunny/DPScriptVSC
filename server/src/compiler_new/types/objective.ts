import { Parser } from '../parser';
import { Token } from '../tokenizer';
import { ValueType } from './types';

export interface Objective {
	name: Token
	type: string
}


export class ObjectiveType extends ValueType<Objective> {
	parse(p: Parser, ctx: any): Objective {
		throw new Error('Method not implemented.');
	}
	getDetail(ctx: any, key: string): string {
		return 'Objective'
	}
	
}