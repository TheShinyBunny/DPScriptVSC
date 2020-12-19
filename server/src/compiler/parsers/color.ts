import { ValueParser, Parsers } from './parsers';
import { TokenIterator, TokenType } from '../tokenizer';
import { Evaluator, UntypedLazy, parseSingleValue, parseExpression, Lazy } from '../parser';
import { Registry } from '../registries';
import { Color, TextEdit } from 'vscode-languageserver';
import { parseIdentifierOrVariable, VariableTypes } from '../util';
import { SpecialNumber, NumberType } from './special_numbers';
import { LazyCompoundEntry, DataContext } from '../data_structs'

export interface DyeColor {
	rgb: [number, number, number]
	firework: number
	index: number
}

export class ColorParser extends ValueParser<DyeColor> {
	
	id: string = "color"
	parse(t: TokenIterator): UntypedLazy<DyeColor> {
		console.log('SUGGESTING COLOR');
		t.suggestHere(...Registry.dyeColors.keys())
		if (t.isNext('$') || t.isTypeNext(TokenType.identifier)) {
			let color = parseIdentifierOrVariable(t);
			return e=>{
				let v = e.valueOf(color.value);
				let c = Registry.dyeColors.get(v);
				if (!c) {
					e.error(color.range,'Invalid color ID: ' + v)
				} else {
					e.file.editor.colors.push({range: color.range, color: Color.create(c.rgb[0],c.rgb[1],c.rgb[2],1)})
				}
				return c;
			}
		} else {
			let i = parseSingleValue(t);
			return e=>{
				let iv = e.valueOf(i,0,i.range,VariableTypes.int);
				if (iv < 0 || iv >= Registry.dyeColors.size) {
					e.error(i.range,'Invalid color ID: ' + i)
				} else {
					let c = Registry.dyeColors.entries().find(en=>en.value.index == iv);
					if (!c) return
					let res = c.value;
					e.file.editor.colors.push({range: i.range, color: Color.create(res.rgb[0],res.rgb[1],res.rgb[2],1)})
					return res;
				}
			};
		}
	}

	toString(value: DyeColor, e: Evaluator): string {
		return value.index + ""
	}

	toCompoundData(value: DyeColor): SpecialNumber {
		return {num: value.index, type: NumberType.byte}
	}

}

export class RGBParser extends ValueParser<number,{fireworks?: boolean}> {
	id: string = "rgb"
	parse(t: TokenIterator, ctx: { fireworks?: boolean; }): LazyCompoundEntry<number> {
		if (ctx.fireworks) {
			t.suggestHere(...Registry.dyeColors.keys());
		}
		if (t.suggestHere({value: 'rgb',detail: 'rgb(r,g,b)',snippet: "rgb($1,$2,$3)$0"})) {
			let colorRange = t.startRange();
			t.skip();
			t.expectValue('(');
			let r = parseExpression(t,VariableTypes.int);
			t.expectValue(',');
			let g = parseExpression(t,VariableTypes.int);
			t.expectValue(',');
			let b = parseExpression(t,VariableTypes.int);
			t.expectValue(')');
			t.endRange(colorRange);
			return e=>{
				let rv = e.valueOf(r);
				let gv = e.valueOf(g);
				let bv = e.valueOf(b);
				e.file.editor.colors.push({color: Color.create(rv / 255,gv / 255,bv / 255, 1),range: colorRange});
				e.file.editor.colorPresentations.push({range: colorRange, getter: (c)=>{
					let label = `rgb(${c.red * 255},${c.green * 255},${c.blue * 255})`;
					return {label, textEdit: TextEdit.replace(colorRange,label)};
				}});
				return (rv << 16) + (gv << 8) + bv
			}
		} else if (ctx.fireworks) {
			if (t.isNext(...Registry.dyeColors.keys())) {
				let id = t.next().value;
				let color = Registry.dyeColors.get(id);
				let range = t.lastPos;
				t.ctx.editor.colors.push({color: Color.create(color.rgb[0],color.rgb[1],color.rgb[2],1),range});
				t.ctx.editor.colorPresentations.push({range, getter: (c)=>{
					let label = `rgb(${c.red * 255},${c.green * 255},${c.blue * 255})`;
					return {label, textEdit: TextEdit.replace(range,label)};
				}});
				return e=>color.firework;
			}
		}
		let range = t.startRange();
		let v = parseExpression(t,VariableTypes.int);
		t.endRange(range);
		t.ctx.editor.colorPresentations.push({range,getter: (c)=>{
			let label = "" + ((c.red << 16) + (c.green << 8) + c.blue)
			return {label, textEdit: TextEdit.replace(range,label)};
		}})
		return e=>e.valueOf(v)
	}
	toString(value: number, e: Evaluator): string {
		return value + ""
	}
}

export class ChatColor extends ValueParser<string> {
	id: string = 'chat_color'
	parse(t: TokenIterator, ctx: any, key?: string, dataCtx?: DataContext<any>): LazyCompoundEntry<string> {
		let range = t.startRange();
		if (t.suggestHere({value: 'rgb',detail: 'rgb(r,g,b)',snippet: "rgb($1,$2,$3)$0"})) {
			let colorRange = t.startRange();
			t.skip();
			t.expectValue('(');
			let r = parseExpression(t,VariableTypes.int);
			t.expectValue(',');
			let g = parseExpression(t,VariableTypes.int);
			t.expectValue(',');
			let b = parseExpression(t,VariableTypes.int);
			t.expectValue(')');
			t.endRange(colorRange);
			return e=>{
				let rv = e.valueOf(r);
				let gv = e.valueOf(g);
				let bv = e.valueOf(b);
				e.file.editor.colors.push({color: Color.create(rv / 255,gv / 255,bv / 255, 1),range: colorRange});
				e.file.editor.colorPresentations.push({range: colorRange, getter: (c)=>{
					let label = `rgb(${c.red * 255},${c.green * 255},${c.blue * 255})`;
					return {label, textEdit: TextEdit.replace(colorRange,label)};
				}});
				return '#' + ((rv << 16) + (gv << 8) + bv)
			}
		}
		let id = Parsers.enum.parse(t,{registry: 'chatColors'});
		t.endRange(range);
		return e=>{
			let res = id(e,{});
			let color = Registry.chatColors.get(res);
			e.file.editor.colors.push({color: Color.create(color[0],color[1],color[2],1),range});
			e.file.editor.colorPresentations.push({range, getter: (c)=>{
				let label = `rgb(${c.red * 255},${c.green * 255},${c.blue * 255})`;
				return {label, textEdit: TextEdit.replace(range,label)};
			}})
			return res;
		}
	}
	toString(value: string, e: Evaluator, data: any): string {
		return value;
	}
	
}