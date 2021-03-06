import { EOF } from 'dns';
import { Hover, Position, Range } from 'vscode-languageserver'

export const symbols = ['(',')','[',']','{','}',',','.','~','`',';','^','$','#','@','?',':'];

export const operatorSymbols = ['<','>','=','!','+','-','*','/','%','|','&'];
export const operators = ['+','-','++','--','+=','-=','*','/','%','*=','/=','%=','<','>','<=','>=','==','=','&&','||','!=','!']

export const keywords = ["declare","tick","load","print","self","import","if","else","while","summon","as","at","for","const","objective","rotated","anchored","in","positioned","block","item","function"];

export class Tokenizer {

	pos = 0
	line = 0
	character = 0

	constructor(private input: string) {

	}

	getNextToken(): Token {
		if (!this.canRead()) return Token.EOF;
		let c = this.input[this.pos];
		let start = this.currentPos();
		this.pos++;
		if (c == '\r') return this.getNextToken()
		this.character++;
		switch (c) {
			case ' ':
				c = this.input[this.pos];
				while (c == ' ') {
					this.pos++;
					this.character++;
					c = this.input[this.pos];
				}
				return this.getNextToken();
			case '\n':
				let t = this.token(TokenType.line_end,start,'');
				this.line++;
				this.character = 0
				return t;
			case '"':
			case "'":
				return this.token(TokenType.string,start,this.readString(c));
			default:
				if (c.match(/[a-zA-Z_]/g)) {
					let id = this.readIdentifier(c);
					if (this.isKeyword(id)) {
						return this.token(TokenType.keyword,start,id);
					} else {
						return this.token(TokenType.identifier,start,id);
					}
				}
				if (c.match(/[0-9]/g)) {
					return this.readNumber(start,c);
				}
				if (symbols.indexOf(c) >= 0) {
					if (this.input[this.pos] != '.') {
						return this.token(TokenType.symbol,start,c);
					}
				}
				let op = this.readOperator(c);
				if (op) return this.token(TokenType.operator,start,op);
				return this.token(TokenType.invalid,start,c);
		}
	}

	currentPos(): Position {
		return {line: this.line, character: this.character};
	}

	canRead(): boolean {
		return this.pos < this.input.length;
	}

	token(type: TokenType, start: Position, value: string): Token {
		return new Token(value === undefined ? TokenType.invalid : type,value,{start,end: this.currentPos()});
	}

	readString(startQuote: string): string {
		let val = "";
		let esc = false;
		while (this.canRead()) {
			let c = this.input[this.pos];
			if (esc) {
				esc = false;
			} else if (c == '\r' || c == '\n') {
				return val
			} else if (c == startQuote) {
				this.pos++
				this.character++
				return val;
			} else if (c == '\\') {
				esc = true;
				this.pos++;
				this.character++;
				continue;
			}
			val += c;
			this.pos++;
			this.character++;
		}
	}

	readIdentifier(value: string): string {
		while(this.canRead()) {
			let c = this.input[this.pos];
			if (!c.match(/[a-zA-Z0-9_]/g)) {
				return value;
			}
			value += c;
			this.pos++;
			this.character++;
		}
		return value;
	}

	readNumber(start: Position, val: string): Token {
		let c: string;
		while (this.canRead()) {
			c = this.input[this.pos];
			if (!c.match(/[0-9]/g)) {
				break
			}
			val += c;
			this.pos++;
			this.character++;
		}
		if (c == '.') {
			c = this.input[this.pos + 1];
			if (c == '.') {
				return this.token(TokenType.integer,start,val);
			} else if (!c.match(/[0-9]/g)) {
				this.pos++;
				this.character++;
				return this.token(TokenType.double,start,val);
			}
			this.pos++;
			this.character++;
			val += '.';
			while (this.canRead()) {
				c = this.input[this.pos];
				if (!c.match(/[0-9]/g)) {
					break;
				}
				val += c;
				this.pos++;
				this.character++;
			}

			let type = TokenType.double;
			if (c == 'd' || c == 'D') {
				this.pos++;
				this.character++;
			} else if (c == 'f' || c == 'F') {
				this.pos++;
				this.character++;
				type = TokenType.float;
			}
			return this.token(type,start,val);
		} else {
			let type = TokenType.integer;
			if (c == 'l' || c == 'L') {
				this.pos++;
				this.character++;
				type = TokenType.long;
			} else if (c == 's' || c == 'S') {
				this.pos++;
				this.character++;
				type = TokenType.short;
			} else if (c == 'b' || c == 'B') {
				this.pos++;
				this.character++;
				type = TokenType.byte;
			}
			return this.token(type,start,val);
		}
	}

	readOperator(value: string): string {
		if (operators.indexOf(value) < 0) return;
		while (this.canRead()) {
			let c = this.input[this.pos];
			if (operators.indexOf(value + c) < 0) return value;
			value += c;
			this.pos++;
			this.character++;
		}
		return value;
	}

	isKeyword(value: string) {
		return keywords.indexOf(value) >= 0;
	}

}

export enum TokenType {
	line_end,
	identifier,
	keyword,
	integer,
	long,
	short,
	byte,
	double,
	float,
	string,
	operator,
	symbol,
	invalid
}

export class Token {
	
	static EOF: Token = new Token(TokenType.invalid,"",{start: {line: -1,character: -1},end: {line: -1,character: -1}})

	constructor(public type: TokenType, public value: string, public range: Range) {

	}

	isValid(): boolean {
		return !this.isEOF() && this.type != TokenType.invalid;
	}

	isEOF(): boolean {
		return this == Token.EOF || this.range.start.line < 0;
	}

	withValue(value: string, newType?: TokenType) {
		return new Token(newType !== undefined ? newType : this.type,value,this.range);
	}

	static dummy(value: string, type: TokenType = TokenType.identifier) {
		return new Token(type,value,{start: {line: -1,character: -1},end: {line: -1,character: -1}})
	}
}