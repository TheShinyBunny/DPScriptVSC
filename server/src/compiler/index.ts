import { toLowerCaseUnderscored } from "./util";
import * as path from 'path';
import { DeclarationSpan } from './compiler';
import { BuildMode } from '../server'
import { URI } from 'vscode-uri';
import { uriToFilePath } from 'vscode-languageserver/lib/files';
import * as fs from 'fs';

export class DatapackProject {
    description: string
    primaryNamespace: Namespace
    mcNamespace: Namespace
    namespaces: Namespace[] = []

    constructor(public name: string, private root: Files.Directory) {
        this.description = "A datapack generated by DPScript"
    }

    getNamespaceForFile(file: Files.File) {
        let dir = file.parent;
        if (dir.equals(this.root)) {
            if (this.primaryNamespace) return this.primaryNamespace;
            this.primaryNamespace = new Namespace(toLowerCaseUnderscored(this.name));
            this.namespaces.push(this.primaryNamespace);
            return this.primaryNamespace;
        }
        let dirname = dir.name;
        let ns = this.namespaces.find(n=>n.name == dirname);
        if (ns) return ns;
        ns = new Namespace(toLowerCaseUnderscored(dirname));
        this.namespaces.push(ns);
        return ns;
    }

    reset() {
        this.namespaces = []
        this.primaryNamespace = undefined
    }

    build(mode: BuildMode) {
        let data = this.root.subDir('data');
        let pack = this.root.file('pack.mcmeta');
        pack.write(JSON.stringify({pack:{pack_format: 5,description: this.description}},undefined,4));
        for (let ns of this.namespaces) {
            let d = data.subDir(ns.name);
            ns.save(d);
        }
    }

    
}

export namespace Files {
    export function toUri(fsPath: string): URI {
        return URI.file(fsPath);
    }
    export function toUriStr(fsPath: string): string {
        return toUri(fsPath).toString();
    }

    export function toFSPath(uri: URI | string): string {
        return uriToFilePath(typeof uri == 'string' ? uri : uri.toString());
    }

    export function ensureFSPath(uri: string | URI, isUri?: boolean) {
        return isUri ? toFSPath(uri) : typeof uri == 'string' ? uri : toFSPath(uri);
    }

    export function join(...pathNodes: string[]) {
        return path.join(...pathNodes);
    }

    export function isDirectory(path: string) {
        return fs.lstatSync(path).isDirectory()
    }

    abstract class BaseFile {
        path: string

        constructor(path: string | URI, isUri?: boolean) {
            this.path = ensureFSPath(path,isUri);
        }

        abstract isDirectory(): this is Directory

        exists(): boolean {
            return fs.existsSync(this.path);
        }

        equals(other: BaseFile) {
            return path.normalize(this.path) == path.normalize(other.path);
        }

        get parent(): Directory {
            return dir(path.dirname(this.path))
        }

        get uri(): URI {
            return toUri(this.path);
        }

        abstract get name(): string

        toString() {
            return this.path;
        }
    }

    export class Directory extends BaseFile {
		
        
        subDir(name: string, create: boolean = true, didCreate?: ()=>void) {
            let d = new Directory(path.join(this.path,name));
            if (create) {
                d.create(didCreate);
            }
            return d;
        }

        create(didCreate?: ()=>void): Directory {
            if (!this.exists()) {
                fs.mkdirSync(this.path);
                if (didCreate) {
                    didCreate();
                }
            }
            return this;
        }

        file(name: string) {
            return new File(path.join(this.path,name));
        }

        asFile(extension: string): File {
            return this.parent.file(this.name + '.' + extension);
		}

        get name() {
            return path.basename(this.path);
        }

        children<F extends BaseFile = BaseFile>(only?: new(path: string | URI, uri?: boolean)=>F): F[] {
            return fs.readdirSync(this.path).map((f): BaseFile=>{
                if (isDirectory(join(this.path,f))) {
                    return this.subDir(f);
                }
                return this.file(f);
            }).filter(f=>!only || (f.isDirectory() ? only.prototype == Directory.prototype : only.prototype == File.prototype)).map(f=><F>(f));
        }

        isDirectory() {
            return true;
        }
    }

    export function dir(path: string, uri?: boolean) {
        return new Directory(path,uri);
    }

    export class File extends BaseFile {
        
        
        write(text: string) {
            if (!fs.existsSync(path.dirname(this.path))) {
                fs.mkdirSync(path.dirname(this.path))
            }
            fs.writeFileSync(this.path,text);
        }

        isDirectory() {
            return false;
        }

        get name() {
            console.log('path',this.path);
            console.log('fullname',this.fullName);
            return this.fullName.substring(0,this.fullName.lastIndexOf('.'))
        }

        get fullName() {
            return path.basename(this.path);
        }

        get extension() {
            return path.extname(this.path).substring(1)
        }
    }
    export function file(path: string | URI, uri?: boolean) {
        return new File(path,uri);
    }
    
}


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

    save(dir: Files.Directory) {
        for (let i of this.items) {
            let dn = i.dirName;
            let d = dir.subDir(dn);
            i.save(d);
        }
    }
}

export abstract class DatapackItem {

    constructor(public loc: ResourceLocation) {

    }


    abstract save(dir: Files.Directory): void;

    abstract dirName: string;
}

export interface WritingTarget {
    add: (cmd: string)=>void;
}

export class ResourceLocation {
    constructor(public ns: Namespace, public path: string) {}

    toString() {
        return this.ns.name + ':' + this.path.replace(path.sep,'/');
    }
}

export class MCFunction extends DatapackItem implements WritingTarget {
    
    commands: string[] = [];
    dirName = "functions";
    declaration: DeclarationSpan

    constructor(loc: ResourceLocation, public name: string) {
        super(loc);
    }

    add(cmd: string) {
        console.log("+ " + cmd);
        this.commands.push(cmd);
    }

    save(dir: Files.Directory) {
        let f = dir.file(this.loc.path + '.mcfunction');
        f.write(this.commands.join('\n'));
    }
    
    toString() {
        return this.loc.toString();
    }
}

