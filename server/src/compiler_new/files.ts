import { URI, uriToFsPath } from 'vscode-uri';
import * as fsExtra from 'fs-extra'
import * as paths from 'path';

export namespace FileUtil {

	export function getNameUri(uri: string, ext: boolean = true) {
		return getName(uriToFsPath(URI.parse(uri),true),ext)
	}

	export function getName(path: string, ext: boolean = true) {
		return paths.basename(path,ext ? undefined : paths.extname(path));
	}

	export function subDir(dir: string, name: string): string {
		let p = paths.resolve(dir,name)
		fsExtra.ensureDirSync(p)
		return p
	}

}