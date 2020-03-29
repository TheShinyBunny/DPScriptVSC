import { Lazy } from './parser';

export type NBT = {[key: string]: (Lazy<any> | Lazy<any>[] | string | number | boolean | NBT)};