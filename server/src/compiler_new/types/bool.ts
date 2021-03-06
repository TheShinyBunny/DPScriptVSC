import { Parser } from '../parser';
import { ValueType } from './types';

export class BoolType extends ValueType<boolean> {
	getDetail(ctx: any, key: string): string {
		return 'boolean'
	}
	parse(p: Parser): boolean {
		if (p.isNext('true') || p.isNext('false')) return p.nextToken().value == 'true'
	}
	
}