import { toLowerCaseUnderscored } from "./util";

export class Namespace {
	
    items: DatapackItem[] = [];
    ticks: MCFunction[] = [];
    loads: MCFunction[] = [];

    constructor(public name: string) {

    }

    toString() {
        return this.name;
    }

    getFunction(name: string) {
        for (let i of this.items) {
            if (i instanceof MCFunction && i.name == name) {
                return i;
            }
        }
    }
    
    add(item: DatapackItem) {
		this.items.push(item);
    }
    
    createFunction(name: string) {
        let f = new MCFunction(this,name);
        this.add(f);
        return f;
    }
}

export abstract class DatapackItem {
    abstract save(dir: string): void;

    abstract dirName: string;
}

export class MCFunction extends DatapackItem {
    
    commands: string[] = [];
    dirName = "functions";

    constructor(public namespace: Namespace, public name: string) {
        super();
    }

    add(...cmd: string[]) {
        for (let c of cmd) {
            console.log("+ " + c);
        }
        this.commands.push(...cmd);
    }

    save(dir: string) {

    }
    
    toString() {
        return this.namespace + ":" + toLowerCaseUnderscored(this.name);
    }
}