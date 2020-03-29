import { EditorHelper, Suggestion, CompilationContext } from './compiler';
import { Position, Range, CompletionItemKind } from 'vscode-languageserver';
import { VariableType } from './util';
import { Lazy, getLazyVariable } from './parser';


class CharStream {
	pos: number;

	constructor(private input: string) {
		this.pos = 0;
	}

	next(): string {
		if (!this.canRead()) {
			return "";
		}
		return this.input[this.pos++];
	}

	isNext(char: string) {
		return this.peek() == char;
	}

	canRead() {
		return this.pos < this.input.length;
	}

	peek() {
		return this.input[this.pos];
	}

}

const operators = ["+", "-", "++", "--", "*", "/", "%", "<", ">", ">=", "<=", "==", "><", "!=", "!", "&&", "||","+=","-=","%=","/=","*=",".."];
const symbols = "{}().,;[]<>=~^@:#";

class Tokenizer {
	chars: CharStream;
	pos: Position = {line: 0, character: -1};
	lastToken?: Token;

	constructor(input: string) {
		this.chars = new CharStream(input);
	}

	private getNextToken(): Token {
		if (!this.chars.canRead()) return {range: {start: this.pos, end: this.pos},type: TokenType.invalid, value: ""};
		let next = this.nextChar();
		switch (next) {
			case '"':
			case "'":
				return this.readString(next);
			case '\r':
				return this.next();
			case '\n':
				return {range: {start: this.pos, end: this.nextPos},value: '\n',type: TokenType.line_end};
			case ' ':
				return this.next();
			case '/':
				if (this.chars.isNext('/')) {
					this.nextChar();
					return this.readToLineEnd(TokenType.comment);
				} else if (!this.lastToken || this.lastToken.type == TokenType.line_end) {
					return this.readToLineEnd(TokenType.raw_command);
				} else {
					return {range: {start: this.pos, end: this.nextPos},value: "", type: TokenType.invalid};
				}
			default:
				if (operators.indexOf(next) >= 0) {
					let start = this.pos;
					let second = this.chars.peek();
					if (operators.indexOf(next + second) >= 0) {
						this.nextChar()
						return {range: {start: start, end: this.nextPos},value: next + second,type: TokenType.operator};
					} else {
						return {range: {start: start, end: this.nextPos},value: next, type: TokenType.operator};
					}
				} else if (operators.indexOf(next + this.chars.peek()) >= 0){
					let start = this.pos;
					let second = this.nextChar();
					return {range: {start: start, end: this.nextPos},value: next + second,type: TokenType.operator};
				} else if (next.match(/[0-9]/g)) {
					return this.readNumber(next);
				} else if (symbols.indexOf(next) >= 0) {
					return {range: {start: this.pos, end: this.nextPos},value: next, type: TokenType.symbol};
				} else if (next.match(/[a-zA-Z_$]/g)) {
					return this.readIdentifier(next);
				}
		}
		return {range: {start: this.pos, end: this.pos},value: "",type: TokenType.invalid};
	}

	next(): Token {
		let tok = this.getNextToken();
		this.lastToken = tok;
		return tok;
	}

	nextChar() {
		this.pos = this.nextPos;
		let c = this.chars.next();
		return c;
	}

	get nextPos() {
		let c = this.chars.peek();
		if (c == '\n') {
			return {line: this.pos.line + 1,character: -1};
		} else {
			return {line: this.pos.line, character: this.pos.character + 1};
		}
	}

	readToLineEnd(type: TokenType): Token {
		let value = "";
		let start = this.pos;
		while (this.chars.canRead()) {
			if (this.chars.isNext('\n')) break;
			value += this.nextChar();
		}
		return {range: {start,end: this.nextPos},value, type};
	}

	readString(end: string): Token {
		let value = "";
		let esc = false;
		let start = this.pos;
		while (this.chars.canRead()) {
			let n = this.nextChar();
			if (n == end) {
				if (esc) {
					value += n;
					esc = false;
				} else {
					break;
				}
			} else if (n == '\\') {
				if (esc) {
					value += n;
					esc = false;
				} else {
					esc = true;
				}
			} else {
				value += n;
			}
		}
		return {range: {start,end: this.nextPos}, value, type: TokenType.string};
	}

	readNumber(first: string): Token {
		let start = this.pos;
		let value = first;
		let decimal = false;
		while (this.chars.canRead()) {
			let next = this.chars.peek();
			if (next == '.') {
				if (decimal) {
					decimal = false;
					break;
				}
				decimal = true;
			}
			if ((value + next).match(/[1-9]?[0-9]*\\.[0-9]*/g)) {
				value += next;
			} else {
				break;
			}
			this.nextChar();
		}
		return {range: {start, end: this.nextPos}, type: decimal ? TokenType.double : TokenType.int, value};
	}

	readIdentifier(first: string): Token {
		let start = this.pos;
		let value = first;
		while (this.chars.canRead()) {
			let next = this.chars.peek();
			if (next.match(/[a-zA-Z0-9_$]/g)) {
				value += next;
			} else {
				break;
			}
			this.nextChar();
		}
		return {range: {start,end: this.nextPos},value,type: TokenType.identifier};
	}

}

export enum TokenType {
	string,
	line_end,
	int,
	double,
	operator,
	symbol,
	identifier,
	comment,
	raw_command,
	invalid
}

export namespace Tokens {
	export function typeString(type: TokenType) {
		return Object.keys(TokenType).find(k=>TokenType[k] == type.valueOf());
	}

	export function tokenString(token: Token) {
		return typeString(token.type) + "(" + token.value + ": " + token.range.start.character + '-' + token.range.end.character + ")";
	}
}

export interface Token {
	range: Range;
	value: string;
	type: TokenType;
}

export type FutureSuggestion = {
	value: string
	desc?: string
	type?: CompletionItemKind
} | string;

export class TokenIterator {
	
	tokens: Token[];
	pos: number;
	lastToken?: Token;
	eof: Token;

	constructor(code: string, public ctx: CompilationContext) {
		this.tokens = [];
		let tz = new Tokenizer(code);
		let t = tz.next();
		console.group("tokens:");
		while (t.type != TokenType.invalid) {
			console.log(Tokens.tokenString(t));
			this.tokens.push(t);
			t = tz.next();
		}
		this.eof = t;
		console.groupEnd();
		this.pos = 0;
	}

	get nextPos(): Range {
		return this.peek().range;
	}

	get lastPos(): Range | undefined {
		return this.lastToken ? this.lastToken.range : undefined;
	}
	
	isTypeNext(...type: TokenType[]) {
		return type.indexOf(this.peek().type) >= 0;
	}

	isNext(...values: string[]) {
		let v = this.peek().value;
		return values.indexOf(v) >= 0;
	}

	peek(comments: boolean = false): Token {
		if (!this.hasNext()) return this.eof;
		let t = this.tokens[this.pos];
		if (t.type == TokenType.comment && !comments) {
			this.next();
			return this.peek();
		}
		return t;
	}

	next(): Token {
		if (this.pos >= this.tokens.length) return this.eof;
		this.lastToken = this.peek();
		return this.tokens[this.pos++];
	}
	
	expectType(type: TokenType, suggestor?: ()=>FutureSuggestion[]): Token {
		if (suggestor) {
			this.suggestHere(...suggestor());
		}
		if (this.isTypeNext(type)) return this.next();
		this.error(this.nextPos,"Expected " + Tokens.typeString(type));
		return {range: this.nextPos,value: "", type: type};
	}

	expectValue(...values: string[]): string {
		if (values.length > 1) {
			this.suggestHere(...values);
		}
		if (this.isNext(...values)) return this.next().value;
		this.errorNext("Expected " + values.join(', '));
		return "";
	}

	error(range: Range,msg: string) {
		this.ctx.editor.error(range, msg);
	}

	errorNext(msg: string) {
		if (this.isTypeNext(TokenType.line_end)) {
			this.ctx.editor.error({start: this.lastPos.end, end: {line: this.lastPos.end.line, character: this.lastPos.end.character + 1}},msg);
		} else {
			this.ctx.editor.error(this.nextPos,msg);
		}
	}

	warn(range: Range,msg: string) {
		this.ctx.editor.warn(range, msg);
	}

	endRange(range: Range) {
		if (this.lastToken) {
			range.end = this.lastToken.range.end;
		}
	}

	skip(...value: string[]) {
		if (this.isNext(...value)) {
			this.next();
			return true;
		}
		return false;
	}

	hasNext() {
		return this.pos < this.tokens.length;
	}

	nextLine(errorExtras: boolean) {
		if (errorExtras && this.hasNext() && !this.isTypeNext(TokenType.line_end)) {
			this.errorNext("Unexpected token");
		}
		while (this.hasNext() && !this.isTypeNext(TokenType.line_end)) {
			this.next();
		}
		this.next();
	}

	suggestHere(...suggestions: FutureSuggestion[]): boolean {
		let range: Range;
		if (this.isTypeNext(TokenType.line_end)) {
			range = {start: this.lastPos.end,end: {line: this.lastPos.end.line, character: this.lastPos.end.character + 1}}
		} else if (this.lastPos) {
			range = {start: this.lastPos.end, end: this.nextPos.end};
		} else {
			range = this.nextPos;
		}
		for (let s of suggestions) {
			let sugg: Suggestion = typeof s == 'string' ? {range,value: s} : {range,value: s.value,desc: s.desc,type: s.type};
			this.ctx.editor.suggest(sugg);
		}
		return this.isNext(...suggestions.map(s=>typeof s === 'string' ? s : s.value));
	}

	expectVariable<T>(type: VariableType<T>): Lazy<T> {
		let v = this.expectType(TokenType.identifier);
		if (this.ctx.hasVariable(v.value,type)) {
			return getLazyVariable(this.next());
		} else {
			this.error(v.range,"Expected " + type.name + " variable");
		}
	}
}