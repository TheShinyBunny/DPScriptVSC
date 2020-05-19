
import { VariableType, VariableTypes } from './util';
import { Position, Range, CompletionItemKind } from 'vscode-languageserver';
import { Lazy, getLazyVariable } from './parser';
import { Suggestion, CompilationContext, FutureSuggestion } from './compiler';

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

const operators = ["+", "-", "++", "--", "*", "/", "%", "<", ">", ">=", "<=", "==", "=", "><", "!=", "!", "&&", "||","+=","-=","%=","/=","*=",".."];
const symbols = "{}().,;[]<>~^@:#$";

export class Tokenizer {
	chars: CharStream;
	pos: Position = {line: 0, character: -1};
	resolvedNext: boolean = false;
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
				} else if (next.match(/[a-zA-Z_]/g)) {
					return this.readIdentifier(next);
				}
		}
		return {range: {start: this.pos, end: this.pos},value: "",type: TokenType.invalid};
	}

	next(): Token {
		if (this.resolvedNext) {
			this.resolvedNext = false;
			return this.lastToken;
		}
		let tok = this.getNextToken();
		this.lastToken = tok;
		return tok;
	}

	peek() {
		if (this.resolvedNext) return this.lastToken;
		let n = this.next();
		this.resolvedNext = true;
		return n;
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
			if ((value + next).match(/^(0|([1-9][0-9]*))(\\.[0-9]+)?$/g)) {
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

export const EOF: Token = {value: "",type: TokenType.invalid, range: {start: {line: -1,character: 0},end: {line: -1, character: 0}}}

export namespace Tokens {
	export function typeString(type: TokenType) {
		return Object.keys(TokenType).find(k=>TokenType[k] == type.valueOf());
	}

	export function tokenString(token: Token) {
		return typeString(token.type) + "(" + token.value + ": " + token.range.start.character + '-' + token.range.end.character + ")";
	}

	export function is(value: any): value is Token {
		return value && 'value' in value;
	}

	export function lazify(val: Lazy<string> | Token): Lazy<string> {
		return is(val) ? Lazy.literal(val.value,VariableTypes.string) : val;
	}
}

export interface Token {
	range: Range;
	value: string;
	type: TokenType;
}


export class TokenIterator {
	
	pos: number;
	lastToken?: Token;

	constructor(public tokens: Token[], public ctx: CompilationContext) {
		this.pos = 0;
	}

	static fromCode(code: string, ctx: CompilationContext) {
		let ti = new TokenIterator([],ctx);
		let tz = new Tokenizer(code);
		let t = tz.next();
		while (t.type != TokenType.invalid) {
			ti.tokens.push(t);
			t = tz.next();
		}
		return ti;
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
		if (!this.hasNext()) return EOF;
		let t = this.tokens[this.pos];
		if (t.type == TokenType.comment && !comments) {
			this.next();
			return this.peek();
		}
		return t;
	}

	next(): Token {
		if (this.pos >= this.tokens.length) return EOF;
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
		if (this.lastPos && (this.isTypeNext(TokenType.line_end) || !this.hasNext())) {
			this.ctx.editor.error({start: this.lastPos.end, end: {line: this.lastPos.end.line, character: this.lastPos.end.character + 1}},msg);
		} else if (this.nextPos) {
			this.ctx.editor.error(this.nextPos,msg);
		}
	}

	warn(range: Range,msg: string) {
		this.ctx.editor.warn(range, msg);
	}

	startRange(): Range {
		return {...this.nextPos};
	}

	endRange(range: Range) {
		if (this.lastToken) {
			range.end = this.lastToken.range.end;
		}
	}

	skip(...value: string[]) {
		if (value.length > 0) {
			if (this.isNext(...value)) {
				this.next();
				return true;
			}
		} else {
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
		this.suggest(range,...suggestions);
		return this.isNext(...suggestions.map(s=>typeof s === 'string' ? s : s.value));
	}

	suggest(range: Range, ...suggestions: FutureSuggestion[]) {
		this.ctx.editor.suggestAll(range,...suggestions);
	}

	expectVariable<T>(type?: VariableType<T>): Lazy<T> {
		let v = this.expectType(TokenType.identifier);
		//console.log("searching for variable " + v.value);
		if (this.ctx.hasVariable(v.value,type)) {
			return getLazyVariable(v);
		} else {
			this.error(v.range,"Expected " + type.name + " variable");
		}
	}

	collectInsideBrackets(open: string, close: string, ctx: CompilationContext): TokenIterator {
		let depth = 1;
		let tokens: Token[] = [this.next()];
		while (this.hasNext() && depth > 0) {
			if (this.isNext(open)) {
				depth++;
			} else if (this.isNext(close)) {
				depth--;
			}
			tokens.push(this.next());
		}
		//console.log("collected:",tokens);
		return new TokenIterator(tokens,ctx);
	}
}