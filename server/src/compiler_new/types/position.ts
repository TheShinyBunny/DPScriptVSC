import { AnyNumberExpression, Expression, UnaryExpression, ValueExpression } from '../ast';
import { Parser } from '../parser';
import { Token } from '../tokenizer';
import { NumberType, NumberTypes } from './numbers';
import { ValueType, ValueTypes } from './types';

export interface Coordinate {
	value: Expression<number>
	relative?: boolean
}

export namespace Coordinate {
	export const here: Coordinate = {value: new ValueExpression(ValueTypes.int,0),relative: true}
}

export interface Rotation {
	yaw: Coordinate
	pitch: Coordinate
}

export interface Position {
	x: Coordinate
	y: Coordinate
	z: Coordinate
	rotated: boolean
}

export class RotationType extends ValueType<Rotation> {
	parse(p: Parser): Rotation {
		if (p.isNext('<')) {
			p.nextToken()
			let rot: Rotation = {yaw: Coordinate.here, pitch: Coordinate.here}
			p.suggestHere({value: 'here'},{value: 'yaw',detail: 'horizontal rotation'},{value: 'pitch',detail: 'vertical rotation'})
			if (p.isNext('here')) {
				p.nextToken()
				p.expectValue('>')
				return rot
			}
			let pitch = false, yaw = false
			while (p.hasNext()) {
				if (p.isNext('yaw')) {
					if (yaw) {
						p.error(p.token.range,"Yaw already defined")
					}
					p.nextToken()
					yaw = true
					rot.yaw = readCoordValue(p)
				} else if (p.isNext('pitch')) {
					if (pitch) {
						p.error(p.token.range,"Pitch already defined")
					}
					p.nextToken()
					pitch = true
					rot.pitch = readCoordValue(p)
				} else {
					let v = p.parseExpression()
					if (v) {
						if (yaw) {
							rot.pitch = {value: new AnyNumberExpression(v)}
							pitch = true
						} else {
							rot.yaw = {value: new AnyNumberExpression(v)}
							yaw = true
						}
					}
				}
				
				if (p.isNext(',') && (!pitch || !yaw)) {
					p.nextToken()
					if (pitch) {
						p.suggestHere({value: 'yaw',detail: 'horizontal rotation'})
					}
					if (yaw) {
						p.suggestHere({value: 'pitch',detail: 'vertical rotation'})
					}
				} else {
					p.expectValue('>')
					break
				}
			}
			return rot
		}
	}
	getDetail(ctx: any, key: string): string {
		return 'rotation'
	}
	
}

function readCoordValue(p: Parser): Coordinate {
	if (p.isNext('+')) {
		p.nextToken()
		let val = p.parseSingleValue();
		if (val) {
			val = val.ensure(v=>v.type instanceof NumberType)
			return {value: val,relative: true}
		}
		p.error(p.token.range,"Expected a number value")
	} else if (p.isNext('-')) {
		p.nextToken()
		let val = p.parseSingleValue();
		if (val) {
			val = val.ensure(v=>v.type instanceof NumberType)
			return {value: new UnaryExpression(val,Token.dummy('-')),relative: true}
		}
		p.error(p.token.range,"Expected a number value")
	} else {
		p.expectValue('=')
		let val: Expression<any> = p.parseExpression()
		if (val) {
			val = val.ensure(v=>v.type instanceof NumberType)
			return {value: val}
		}
	}
}